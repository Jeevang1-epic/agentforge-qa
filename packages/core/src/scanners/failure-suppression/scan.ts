import { lstat, open, realpath } from "node:fs/promises";

import { resolveExistingPathInsideRepo, resolvePathInsideRepo } from "../../commands/command-paths.js";
import { isSafeGitReference, SCANNER_LOG_ARGS } from "../../commands/command-policy.js";
import { runGitEvidenceCommand, type CollectedGitEvidence } from "../../git/collect-git-evidence.js";
import { analyzeSource } from "./rules.js";
import { compareLines } from "./line-diff.js";
import { LIMITS, suppressionLanguage, type ChangedRange, type ScanResult } from "./types.js";

const ignoredDirectories = new Set(["node_modules", ".git", ".agentforge", "dist", "build", "generated", "vendor", "coverage", "__pycache__", ".next"]);
export function eligibleSource(path: string): boolean {
  return /\.(?:[cm]?[jt]sx?|py)$/i.test(path) &&
    !path.split(/[\\/]/).some((part) => ignoredDirectories.has(part.toLowerCase())) &&
    !/\.(?:min|generated|g|d)\.[jt]sx?$/i.test(path);
}

async function readSource(root: string, path: string, mayBeMissing: boolean): Promise<string | undefined> {
  const safe = await resolveExistingPathInsideRepo(root, path, "scanner source");
  if (mayBeMissing && safe.code.endsWith("_NOT_FOUND")) return undefined;
  if (!safe.approved || safe.path === undefined) throw new Error("Source path unavailable.");
  const lexical = resolvePathInsideRepo(await realpath(root), path, "scanner source");
  if (safe.path !== lexical.path) throw new Error("Redirected source path.");
  const info = await lstat(safe.path);
  if (!info.isFile() || info.size > LIMITS.fileBytes) throw new Error("Source file limit.");
  const file = await open(safe.path, "r");
  try {
    const buffer = Buffer.alloc(LIMITS.fileBytes + 1);
    let length = 0;
    while (length < buffer.length) {
      const read = await file.read(buffer, length, buffer.length - length, length);
      if (read.bytesRead === 0) break;
      length += read.bytesRead;
    }
    if (length > LIMITS.fileBytes || buffer.subarray(0, length).includes(0)) throw new Error("Unsupported source data.");
    const text = buffer.subarray(0, length).toString("utf8");
    if (text.includes("\uFFFD")) throw new Error("Unsupported source encoding.");
    return text;
  } finally {
    await file.close();
  }
}

export async function scanFailureSuppression(root: string, git: CollectedGitEvidence, since?: string): Promise<ScanResult> {
  const result: ScanResult = { status: "complete", signals: [], filesScanned: 0, filesSkipped: 0, summary: "" };
  if (git.status !== "collected") {
    return { ...result, status: "unavailable", summary: "Changed-work scanning requires collected Git evidence." };
  }
  let sourceBytes = 0;
  let diffBytes = 0;
  const partial = (): void => { result.status = "partial"; };
  const command = async (label: string, args: string[]): Promise<string> => {
    const output = await runGitEvidenceCommand(root, label, args, false, git.filterSafetyArgs);
    diffBytes += Buffer.byteLength(output.output);
    if (output.result.status !== "passed" || output.truncated || diffBytes > LIMITS.diffBytes) {
      throw new Error("Scanner Git evidence incomplete.");
    }
    return output.output;
  };
  const untracked = new Set(git.evidence.untrackedFiles);
  const renameOrigins = new Set(git.renamedPaths?.values());
  const paths = [...new Set([...git.evidence.changedFiles, ...untracked])].sort();
  const deleted = new Set(git.evidence.deletedFiles);
  const eligible = paths.filter(eligibleSource);
  result.filesSkipped = paths.length - eligible.length;
  if (eligible.length > LIMITS.files) { partial(); result.filesSkipped += eligible.length - LIMITS.files; }
  try {
    if (since !== undefined && !isSafeGitReference(since)) throw new Error("Unsafe reference.");
    // An unborn repository has no tracked baseline; its staged additions are new source.
    let base: string | undefined = since;
    if (base === undefined && eligible.some((path) => !untracked.has(path))) {
      const head = await runGitEvidenceCommand(root, "scanner-head", ["rev-parse", "--verify", "HEAD"], false);
      if (head.result.status === "passed" && /^[0-9a-f]{40,64}\s*$/.test(head.output)) base = head.output.trim();
      else if (head.result.status !== "failed" || head.result.exitCode !== 128) throw new Error("HEAD evidence unavailable.");
      else partial();
    }
    for (const [fileIndex, path] of eligible.slice(0, LIMITS.files).entries()) {
      if (sourceBytes >= LIMITS.sourceBytes || diffBytes >= LIMITS.diffBytes || result.signals.length >= LIMITS.signals) {
        partial();
        result.filesSkipped += Math.min(eligible.length, LIMITS.files) - fileIndex;
        break;
      }
      try {
        const source = await readSource(root, path, renameOrigins.has(path) || deleted.has(path));
        if (source === undefined) {
          result.filesSkipped += 1;
          continue;
        }
        sourceBytes += Buffer.byteLength(source);
        if (sourceBytes > LIMITS.sourceBytes) throw new Error("Aggregate source limit.");
        if (/^\s*(?:\/\/|#|\/\*)\s*@generated\b/.test(source.slice(0, 1024))) {
          result.filesSkipped += 1;
          continue;
        }
        let ranges: ChangedRange[] = [{ start: 1, end: source.split("\n").length }];
        if (!untracked.has(path) && base !== undefined) {
          let baselinePath = path;
          const visited = new Set<string>();
          while (git.renamedPaths?.has(baselinePath)) {
            if (visited.has(baselinePath) || visited.size >= LIMITS.files) throw new Error("Rename metadata limit.");
            visited.add(baselinePath);
            baselinePath = git.renamedPaths.get(baselinePath) ?? baselinePath;
          }
          const tree = await command("scanner-tree", ["ls-tree", "--full-tree", "-z", base, "--", `:(literal)${baselinePath}`]);
          if (tree !== "") {
            const entry = tree.match(/^100[0-7]{3} blob ([a-f0-9]{40}(?:[a-f0-9]{24})?)\t[^\0]+\0$/);
            if (entry?.[1] === undefined) throw new Error("Unsupported baseline entry.");
            const before = await command("scanner-blob", ["cat-file", "blob", entry[1]]);
            const bytes = Buffer.byteLength(before);
            sourceBytes += bytes;
            if (bytes > LIMITS.fileBytes || sourceBytes > LIMITS.sourceBytes || before.includes("\0") || before.includes("\uFFFD")) {
              throw new Error("Unsupported baseline source.");
            }
            ranges = compareLines(before, source);
          }
        }
        const scanned = analyzeSource(path, source, ranges);
        result.signals.push(...scanned.signals.slice(0, LIMITS.signals - result.signals.length));
        if (scanned.partial || result.signals.length >= LIMITS.signals) partial();
        result.filesScanned += 1;
      } catch {
        partial();
        result.filesSkipped += 1;
      }
    }
    if (since !== undefined) {
      const messages = await command("scanner-messages", [...SCANNER_LOG_ARGS, `${since}..HEAD`, "--"]);
      const entries = messages.split(/^commit [a-f0-9]{40,64}\r?$/m).slice(1);
      if (entries.length > LIMITS.messages || (messages.trim() !== "" && entries.length === 0)) partial();
      for (const [index, message] of entries.slice(0, LIMITS.messages).entries()) {
        const body = message.split("\n").filter((line) => line.startsWith("    ")).join("\n");
        if (suppressionLanguage(body)) {
          if (result.signals.length >= LIMITS.signals) { partial(); break; }
          result.signals.push({ ruleId: "AFQ-FS005", path: "commit-message", line: index + 1, correlated: false, validationContext: false });
        }
      }
    }
  } catch {
    partial();
  }
  result.summary = `Failure suppression scan ${result.status}: ${result.filesScanned} files scanned; ${result.filesSkipped} files skipped. Structural support: JavaScript, TypeScript, JSX, TSX, Python.`;
  return result;
}

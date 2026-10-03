import { realpath } from "node:fs/promises";
import { basename } from "node:path";

import {
  CommandPlanSchema,
  GitEvidenceSchema,
  type CommandResult,
  type GitEvidence,
  type RepoProfile,
} from "@agentforge-qa/schemas";

import { runCommandPlanWithOutput } from "../commands/command-runner.js";
import { createGitEvidenceId } from "../evidence/evidence-ids.js";
import { filterSafetyArguments } from "./filter-safety.js";

const dependencyFileNames = new Set([
  "package.json",
  "package-lock.json",
  "pnpm-lock.yaml",
  "pyproject.toml",
  "requirements.txt",
  "yarn.lock",
]);
const MAX_GIT_CAPTURE_BYTES = 5_000_000;
const GIT_SAFETY_ARGS = [
  "-c",
  "core.fsmonitor=false",
  "--no-optional-locks",
] as const;

export interface CollectedGitEvidence {
  evidence: GitEvidence;
  evidenceId: string;
  status: "collected" | "error" | "not_git_repo";
  filterSafetyArgs?: string[];
  renamedPaths?: Map<string, string>;
}

interface GitCommandOutput {
  truncated: boolean;
  output: string;
  result: CommandResult;
}

interface ParsedGitPaths {
  renamedPaths: Map<string, string>;
  changedFiles: Set<string>;
  deletedFiles: Set<string>;
  untrackedFiles: Set<string>;
}

let gitCommandSequence = 0;

function nextGitPlanId(label: string): string {
  gitCommandSequence += 1;
  return `git-${label}-${Date.now()}-${gitCommandSequence}`;
}

export async function runGitEvidenceCommand(
  repoRoot: string,
  label: string,
  args: string[],
  persistLogs = true,
  filterSafetyArgs: string[] = [],
): Promise<GitCommandOutput> {
  const execution = await runCommandPlanWithOutput(
    CommandPlanSchema.parse({
      id: nextGitPlanId(label),
      label: `Collect git ${label} evidence`,
      command: "git",
      args: [...GIT_SAFETY_ARGS, ...filterSafetyArgs, ...args],
      required: false,
      timeoutMs: 10_000,
      cwd: repoRoot,
    }),
    {
      repoRoot,
      logDirectory: ".agentforge/logs/git",
      maxCaptureBytes: MAX_GIT_CAPTURE_BYTES,
      persistLogs,
    },
  );

  return {
    output: execution.stdout,
    truncated: execution.stdoutTruncated === true,
    result: execution.result,
  };
}

function splitNullDelimitedOutput(output: string): string[] {
  if (output.length === 0) {
    return [];
  }

  if (!output.endsWith("\0")) {
    throw new Error("Git returned incomplete NUL-delimited output.");
  }

  return output.slice(0, -1).split("\0");
}

function isAgentForgeLogPath(path: string): boolean {
  return path === ".agentforge/logs" || path.startsWith(".agentforge/logs/");
}

function addChangedPath(paths: ParsedGitPaths, path: string): void {
  if (path.length === 0) {
    throw new Error("Git returned an empty path field.");
  }

  if (!isAgentForgeLogPath(path)) {
    paths.changedFiles.add(path);
  }
}

export function parseStatusPorcelainZ(output: string): ParsedGitPaths {
  const paths: ParsedGitPaths = {
    renamedPaths: new Map(),
    changedFiles: new Set<string>(),
    deletedFiles: new Set<string>(),
    untrackedFiles: new Set<string>(),
  };
  const fields = splitNullDelimitedOutput(output);

  for (let index = 0; index < fields.length; index += 1) {
    const record = fields[index] ?? "";

    if (record.length < 4 || record[2] !== " ") {
      throw new Error("Git status returned malformed porcelain output.");
    }

    const status = record.slice(0, 2);
    const path = record.slice(3);

    if (status === "??") {
      if (!isAgentForgeLogPath(path)) {
        paths.untrackedFiles.add(path);
      }
      continue;
    }

    addChangedPath(paths, path);

    if (status.includes("D") && !isAgentForgeLogPath(path)) {
      paths.deletedFiles.add(path);
    }

    if (status.includes("R") || status.includes("C")) {
      const originalPath = fields[index + 1];

      if (originalPath === undefined || originalPath.length === 0) {
        throw new Error("Git status rename output is incomplete.");
      }

      addChangedPath(paths, originalPath);
      if (status.includes("R")) {
        paths.renamedPaths.set(path, originalPath);
      }
      index += 1;
    }
  }

  return paths;
}

export function parseNameStatusZ(output: string): ParsedGitPaths {
  const paths: ParsedGitPaths = {
    renamedPaths: new Map(),
    changedFiles: new Set<string>(),
    deletedFiles: new Set<string>(),
    untrackedFiles: new Set<string>(),
  };
  const fields = splitNullDelimitedOutput(output);

  for (let index = 0; index < fields.length; index += 2) {
    const status = fields[index];
    const path = fields[index + 1];

    if (status === undefined || path === undefined || path.length === 0) {
      throw new Error("Git diff returned malformed name-status output.");
    }

    addChangedPath(paths, path);

    if (status.startsWith("D") && !isAgentForgeLogPath(path)) {
      paths.deletedFiles.add(path);
    }

    if (status.startsWith("R") || status.startsWith("C")) {
      const renamedPath = fields[index + 2];

      if (renamedPath === undefined || renamedPath.length === 0) {
        throw new Error("Git diff rename output is incomplete.");
      }

      addChangedPath(paths, renamedPath);
      if (status.startsWith("R")) {
        paths.renamedPaths.set(renamedPath, path);
      }
      index += 1;
    }
  }

  return paths;
}

function mergeGitPaths(target: ParsedGitPaths, source: ParsedGitPaths): void {
  for (const [path, original] of source.renamedPaths) {
    target.renamedPaths.set(path, original);
  }
  for (const path of source.changedFiles) {
    target.changedFiles.add(path);
  }

  for (const path of source.deletedFiles) {
    target.deletedFiles.add(path);
  }

  for (const path of source.untrackedFiles) {
    target.untrackedFiles.add(path);
  }
}

function createGitEvidence(
  since: string | undefined,
  paths: ParsedGitPaths,
  summary: string,
): GitEvidence {
  const allChangedFiles = [...paths.changedFiles].sort();

  return GitEvidenceSchema.parse({
    ...(since === undefined ? {} : { since }),
    changedFiles: allChangedFiles,
    untrackedFiles: [...paths.untrackedFiles].sort(),
    deletedFiles: [...paths.deletedFiles].sort(),
    dependencyFilesChanged: allChangedFiles
      .filter((path) => dependencyFileNames.has(basename(path)))
      .sort(),
    summary,
  });
}

function createErrorEvidence(
  since: string | undefined,
  paths: ParsedGitPaths,
  evidenceId: string,
  summary: string,
): CollectedGitEvidence {
  return {
    evidence: createGitEvidence(since, paths, summary),
    evidenceId,
    status: "error",
  };
}

function commandFailureSummary(label: string, output: GitCommandOutput): string {
  if (output.result.status === "passed") {
    return `${label} returned unexpected output.`;
  }

  return `${label} could not be collected: ${output.result.reason ?? output.result.status}.`;
}

async function gitTopLevelMatchesRepoRoot(
  repoRoot: string,
  reportedTopLevel: string,
): Promise<boolean> {
  try {
    const [canonicalRepoRoot, canonicalTopLevel] = await Promise.all([
      realpath(repoRoot),
      realpath(reportedTopLevel),
    ]);

    return canonicalRepoRoot === canonicalTopLevel;
  } catch {
    return false;
  }
}

export async function collectGitEvidence(
  repo: RepoProfile,
  since?: string,
): Promise<CollectedGitEvidence> {
  const evidenceId = createGitEvidenceId("status");
  const paths: ParsedGitPaths = {
    renamedPaths: new Map(),
    changedFiles: new Set<string>(),
    deletedFiles: new Set<string>(),
    untrackedFiles: new Set<string>(),
  };

  if (!repo.isGitRepo) {
    return {
      evidence: createGitEvidence(
        since,
        paths,
        "Git evidence was not collected because no .git marker was detected.",
      ),
      evidenceId,
      status: "not_git_repo",
    };
  }

  const insideWorkTree = await runGitEvidenceCommand(repo.root, "worktree", [
    "rev-parse",
    "--is-inside-work-tree",
  ]);

  if (
    insideWorkTree.result.status !== "passed" ||
    insideWorkTree.output.trim() !== "true"
  ) {
    return createErrorEvidence(
      since,
      paths,
      evidenceId,
      commandFailureSummary("Git worktree confirmation", insideWorkTree),
    );
  }

  const topLevel = await runGitEvidenceCommand(repo.root, "top-level", [
    "rev-parse",
    "--show-toplevel",
  ]);

  if (topLevel.result.status !== "passed" || topLevel.truncated) {
    return createErrorEvidence(
      since,
      paths,
      evidenceId,
      commandFailureSummary("Git top-level evidence", topLevel),
    );
  }

  const topLevelMatches = await gitTopLevelMatchesRepoRoot(
    repo.root,
    topLevel.output.trim(),
  );

  if (!topLevelMatches) {
    return createErrorEvidence(
      since,
      paths,
      evidenceId,
      "Git top-level evidence did not match the safely detected repository root.",
    );
  }

  let filterSafetyArgs: string[];
  try {
    const filters = await runGitEvidenceCommand(repo.root, "filter-metadata", [
      "config", "--null", "--name-only", "--get-regexp", "filter[.]",
    ], false);
    if ((filters.result.status !== "passed" &&
      !(filters.result.status === "failed" && filters.result.exitCode === 1)) ||
      filters.truncated) throw new Error("Filter metadata unavailable.");
    filterSafetyArgs = filterSafetyArguments(filters.output);
  } catch {
    return createErrorEvidence(since, paths, evidenceId, "Git filter safety metadata could not be collected.");
  }

  const statusOutput = await runGitEvidenceCommand(repo.root, "status", [
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
  ], true, filterSafetyArgs);

  if (statusOutput.result.status !== "passed" || statusOutput.truncated) {
    return createErrorEvidence(
      since,
      paths,
      evidenceId,
      commandFailureSummary("Git status evidence", statusOutput),
    );
  }

  try {
    mergeGitPaths(paths, parseStatusPorcelainZ(statusOutput.output));
  } catch {
    return createErrorEvidence(
      since,
      paths,
      evidenceId,
      "Git status evidence returned malformed or incomplete porcelain output.",
    );
  }

  if (since !== undefined) {
    const diffOutput = await runGitEvidenceCommand(repo.root, "diff", [
      "diff",
      "--no-ext-diff",
      "--no-textconv",
      "--name-status",
      "-z",
      since,
      "HEAD",
    ]);

    if (diffOutput.result.status !== "passed" || diffOutput.truncated) {
      return createErrorEvidence(
        since,
        paths,
        evidenceId,
        commandFailureSummary("Requested Git diff evidence", diffOutput),
      );
    }

    try {
      mergeGitPaths(paths, parseNameStatusZ(diffOutput.output));
    } catch {
      return createErrorEvidence(
        since,
        paths,
        evidenceId,
        "Git diff evidence returned malformed or incomplete name-status output.",
      );
    }
  }

  return {
    evidence: createGitEvidence(
      since,
      paths,
      `Collected read-only Git evidence for ${paths.changedFiles.size} changed and ${paths.untrackedFiles.size} untracked files.`,
    ),
    evidenceId,
    status: "collected",
    filterSafetyArgs,
    renamedPaths: paths.renamedPaths,
  };
}

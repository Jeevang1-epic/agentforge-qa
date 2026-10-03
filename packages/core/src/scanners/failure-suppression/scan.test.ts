import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { VerificationReportSchema } from "@agentforge-qa/schemas";
import { afterEach, describe, expect, it } from "vitest";

import { detectRepo } from "../../detectors/detect-repo.js";
import { createOutputCollector } from "../../commands/command-logs.js";
import { collectGitEvidence } from "../../git/collect-git-evidence.js";
import { runVerification } from "../../pipeline/run-verification.js";
import { scanFailureSuppression } from "./scan.js";
import { LIMITS } from "./types.js";

const roots: string[] = [];
async function git(root: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, { cwd: root, shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (chunk: Buffer) => { out += chunk.toString(); });
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolve(out.trim()) : reject(new Error("Fixture Git failed.")));
  });
}
async function fixture(source = "export const baseline = 1;\n"): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "agentforge-scanner-"));
  roots.push(root);
  await git(root, ["init"]);
  await git(root, ["config", "user.name", "Scanner Test"]);
  await git(root, ["config", "user.email", "scanner@example.invalid"]);
  await writeFile(join(root, ".gitignore"), ".agentforge/\n");
  await writeFile(join(root, "source.ts"), source);
  await writeFile(join(root, "ok.txt"), "ok");
  await writeFile(join(root, "agentforge.config.json"), JSON.stringify({ schemaVersion: "0.1.0", commands: [], artifacts: [{ id: "ok", label: "ok", path: "ok.txt", type: "file", required: true }] }));
  await git(root, ["add", "."]);
  await git(root, ["commit", "-m", "baseline"]);
  return root;
}
async function scan(root: string, since?: string) {
  return scanFailureSuppression(root, await collectGitEvidence(await detectRepo(root), since), since);
}
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe("changed-work scanner collection", () => {
  it("distinguishes literal capture markers from actual truncation", () => {
    const output = createOutputCollector(32);
    output.append("[OUTPUT TRUNCATED]");
    expect(output.isTruncated()).toBe(false);
    output.append("x".repeat(32));
    expect(output.isTruncated()).toBe(true);
  });
  it("accepts literal capture markers in baseline source and commit messages", async () => {
    const source = 'const marker = "[OUTPUT TRUNCATED]";\n';
    const root = await fixture(source);
    const base = await git(root, ["rev-parse", "HEAD"]);
    await writeFile(join(root, "source.ts"), source + "try {} catch {}\n");
    await git(root, ["add", "source.ts"]);
    await git(root, ["commit", "-m", "[OUTPUT TRUNCATED] best effort"]);
    const result = await scan(root, base);
    expect(result.status).toBe("complete");
    expect(result.signals.map((signal) => signal.ruleId)).toEqual(["AFQ-FS001", "AFQ-FS005"]);
  });
  it("does not scan existing unchanged suppression", async () => {
    const root = await fixture("try {} catch {}\nconst old = 1;\n");
    expect((await scan(root)).filesScanned).toBe(0);
    await writeFile(join(root, "source.ts"), "try {} catch {}\nconst old = 2;\n");
    expect((await scan(root)).signals).toEqual([]);
  });
  it("detects unstaged and staged empty handlers and removed handling", async () => {
    const root = await fixture("try { work(); } catch (error) {\n  log(error);\n}\n");
    await writeFile(join(root, "source.ts"), "try { work(); } catch (error) {\n}\n");
    expect((await scan(root)).signals[0]?.ruleId).toBe("AFQ-FS001");
    await git(root, ["add", "source.ts"]);
    expect((await scan(root)).signals[0]?.ruleId).toBe("AFQ-FS001");
  });
  it("includes eligible untracked Python, JSX and TSX files", async () => {
    const root = await fixture();
    await writeFile(join(root, "new.py"), "try:\n    work()\nexcept Exception:\n    pass\n");
    await writeFile(join(root, "view.tsx"), "const View = () => <div/>;\ntry {} catch {}");
    await writeFile(join(root, "view.jsx"), "promise.catch(() => {})");
    const result = await scan(root);
    expect(result.status).toBe("complete");
    expect(result.filesScanned).toBe(3);
    expect(result.signals.map((signal) => signal.path)).toEqual(["new.py", "view.jsx", "view.tsx"]);
  });
  it("scans changes since a safe ref plus uncommitted work and message language", async () => {
    const root = await fixture();
    const base = await git(root, ["rev-parse", "HEAD"]);
    await writeFile(join(root, "source.ts"), "try {} catch {}\n");
    await git(root, ["add", "source.ts"]);
    await git(root, ["commit", "-m", "Use best effort fallback"]);
    await writeFile(join(root, "new.py"), "try:\n    work()\nexcept:\n    pass");
    const result = await scan(root, base);
    expect(result.status).toBe("complete");
    expect(result.signals.map((signal) => signal.ruleId)).toEqual(["AFQ-FS001", "AFQ-FS001", "AFQ-FS005"]);
    expect(JSON.stringify(result)).not.toContain("Use best effort");
    expect(await scan(root, base)).toEqual(result);
  });
  it("keeps commit language alone nonblocking", async () => {
    const root = await fixture();
    const base = await git(root, ["rev-parse", "HEAD"]);
    await git(root, ["commit", "--allow-empty", "-m", "Document graceful fallback"]);
    const report = await runVerification({ cwd: root, since: base });
    expect(report.finalVerdict).toBe("SAFE_TO_CONTINUE");
    expect(report.risks.find((risk) => risk.title.includes("suppression language"))?.severity).toBe("info");
  });
  it("handles deletion, renaming, and literal pathspec characters", async () => {
    const root = await fixture();
    await git(root, ["mv", "source.ts", "[source].ts"]);
    await writeFile(join(root, "[source].ts"), "try {} catch {}");
    expect((await scan(root)).signals[0]?.path).toBe("[source].ts");
    await unlink(join(root, "[source].ts"));
    expect((await scan(root)).signals).toEqual([]);
  });
  it("does not reclassify an unchanged handler merely because its file was renamed", async () => {
    const root = await fixture("try {} catch {}\n");
    await git(root, ["mv", "source.ts", "renamed.ts"]);
    const result = await scan(root);
    expect(result.status).toBe("complete");
    expect(result.signals).toEqual([]);
  });
  it("scans a staged recreation of a file deleted since the base", async () => {
    const root = await fixture();
    const base = await git(root, ["rev-parse", "HEAD"]);
    await git(root, ["rm", "source.ts"]);
    await git(root, ["commit", "-m", "Remove source"]);
    const deleted = await scan(root, base);
    expect(deleted.status).toBe("complete");
    expect(deleted.signals).toEqual([]);
    await writeFile(join(root, "source.ts"), "try {} catch {}");
    await git(root, ["add", "source.ts"]);
    const recreated = await scan(root, base);
    expect(recreated.status).toBe("complete");
    expect(recreated.signals.map((signal) => signal.ruleId)).toEqual(["AFQ-FS001"]);
  });
  it("never persists scanned source or commit message bodies in Git logs", async () => {
    const root = await fixture();
    const base = await git(root, ["rev-parse", "HEAD"]);
    await writeFile(join(root, "source.ts"), "try { send('PRIVATE_SOURCE_SENTINEL'); } catch {}");
    await git(root, ["add", "source.ts"]);
    await git(root, ["commit", "-m", "fallback PRIVATE_MESSAGE_SENTINEL"]);
    const result = await scan(root, base);
    const logs = join(root, ".agentforge/logs/git");
    const text = (await Promise.all((await readdir(logs)).map((name) => readFile(join(logs, name), "utf8")))).join("\n");
    expect(text + JSON.stringify(result)).not.toContain("PRIVATE_SOURCE_SENTINEL");
    expect(text + JSON.stringify(result)).not.toContain("PRIVATE_MESSAGE_SENTINEL");
  });
  it("does not let Git attributes hide changed text", async () => {
    const root = await fixture();
    await writeFile(join(root, ".gitattributes"), "*.ts -diff\n");
    await writeFile(join(root, "source.ts"), "try {} catch {}");
    expect((await scan(root)).signals[0]?.ruleId).toBe("AFQ-FS001");
  });
  it("never runs configured clean filters while collecting status or source", async () => {
    const root = await fixture();
    const base = await git(root, ["rev-parse", "HEAD"]);
    await writeFile(join(root, "filter.cjs"), "require('node:fs').writeFileSync('FILTER_RAN', 'bad'); process.stdin.pipe(process.stdout);");
    await writeFile(join(root, ".gitattributes"), "*.ts filter=demo");
    await git(root, ["config", "filter.demo.clean", "node filter.cjs"]);
    await git(root, ["config", "filter.demo.required", "true"]);
    await writeFile(join(root, "source.ts"), "try {} catch {}");
    const result = await scan(root, base);
    expect(result.status).toBe("complete");
    expect(result.signals[0]?.ruleId).toBe("AFQ-FS001");
    expect(await readdir(root)).not.toContain("FILTER_RAN");
  });
  it("marks internal redirected paths incomplete rather than using mismatched diff locations", async () => {
    const root = await fixture();
    await mkdir(join(root, "real"));
    await writeFile(join(root, "real", "handler.ts"), "try {} catch {}");
    await symlink(join(root, "real"), join(root, "alias"), "junction");
    const collected = await collectGitEvidence(await detectRepo(root));
    collected.evidence.untrackedFiles = ["alias/handler.ts"];
    const result = await scanFailureSuppression(root, collected);
    expect(result.status).toBe("partial");
    expect(result.signals).toEqual([]);
  });
  it("bounds captured diffs even when the previous file was much larger", async () => {
    const root = await fixture("x".repeat(LIMITS.diffBytes + 1));
    await writeFile(join(root, "source.ts"), "try {} catch {}");
    expect((await scan(root)).status).toBe("partial");
  }, 15_000);
  it("detects overflow rather than silently omitting older commit messages", async () => {
    const root = await fixture();
    const base = await git(root, ["rev-parse", "HEAD"]);
    for (let index = 0; index <= LIMITS.messages; index += 1) {
      await git(root, ["-c", "commit.gpgsign=false", "commit", "--allow-empty", "-m", "Update notes"]);
    }
    const result = await scan(root, base);
    expect(result.status).toBe("partial");
    expect(result.signals).toEqual([]);
  }, 30_000);
  it("skips generated files and unsupported languages explicitly", async () => {
    const root = await fixture();
    for (const folder of ["node_modules", ".agentforge", "dist", "build", "vendor", "generated"]) {
      await mkdir(join(root, folder), { recursive: true });
      await writeFile(join(root, folder, "skip.ts"), "try {} catch {}");
    }
    await writeFile(join(root, "out.min.js"), "try {} catch {}");
    await writeFile(join(root, "code.go"), "suppressed");
    await writeFile(join(root, "auto.ts"), "// @generated\ntry {} catch {}");
    expect((await scan(root)).signals).toEqual([]);
    expect((await scan(root)).status).toBe("complete");
  });
  it.each(["binary", "oversized", "invalid-utf8", "malformed"])("fails conservatively for %s input", async (kind) => {
    const root = await fixture();
    const value = kind === "binary" ? Buffer.from([0, 1]) : kind === "invalid-utf8" ? Buffer.from([255]) : kind === "oversized" ? "x".repeat(LIMITS.fileBytes + 1) : "try {";
    await writeFile(join(root, "new.ts"), value);
    const report = await runVerification({ cwd: root });
    expect(report.finalVerdict).toBe("NEEDS_REVIEW");
    expect(report.risks).toContainEqual(expect.objectContaining({ category: "partial_verification", blocksVerdict: true }));
    expect(VerificationReportSchema.safeParse(report).success).toBe(true);
  });
  it("caps file count and aggregate bytes", async () => {
    const root = await fixture();
    for (let i = 0; i <= LIMITS.files; i += 1) await writeFile(join(root, `file-${i}.ts`), "const x = 1;");
    expect((await scan(root)).status).toBe("partial");
    expect((await scan(root)).filesScanned).toBe(LIMITS.files);
    const largeRoot = await fixture();
    for (let i = 0; i < 9; i += 1) await writeFile(join(largeRoot, `large-${i}.ts`), " ".repeat(LIMITS.fileBytes));
    expect((await scan(largeRoot)).status).toBe("partial");
    expect((await scan(largeRoot)).filesScanned).toBe(8);
  }, 20_000);
  it("rejects symlink escape and traversal without inspecting external content", async () => {
    const root = await fixture();
    const outside = await fixture("try {} catch {}");
    await symlink(outside, join(root, "linked"), "junction");
    const collected = await collectGitEvidence(await detectRepo(root));
    collected.evidence.untrackedFiles = ["linked/source.ts", "../outside.ts"];
    const result = await scanFailureSuppression(root, collected);
    expect(result.signals).toEqual([]);
    expect(result.status).toBe("partial");
    expect(result.filesSkipped).toBe(2);
  });
  it("retains independent command failure and demo-critical verdict precedence", async () => {
    const root = await fixture();
    await writeFile(join(root, "source.ts"), "try {} catch {}");
    await writeFile(join(root, "fail.cjs"), "process.exit(1);");
    await writeFile(join(root, "agentforge.config.json"), JSON.stringify({
      schemaVersion: "0.1.0", artifacts: [], commands: [{ id: "fail", label: "fail", command: "node", args: ["fail.cjs"], required: true, timeoutMs: 10000 }],
    }));
    const failed = await runVerification({ cwd: root, dryRun: false });
    expect(failed.finalVerdict).toBe("UNSAFE_TO_PUSH");
    await writeFile(join(root, "agentforge.config.json"), JSON.stringify({
      schemaVersion: "0.1.0", commands: [], artifacts: [{ id: "demo", label: "demo", path: "missing", type: "file", required: true, demoCritical: true }],
    }));
    const demo = await runVerification({ cwd: root });
    expect(demo.finalVerdict).toBe("DEMO_BLOCKED");
  });
  it("rejects unsafe or absent refs through controlled conservative reports", async () => {
    const root = await fixture();
    for (const since of ["--output=bad", "missing-reference", "HEAD~1"]) {
      const report = await runVerification({ cwd: root, since });
      expect(report.finalVerdict).toBe("NEEDS_REVIEW");
      expect(VerificationReportSchema.safeParse(report).success).toBe(true);
    }
  });
});

import { spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";
import { VerificationReportSchema } from "../../packages/schemas/src/index.js";
import { renderJsonReport, renderMarkdownReport } from "../../packages/reporters/src/index.js";

const cli = fileURLToPath(new URL("../../packages/cli/dist/index.js", import.meta.url));
const roots: string[] = [];
async function run(command: string, args: string[], cwd: string) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(command, args, { cwd, shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => { child.kill(); reject(new Error("Fixture command timeout.")); }, 20_000);
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("close", (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
  });
}
async function git(root: string, args: string[]) {
  const result = await run("git", args, root);
  expect(result.code, result.stderr).toBe(0);
  return result.stdout.trim();
}
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "agentforge-built-scanner-"));
  roots.push(root);
  await git(root, ["init"]);
  await git(root, ["config", "user.name", "CLI Test"]);
  await git(root, ["config", "user.email", "cli@example.invalid"]);
  await writeFile(join(root, "agentforge.config.json"), JSON.stringify({
    schemaVersion: "0.1.0", commands: [], artifacts: [
      { id: "ok", label: "ok", path: "ok.txt", type: "file", required: true },
    ],
  }));
  await writeFile(join(root, "ok.txt"), "ok");
  await writeFile(join(root, "source.ts"), "export const old = 1;");
  await writeFile(join(root, ".gitignore"), ".agentforge/");
  await git(root, ["add", "."]);
  await git(root, ["commit", "-m", "Baseline"]);
  return root;
}
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe("built failure suppression CLI", () => {
  it.each([
    ["clean change", "export const changed = 2;", "SAFE_TO_CONTINUE", undefined],
    ["empty catch", "try {} catch {}", "NEEDS_REVIEW", "AFQ-FS001"],
    ["default fallback", "try {} catch { return []; }", "SAFE_TO_CONTINUE", "AFQ-FS002"],
    ["correlated comment", "// gracefully fallback rather than failing\ntry {} catch { return []; }", "NEEDS_REVIEW", "AFQ-FS002"],
    ["permissive return", "try {} catch { return true; }", "NEEDS_REVIEW", "AFQ-FS003"],
    ["untracked promise", "promise.catch(() => {})", "NEEDS_REVIEW", "AFQ-FS004"],
  ])("verifies %s with valid JSON and clean stderr", async (label, source, verdict, ruleId) => {
    const root = await fixture();
    const path = label === "untracked promise" ? "untracked.ts" : "source.ts";
    await writeFile(join(root, path), source);
    const before = await readFile(join(root, path), "utf8");
    const result = await run(process.execPath, [cli, "verify", root, "--format", "json", "--exit-zero"], root);
    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");
    const report = VerificationReportSchema.parse(JSON.parse(result.stdout));
    expect(report.schemaVersion).toBe("0.1.0");
    expect(report.toolStatus).toBe("OK");
    expect(report.finalVerdict).toBe(verdict);
    expect(report.risks.some((risk) => risk.description.includes(ruleId ?? "not-a-rule"))).toBe(ruleId !== undefined);
    expect(await readFile(join(root, path), "utf8")).toBe(before);
    expect((await readdir(join(root, ".agentforge"))).sort()).toEqual(["logs"]);
    expect(renderJsonReport(report)).toBe(renderJsonReport(report));
  });

  it("verifies committed changed work using --since and valid summary formats", async () => {
    const root = await fixture();
    const base = await git(root, ["rev-parse", "HEAD"]);
    await writeFile(join(root, "source.ts"), "try {} catch {}");
    await git(root, ["add", "source.ts"]);
    await git(root, ["commit", "-m", "Best effort fallback"]);
    const result = await run(process.execPath, [cli, "verify", root, "--since", base, "--format", "json"], root);
    expect(result.code).toBe(1);
    expect(result.stderr).toBe("");
    const report = VerificationReportSchema.parse(JSON.parse(result.stdout));
    expect(report.finalVerdict).toBe("NEEDS_REVIEW");
    expect(report.risks.some((risk) => risk.description.includes("AFQ-FS005"))).toBe(true);
    for (const format of ["json", "markdown"]) {
      const summary = await run(process.execPath, [cli, "verify", root, "--since", base, "--summary-only", "--format", format, "--exit-zero"], root);
      expect(summary.code).toBe(0);
      expect(summary.stderr).toBe("");
      if (format === "json") {
        const parsed = JSON.parse(summary.stdout) as { schemaVersion: string; summary: unknown };
        expect(parsed.schemaVersion).toBe("0.1.0");
        expect(parsed.summary).toEqual(report.decisionSummary);
      } else {
        expect(summary.stdout).toContain("NEEDS_REVIEW");
        expect(summary.stdout).not.toContain("## Risks");
      }
    }
  });

  it("escapes scanner locations in Markdown and keeps JSON deterministic", async () => {
    const root = await fixture();
    await writeFile(join(root, "source-[review].ts"), "try {} catch {}");
    const result = await run(process.execPath, [cli, "verify", root, "--format", "json"], root);
    const report = VerificationReportSchema.parse(JSON.parse(result.stdout));
    const markdown = renderMarkdownReport(report);
    expect(markdown).toContain("source-\\[review\\].ts");
    expect(JSON.parse(renderJsonReport(report))).toEqual(report);
    expect(renderJsonReport(report)).toBe(renderJsonReport(report));
  });

  it("retains built help and candidate version", async () => {
    const root = await fixture();
    for (const args of [["--help"], ["verify", "--help"], ["--version"]]) {
      const result = await run(process.execPath, [cli, ...args], root);
      expect(result.code).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).toContain(args[0] === "--version" ? "0.3.0" : "verify");
    }
  });
});

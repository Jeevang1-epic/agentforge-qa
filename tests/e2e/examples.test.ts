import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  VerificationReportSchema,
  type VerificationReport,
} from "../../packages/schemas/src/index.js";
import { describe, expect, it } from "vitest";

import { evaluateCli } from "../../packages/cli/src/index.js";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const nodeBasicArgs = [
  "verify",
  "examples/node-basic",
  "--config",
  "examples/node-basic/agentforge.config.json",
  "--claims",
  "examples/node-basic/CLAIMS.md",
] as const;
const demoBlockedArgs = [
  "verify",
  "examples/demo-blocked",
  "--config",
  "examples/demo-blocked/agentforge.config.json",
  "--claims",
  "examples/demo-blocked/CLAIMS.md",
] as const;

async function listFiles(root: string): Promise<readonly string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = join(root, entry.name);

      if (entry.isDirectory()) {
        return listFiles(entryPath);
      }

      return [entryPath];
    }),
  );

  return files.flat();
}

async function readExampleFiles(): Promise<
  readonly { readonly path: string; readonly text: string }[]
> {
  const files = await listFiles(resolve(repositoryRoot, "examples"));

  return Promise.all(
    files.map(async (path) => ({
      path: relative(repositoryRoot, path).replaceAll("\\", "/"),
      text: await readFile(path, "utf8"),
    })),
  );
}

function parseReport(stdout: string): VerificationReport {
  return VerificationReportSchema.parse(JSON.parse(stdout));
}

describe("example fixtures", () => {
  it("verifies node-basic with parseable JSON, artifacts, claims, and dry-run commands", async () => {
    const result = await evaluateCli([
      ...nodeBasicArgs,
      "--format",
      "json",
      "--exit-zero",
    ]);
    const report = parseReport(result.stdout);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(report.toolStatus).toBe("OK");
    expect(report.finalVerdict).toBe("NEEDS_REVIEW");
    expect(report.commands).toEqual([
      expect.objectContaining({
        planId: "node-basic-smoke",
        status: "skipped",
      }),
    ]);
    expect(report.commands[0]?.reason).toContain("Dry run");
    expect(report.artifacts.map(({ artifactId, status }) => ({ artifactId, status }))).toEqual([
      { artifactId: "node-basic-summary", status: "found" },
      { artifactId: "node-basic-source", status: "found" },
    ]);
    expect(report.claimVerdicts.map(({ status }) => status)).toEqual([
      "VERIFIED",
      "VERIFIED",
    ]);
  });

  it("renders readable Markdown for node-basic", async () => {
    const result = await evaluateCli([
      ...nodeBasicArgs,
      "--format",
      "markdown",
      "--exit-zero",
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("# AgentForge QA Verification Report");
    expect(result.stdout).toContain("## Artifacts");
    expect(result.stdout).toContain("Node basic summary artifact");
    expect(result.stdout).toContain("## Claims");
    expect(result.stdout).toContain("Generated examples/node-basic/artifacts/summary.txt");
  });

  it("keeps demo-blocked conservative for a missing demo-critical artifact", async () => {
    const result = await evaluateCli([...demoBlockedArgs, "--format", "json"]);
    const report = parseReport(result.stdout);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("");
    expect(report.toolStatus).toBe("OK");
    expect(report.finalVerdict).toBe("DEMO_BLOCKED");
    expect(report.artifacts).toEqual([
      expect.objectContaining({
        artifactId: "demo-summary",
        demoCritical: true,
        status: "missing",
      }),
    ]);
    expect(report.risks).toContainEqual(
      expect.objectContaining({
        category: "missing_artifact",
        severity: "critical",
        blocksVerdict: true,
      }),
    );
  });

  it("documents runnable demo commands without internal workflow wording", async () => {
    const docsFiles = (await listFiles(resolve(repositoryRoot, "docs"))).map((path) =>
      relative(repositoryRoot, path).replaceAll("\\", "/"),
    );
    const publicDocPaths = [
      "README.md",
      "tests/smoke/README.md",
      "examples/node-basic/README.md",
      "examples/demo-blocked/README.md",
      "examples/ml-demo/README.md",
      "packages/schemas/README.md",
      "packages/reporters/README.md",
      ...docsFiles,
    ];
    const runnableCommandDocPaths = new Set([
      "README.md",
      "docs/demo.md",
      "tests/smoke/README.md",
      "examples/node-basic/README.md",
      "examples/demo-blocked/README.md",
    ]);
    const forbiddenPhrases = [
      "Pr" + "ompt 9",
      "Pr" + "ompt 8.2",
      "Pr" + "ompt 8.1",
      "Pr" + "ompt 8",
      "Pr" + "ompt 7",
      "Pr" + "ompt",
      "Co" + "dex",
      "Chat" + "GPT",
      "uploaded " + "guidance",
      "validation " + "pack",
      "vibe " + "coding",
      "this " + "chat",
      "agent " + "prompt",
      "private task " + "guidance",
      "AI agent " + "wrote",
      "AI-generated " + "workflow",
    ];

    for (const path of [...new Set(publicDocPaths)].sort()) {
      const text = await readFile(resolve(repositoryRoot, path), "utf8");
      const publicSurface = `${path}\n${text}`;

      if (runnableCommandDocPaths.has(path)) {
        expect(text).toContain("node packages/cli/dist/index.js verify");
      }

      for (const phrase of forbiddenPhrases) {
        expect(publicSurface).not.toMatch(new RegExp(phrase, "i"));
      }
    }
  });

  it("keeps examples local-only and free of generated report files", async () => {
    const files = await readExampleFiles();
    const forbiddenPathSegments = [
      "/.agentforge/",
      "/node_modules/",
      "/dist/",
      "/coverage/",
    ];
    const forbiddenContentPatterns = [
      /https?:\/\//i,
      /\bcurl\b/i,
      /\bwget\b/i,
      /\bfetch\s*\(/i,
      /authorization:\s*bearer/i,
      /sk-[A-Za-z0-9]{12,}/,
      /BEGIN [A-Z ]*PRIVATE KEY/,
      /postinstall/i,
      /preinstall/i,
    ];

    expect(files.map(({ path }) => path).sort()).toContain(
      "examples/node-basic/agentforge.config.json",
    );

    for (const { path, text } of files) {
      expect(path).not.toMatch(/(?:^|\/)\.env(?:\.|$)/);
      expect(path).not.toMatch(/(?:^|\/).*\.log$/);
      expect(path).not.toMatch(/(?:^|\/).*\.tgz$/);
      expect(path).not.toMatch(/(?:^|\/)report\.(?:md|json)$/);

      for (const segment of forbiddenPathSegments) {
        expect(`/${path}`).not.toContain(segment);
      }

      for (const pattern of forbiddenContentPatterns) {
        expect(text, path).not.toMatch(pattern);
      }
    }
  });
});

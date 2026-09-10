import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { VerificationReportSchema } from "@agentforge-qa/schemas";
import { afterEach, describe, expect, it } from "vitest";

import { runVerification } from "./run-verification.js";

const temporaryRoots: string[] = [];

async function createRoot(git = false): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "agentforge-pipeline-"));
  temporaryRoots.push(root);

  if (git) {
    await runGit(root, ["init"]);
  }

  return root;
}

async function runGit(cwd: string, args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn("git", args, {
      cwd,
      shell: false,
      stdio: "ignore",
      windowsHide: true,
    });

    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`git ${args[0] ?? ""} exited with ${code}`));
      }
    });
  });
}

async function writeConfig(
  root: string,
  command: { args: string[]; command: string } = {
    command: "node",
    args: ["--version"],
  },
  artifactPath = "report.txt",
  demoCritical = false,
): Promise<void> {
  await writeFile(
    join(root, "agentforge.config.json"),
    JSON.stringify({
      schemaVersion: "0.1.0",
      commands: [
        {
          id: "test",
          label: "Run tests",
          command: command.command,
          args: command.args,
          required: true,
          timeoutMs: 10_000,
        },
      ],
      artifacts: [
        {
          id: "report",
          label: "QA report",
          path: artifactPath,
          type: "file",
          required: true,
          demoCritical,
          claimKeywords: ["report"],
        },
      ],
    }),
  );
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) =>
      rm(root, { recursive: true, force: true }),
    ),
  );
});

describe("runVerification", () => {
  it("returns valid conservative evidence for an empty non-Git directory", async () => {
    const report = await runVerification({ cwd: await createRoot() });

    expect(VerificationReportSchema.safeParse(report).success).toBe(true);
    expect(report.toolStatus).toBe("OK");
    expect(report.finalVerdict).toBe("NEEDS_REVIEW");
    expect(report.commands).toEqual([]);
    expect(report.artifacts).toEqual([]);
    expect(report.risks.some(({ category }) => category === "unsupported_repo")).toBe(
      true,
    );
    expect(report.summary).toContain("No AgentForge QA JSON config");
    expect(report.summary).toContain("No claim file was provided");
  });

  it("returns a controlled tool error for invalid config and invalid requests", async () => {
    const root = await createRoot();
    await writeFile(join(root, "agentforge.config.json"), "{");

    const invalidConfig = await runVerification({ cwd: root });
    const invalidRequest = await runVerification({});

    expect(() => VerificationReportSchema.parse(invalidConfig)).not.toThrow();
    expect(() => VerificationReportSchema.parse(invalidRequest)).not.toThrow();
    expect(invalidConfig.toolStatus).toBe("TOOL_ERROR");
    expect(invalidConfig.errors?.[0]?.code).toBe("INVALID_CONFIG_JSON");
    expect(invalidRequest.toolStatus).toBe("TOOL_ERROR");
    expect(invalidRequest.errors?.[0]?.code).toBe("INVALID_REQUEST");
  });

  it("requires explicit execution approval before running configured commands", async () => {
    const root = await createRoot(true);
    await writeConfig(root);
    await writeFile(join(root, "report.txt"), "verified report");

    const report = await runVerification({ cwd: root });

    expect(VerificationReportSchema.safeParse(report).success).toBe(true);
    expect(report.commands[0]?.status).toBe("skipped");
    expect(report.commands[0]?.reason).toContain("Dry run");
    expect(report.finalVerdict).toBe("NEEDS_REVIEW");
  });

  it("runs configured safe commands and can return SAFE_TO_CONTINUE with explicit execution approval and complete evidence", async () => {
    const root = await createRoot(true);
    await writeConfig(root);
    await writeFile(join(root, "report.txt"), "verified report");
    await writeFile(join(root, "claims.md"), "- Tests passed\n- Generated report.txt");

    const report = await runVerification({
      cwd: root,
      claimFile: "claims.md",
      dryRun: false,
    });

    expect(VerificationReportSchema.safeParse(report).success).toBe(true);
    expect(report.toolStatus).toBe("OK");
    expect(report.commands[0]?.status).toBe("passed");
    expect(report.artifacts[0]?.status).toBe("found");
    expect(report.claimVerdicts.map(({ status }) => status)).toEqual([
      "VERIFIED",
      "VERIFIED",
    ]);
    expect(report.finalVerdict).toBe("SAFE_TO_CONTINUE");
  });

  it("skips dry runs and unsafe configured commands with risks", async () => {
    const dryRunRoot = await createRoot(true);
    await writeConfig(dryRunRoot);
    await writeFile(join(dryRunRoot, "report.txt"), "report");

    const dryRunReport = await runVerification({
      cwd: dryRunRoot,
      dryRun: true,
    });

    expect(() => VerificationReportSchema.parse(dryRunReport)).not.toThrow();
    expect(dryRunReport.commands[0]?.status).toBe("skipped");
    expect(dryRunReport.finalVerdict).toBe("NEEDS_REVIEW");

    const unsafeRoot = await createRoot(true);
    await writeConfig(unsafeRoot, { command: "rm", args: ["-rf", "."] });
    await writeFile(join(unsafeRoot, "report.txt"), "report");

    const unsafeReport = await runVerification({
      cwd: unsafeRoot,
      dryRun: false,
    });

    expect(() => VerificationReportSchema.parse(unsafeReport)).not.toThrow();
    expect(unsafeReport.commands[0]?.status).toBe("skipped");
    expect(unsafeReport.risks.some(({ category }) => category === "safety_skip")).toBe(
      true,
    );
    expect(unsafeReport.finalVerdict).toBe("NEEDS_REVIEW");
  });

  it("uses conservative failed-command and demo-critical verdicts", async () => {
    const failedRoot = await createRoot(true);
    await writeConfig(failedRoot, {
      command: "node",
      args: ["-e", "process.exit(2)"],
    });
    await writeFile(join(failedRoot, "report.txt"), "report");

    const failedReport = await runVerification({ cwd: failedRoot, dryRun: false });

    expect(() => VerificationReportSchema.parse(failedReport)).not.toThrow();
    expect(failedReport.finalVerdict).toBe("UNSAFE_TO_PUSH");

    const blockedRoot = await createRoot(true);
    await writeConfig(blockedRoot, undefined, "missing.txt", true);

    const blockedReport = await runVerification({
      cwd: blockedRoot,
      dryRun: false,
    });

    expect(() => VerificationReportSchema.parse(blockedReport)).not.toThrow();
    expect(blockedReport.finalVerdict).toBe("DEMO_BLOCKED");
  });

  it("keeps unmatched evidence claims conservative and schema-valid", async () => {
    const root = await createRoot(true);
    await writeConfig(root);
    await writeFile(join(root, "report.txt"), "verified report");
    await writeFile(join(root, "claims.md"), "- Generated release.zip");

    const report = await runVerification({
      cwd: root,
      claimFile: "claims.md",
      dryRun: false,
    });

    expect(() => VerificationReportSchema.parse(report)).not.toThrow();
    expect(report.claimVerdicts[0]?.status).toBe("UNVERIFIED");
    expect(report.claimVerdicts[0]?.matchedEvidenceIds).toEqual([]);
    expect(report.finalVerdict).toBe("NEEDS_REVIEW");
  });

  it("fails closed when deterministic claim parsing is incomplete", async () => {
    const root = await createRoot(true);
    await writeConfig(root);
    await writeFile(join(root, "report.txt"), "verified report");
    await writeFile(
      join(root, "claims.md"),
      Array.from({ length: 501 }, (_, index) => `- Claim ${index + 1}`).join(
        "\n",
      ),
    );

    const report = await runVerification({
      cwd: root,
      claimFile: "claims.md",
      dryRun: false,
    });

    expect(() => VerificationReportSchema.parse(report)).not.toThrow();
    expect(report.toolStatus).toBe("TOOL_ERROR");
    expect(report.errors?.[0]?.code).toBe("CLAIM_LIMIT_EXCEEDED");
    expect(report.finalVerdict).toBe("NEEDS_REVIEW");
  });

  it("rejects a claim file that escapes the repository", async () => {
    const root = await createRoot();
    const report = await runVerification({ cwd: root, claimFile: "../claims.md" });

    expect(() => VerificationReportSchema.parse(report)).not.toThrow();
    expect(report.toolStatus).toBe("TOOL_ERROR");
    expect(report.finalVerdict).toBe("NEEDS_REVIEW");
    expect(report.errors?.[0]?.code).toBe("CLAIM_FILE_OUTSIDE_REPO");
  });
});

describe("production regression fixtures", () => {
  it("keeps a directly linked persistence claim from staying verified when its required command fails", async () => {
    const root = await createRoot(true);
    await writeFile(
      join(root, "agentforge.config.json"),
      JSON.stringify({
        schemaVersion: "0.1.0",
        commands: [
          {
            id: "todo-baseline",
            label: "Todo persistence baseline",
            command: "node",
            args: ["-e", "process.exit(1)"],
            required: true,
            timeoutMs: 10_000,
            claimKeywords: ["local storage", "saves and loads tasks"],
          },
        ],
        artifacts: [
          {
            id: "script",
            label: "Todo script",
            path: "script.js",
            type: "file",
            required: true,
            claimKeywords: ["local storage", "saves and loads tasks"],
          },
        ],
      }),
    );
    await writeFile(join(root, "script.js"), "localStorage.setItem('tasks', '[]')");
    await writeFile(
      join(root, "CLAIMS.md"),
      "- The application saves and loads tasks using local storage.",
    );

    const report = await runVerification({
      cwd: root,
      claimFile: "CLAIMS.md",
      dryRun: false,
    });

    expect(report.commands[0]?.status).toBe("failed");
    expect(report.claimVerdicts[0]?.status).toBe("CONTRADICTED");
    expect(report.finalVerdict).toBe("UNSAFE_TO_PUSH");
    expect(report.decisionSummary.nextAction).toContain("todo-baseline");
  });

  it("makes a missing required style artifact unsafe instead of review-only", async () => {
    const root = await createRoot(true);
    await writeFile(
      join(root, "agentforge.config.json"),
      JSON.stringify({
        schemaVersion: "0.1.0",
        commands: [
          {
            id: "syntax",
            label: "Syntax check",
            command: "node",
            args: ["--version"],
            required: true,
            timeoutMs: 10_000,
          },
        ],
        artifacts: [
          {
            id: "styles",
            label: "Application styles",
            path: "style.css",
            type: "file",
            required: true,
            claimKeywords: ["styling", "styled"],
          },
        ],
      }),
    );
    await writeFile(
      join(root, "CLAIMS.md"),
      "- The application styling is complete.",
    );

    const report = await runVerification({
      cwd: root,
      claimFile: "CLAIMS.md",
      dryRun: false,
    });

    expect(report.commands[0]?.status).toBe("passed");
    expect(report.artifacts[0]?.status).toBe("missing");
    expect(report.claimVerdicts[0]?.status).toBe("CONTRADICTED");
    expect(report.finalVerdict).toBe("UNSAFE_TO_PUSH");
    expect(report.decisionSummary.artifacts.requiredMissing).toBe(1);
  });
});

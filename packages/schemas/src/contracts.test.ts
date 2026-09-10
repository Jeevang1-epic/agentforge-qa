import { describe, expect, it } from "vitest";

import {
  ArtifactResultSchema,
  ClaimSchema,
  ClaimVerdictSchema,
  CommandPlanSchema,
  CommandResultSchema,
  GitEvidenceSchema,
  PipelineErrorSchema,
  RepoProfileSchema,
} from "./index.js";

describe("evidence and error contracts", () => {
  it("parses a valid repository profile", () => {
    expect(
      RepoProfileSchema.parse({
        root: "/workspace/repo",
        isGitRepo: true,
        packageManager: "pnpm",
        detectedFrameworks: ["node"],
        notes: ["Foundation only"],
      }),
    ).toMatchObject({ isGitRepo: true });
  });

  it("parses valid git evidence", () => {
    expect(
      GitEvidenceSchema.parse({
        since: "main",
        changedFiles: ["packages/schemas/src/index.ts"],
        untrackedFiles: [],
        deletedFiles: [],
        dependencyFilesChanged: ["pnpm-lock.yaml"],
        summary: "Schema package changed.",
      }),
    ).toMatchObject({ since: "main" });
  });

  it("parses a valid command plan and rejects a plan without args", () => {
    const validPlan = {
      id: "test",
      label: "Run tests",
      command: "pnpm",
      args: ["test"],
      required: true,
      timeoutMs: 120_000,
      cwd: "/workspace/repo",
    };

    expect(CommandPlanSchema.parse(validPlan)).toEqual(validPlan);
    expect(
      CommandPlanSchema.safeParse({
        ...validPlan,
        args: undefined,
      }).success,
    ).toBe(false);
  });

  it("parses a valid command result", () => {
    expect(
      CommandResultSchema.parse({
        id: "cmd:test",
        planId: "test",
        status: "passed",
        exitCode: 0,
        durationMs: 250,
      }),
    ).toMatchObject({ status: "passed" });
  });

  it("parses a valid artifact result", () => {
    expect(
      ArtifactResultSchema.parse({
        id: "artifact:report",
        artifactId: "report",
        label: "QA report",
        path: ".agentforge/qa-report.md",
        type: "file",
        required: true,
        status: "found",
        matchedPaths: [".agentforge/qa-report.md"],
        sizeBytes: 512,
      }),
    ).toMatchObject({ status: "found" });
  });

  it("parses a valid claim and claim verdict", () => {
    const claim = ClaimSchema.parse({
      id: "claim:tests-pass",
      text: "All tests pass.",
      source: "codex-summary.md",
      lineStart: 1,
      lineEnd: 1,
    });
    const verdict = ClaimVerdictSchema.parse({
      id: "claim-verdict:tests-pass",
      claimId: claim.id,
      status: "VERIFIED",
      matchedEvidenceIds: ["cmd:test"],
    });

    expect(verdict.status).toBe("VERIFIED");
  });

  it("parses a valid pipeline error", () => {
    expect(
      PipelineErrorSchema.parse({
        id: "error:config",
        message: "Config could not be loaded.",
        code: "CONFIG_LOAD_FAILED",
        details: { configPath: "agentforge.config.json" },
        causedBy: "ENOENT",
      }),
    ).toMatchObject({ code: "CONFIG_LOAD_FAILED" });
  });
});

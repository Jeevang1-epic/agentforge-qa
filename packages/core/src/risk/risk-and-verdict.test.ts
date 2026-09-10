import {
  ArtifactResultSchema,
  ClaimVerdictSchema,
  CommandResultSchema,
  GitEvidenceSchema,
  NormalizedConfigSchema,
  RepoProfileSchema,
  type ArtifactResult,
  type CommandResult,
} from "@agentforge-qa/schemas";
import { describe, expect, it } from "vitest";

import type { CollectedGitEvidence } from "../git/collect-git-evidence.js";
import { determineVerdict } from "../verdict/determine-verdict.js";
import { assessRisks } from "./assess-risks.js";
import { calculateRiskScore } from "./calculate-risk-score.js";

const config = NormalizedConfigSchema.parse({
  schemaVersion: "0.1.0",
  commands: [
    {
      id: "test",
      label: "Run tests",
      command: "pnpm",
      args: ["test"],
      required: true,
      timeoutMs: 30_000,
    },
  ],
  artifacts: [
    {
      id: "report",
      label: "Report",
      path: "report.txt",
      type: "file",
      required: true,
      demoCritical: true,
    },
  ],
});
const repo = RepoProfileSchema.parse({
  root: "/repo",
  isGitRepo: true,
  detectedFrameworks: [],
});
const git: CollectedGitEvidence = {
  evidence: GitEvidenceSchema.parse({
    changedFiles: [],
    untrackedFiles: [],
    deletedFiles: [],
    dependencyFilesChanged: [],
    summary: "Clean read-only Git evidence.",
  }),
  evidenceId: "git:status",
  status: "collected",
};

function command(status: CommandResult["status"]): CommandResult {
  return CommandResultSchema.parse({
    id: "command:test",
    planId: "test",
    status,
    ...(status === "passed" ? { exitCode: 0 } : {}),
    ...(status === "skipped" ? { reason: "Dry run mode; command not executed." } : {}),
  });
}

function artifact(
  status: ArtifactResult["status"],
  demoCritical = true,
): ArtifactResult {
  return ArtifactResultSchema.parse({
    id: "artifact:report",
    artifactId: "report",
    label: "Report",
    path: "report.txt",
    type: "file",
    required: true,
    demoCritical,
    status,
    matchedPaths: status === "found" ? ["report.txt"] : [],
  });
}

describe("risk scoring and verdict", () => {
  it("makes a failed required command unsafe to push", () => {
    const commands = [command("failed")];
    const artifacts = [artifact("found")];
    const risks = assessRisks({
      artifactResults: artifacts,
      claimVerdicts: [],
      commandResults: commands,
      config,
      git,
      repo,
    });

    expect(risks.some(({ category }) => category === "command_failure")).toBe(
      true,
    );
    expect(risks.every(({ evidenceIds }) => evidenceIds.length > 0)).toBe(true);
    expect(
      determineVerdict({
        artifacts,
        claimVerdicts: [],
        commands,
        risks,
        toolStatus: "OK",
      }),
    ).toBe("UNSAFE_TO_PUSH");
  });

  it("makes a missing demo-critical artifact block the demo", () => {
    const commands = [command("passed")];
    const artifacts = [artifact("missing")];
    const risks = assessRisks({
      artifactResults: artifacts,
      claimVerdicts: [],
      commandResults: commands,
      config,
      git,
      repo,
    });

    expect(calculateRiskScore(risks).severity).toBe("critical");
    expect(
      determineVerdict({
        artifacts,
        claimVerdicts: [],
        commands,
        risks,
        toolStatus: "OK",
      }),
    ).toBe("DEMO_BLOCKED");
  });

  it("never marks no evidence safe and permits clean configured evidence", () => {
    expect(
      determineVerdict({
        artifacts: [],
        claimVerdicts: [],
        commands: [],
        risks: [],
        toolStatus: "OK",
      }),
    ).toBe("NEEDS_REVIEW");

    expect(
      determineVerdict({
        artifacts: [artifact("found")],
        claimVerdicts: [],
        commands: [command("passed")],
        risks: [],
        toolStatus: "OK",
      }),
    ).toBe("SAFE_TO_CONTINUE");
  });

  it("never marks skipped, timed-out, errored, missing, or tool-error evidence safe", () => {
    for (const status of ["skipped", "timed_out", "error"] as const) {
      expect(
        determineVerdict({
          artifacts: [artifact("found")],
          claimVerdicts: [],
          commands: [command(status)],
          risks: [],
          toolStatus: "OK",
        }),
      ).toBe("NEEDS_REVIEW");
    }

    const missingArtifacts = [artifact("missing", false)];
    const missingRisks = assessRisks({
      artifactResults: missingArtifacts,
      claimVerdicts: [],
      commandResults: [command("passed")],
      config,
      git,
      repo,
    });

    expect(
      determineVerdict({
        artifacts: missingArtifacts,
        claimVerdicts: [],
        commands: [command("passed")],
        risks: missingRisks,
        toolStatus: "OK",
      }),
    ).toBe("UNSAFE_TO_PUSH");
    expect(missingRisks.every(({ evidenceIds }) => evidenceIds.length > 0)).toBe(
      true,
    );
    expect(
      determineVerdict({
        artifacts: [artifact("found")],
        claimVerdicts: [],
        commands: [command("passed")],
        risks: [],
        toolStatus: "TOOL_ERROR",
      }),
    ).toBe("NEEDS_REVIEW");
  });

  it.each([
    ["failed required command", [command("failed")], [artifact("found")], [], "UNSAFE_TO_PUSH"],
    ["missing required artifact", [command("passed")], [artifact("missing", false)], [], "UNSAFE_TO_PUSH"],
    ["dry-run command", [command("skipped")], [artifact("found")], [], "NEEDS_REVIEW"],
  ] as const)(
    "locks verdict precedence for %s",
    (_label, commands, artifacts, claimVerdicts, expected) => {
      const risks = assessRisks({
        artifactResults: artifacts,
        claimVerdicts,
        commandResults: commands,
        config,
        git,
        repo,
      });

      expect(determineVerdict({
        artifacts,
        claimVerdicts,
        commands,
        risks,
        toolStatus: "OK",
      })).toBe(expected);
    },
  );

  it("makes directly contradicted claim evidence unsafe to push", () => {
    const claimVerdicts = ClaimVerdictSchema.array().parse([
      {
        id: "claim-verdict:persistence",
        claimId: "claim:persistence",
        status: "CONTRADICTED",
        matchedEvidenceIds: ["command:test"],
      },
    ]);

    expect(determineVerdict({
      artifacts: [artifact("found")],
      claimVerdicts,
      commands: [command("passed")],
      risks: [],
      toolStatus: "OK",
    })).toBe("UNSAFE_TO_PUSH");
  });
});

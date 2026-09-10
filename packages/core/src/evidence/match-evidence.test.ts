import {
  ArtifactResultSchema,
  ClaimSchema,
  CommandResultSchema,
  NormalizedConfigSchema,
} from "@agentforge-qa/schemas";
import { describe, expect, it } from "vitest";

import { matchEvidence } from "./match-evidence.js";

describe("matchEvidence", () => {
  it("verifies matching command/artifact claims without falsely verifying unmatched claims", () => {
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
          label: "QA report",
          path: "report.txt",
          type: "file",
          required: true,
          claimKeywords: ["report"],
        },
        {
          id: "plot",
          label: "Accuracy plot",
          path: "plot.png",
          type: "file",
          required: true,
          claimKeywords: ["plot"],
        },
      ],
    });
    const claims = ClaimSchema.array().parse([
      { id: "claim:1", text: "Tests passed", source: "claims.md" },
      { id: "claim:2", text: "Generated report.txt", source: "claims.md" },
      { id: "claim:3", text: "Generated plot.png", source: "claims.md" },
      { id: "claim:4", text: "Improved maintainability", source: "claims.md" },
      { id: "claim:5", text: "Contest results improved", source: "claims.md" },
    ]);
    const commands = CommandResultSchema.array().parse([
      { id: "command:test", planId: "test", status: "passed", exitCode: 0 },
    ]);
    const artifacts = ArtifactResultSchema.array().parse([
      {
        id: "artifact:report",
        artifactId: "report",
        label: "QA report",
        path: "report.txt",
        type: "file",
        required: true,
        status: "found",
        matchedPaths: ["report.txt"],
      },
      {
        id: "artifact:plot",
        artifactId: "plot",
        label: "Accuracy plot",
        path: "plot.png",
        type: "file",
        required: true,
        status: "missing",
        matchedPaths: [],
      },
    ]);

    const verdicts = matchEvidence(claims, config, commands, artifacts);

    expect(verdicts.map(({ status }) => status)).toEqual([
      "VERIFIED",
      "VERIFIED",
      "CONTRADICTED",
      "NOT_CHECKED",
      "NOT_CHECKED",
    ]);
    expect(verdicts[0]?.matchedEvidenceIds).toEqual(["command:test"]);
    expect(verdicts[1]?.matchedEvidenceIds).toEqual(["artifact:report"]);
    expect(verdicts[4]?.matchedEvidenceIds).toEqual([]);
  });

  it.each([
    ["passed", "VERIFIED"],
    ["failed", "CONTRADICTED"],
    ["skipped", "PARTIALLY_VERIFIED"],
  ] as const)(
    "uses explicitly linked required command evidence when it is %s",
    (commandStatus, expectedStatus) => {
      const config = NormalizedConfigSchema.parse({
        schemaVersion: "0.1.0",
        commands: [
          {
            id: "todo-baseline",
            label: "Todo persistence baseline",
            command: "node",
            args: ["test-persistence.js"],
            required: true,
            timeoutMs: 30_000,
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
      });
      const claims = ClaimSchema.array().parse([
        {
          id: "claim:persistence",
          text: "The application saves and loads tasks using local storage.",
          source: "CLAIMS.md",
        },
      ]);
      const commands = CommandResultSchema.array().parse([
        {
          id: "command:todo-baseline",
          planId: "todo-baseline",
          status: commandStatus,
          ...(commandStatus === "passed" ? { exitCode: 0 } : {}),
        },
      ]);
      const artifacts = ArtifactResultSchema.array().parse([
        {
          id: "artifact:script",
          artifactId: "script",
          label: "Todo script",
          path: "script.js",
          type: "file",
          required: true,
          status: "found",
          matchedPaths: ["script.js"],
        },
      ]);

      expect(matchEvidence(claims, config, commands, artifacts)[0]).toMatchObject({
        status: expectedStatus,
        matchedEvidenceIds: ["command:todo-baseline", "artifact:script"],
      });
    },
  );

  it("does not link an unrelated failed command to a claim", () => {
    const config = NormalizedConfigSchema.parse({
      schemaVersion: "0.1.0",
      commands: [
        {
          id: "lint",
          label: "Lint styles",
          command: "node",
          args: ["lint.js"],
          required: true,
          timeoutMs: 30_000,
          claimKeywords: ["styling"],
        },
      ],
      artifacts: [
        {
          id: "script",
          label: "Todo script",
          path: "script.js",
          type: "file",
          required: true,
          claimKeywords: ["local storage"],
        },
      ],
    });
    const claims = ClaimSchema.array().parse([
      {
        id: "claim:persistence",
        text: "Tasks use local storage.",
        source: "CLAIMS.md",
      },
    ]);
    const commands = CommandResultSchema.array().parse([
      { id: "command:lint", planId: "lint", status: "failed", exitCode: 1 },
    ]);
    const artifacts = ArtifactResultSchema.array().parse([
      {
        id: "artifact:script",
        artifactId: "script",
        label: "Todo script",
        path: "script.js",
        type: "file",
        required: true,
        status: "found",
        matchedPaths: ["script.js"],
      },
    ]);

    expect(matchEvidence(claims, config, commands, artifacts)[0]).toMatchObject({
      status: "VERIFIED",
      matchedEvidenceIds: ["artifact:script"],
    });
  });
});

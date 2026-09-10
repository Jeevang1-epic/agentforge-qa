import { describe, expect, it } from "vitest";

import {
  ArtifactResultSchema,
  ClaimSchema,
  CommandResultSchema,
  ConfigArtifactSchema,
  ConfigCommandSchema,
  CommandPlanSchema,
  NormalizedConfigSchema,
  RiskFindingSchema,
  RiskScoreSummarySchema,
  sampleNormalizedConfig,
  sampleRiskFinding,
  sampleRiskScoreSummary,
  sampleSafeReport,
  VerificationReportSchema,
  VerificationRequestSchema,
} from "./index.js";

const validRequest = {
  cwd: "/workspace/agentforge-qa",
  mode: "local",
} as const;

describe("key public schema safeParse behavior", () => {
  it("returns success and failure for NormalizedConfigSchema", () => {
    expect(NormalizedConfigSchema.safeParse(sampleNormalizedConfig).success).toBe(
      true,
    );
    expect(
      NormalizedConfigSchema.safeParse({
        ...sampleNormalizedConfig,
        schemaVersion: "invalid",
      }).success,
    ).toBe(false);
  });

  it("returns success and failure for VerificationRequestSchema", () => {
    expect(VerificationRequestSchema.safeParse(validRequest).success).toBe(true);
    expect(
      VerificationRequestSchema.safeParse({
        ...validRequest,
        mode: "remote",
      }).success,
    ).toBe(false);
  });

  it("returns success and failure for RiskFindingSchema", () => {
    expect(RiskFindingSchema.safeParse(sampleRiskFinding).success).toBe(true);
    expect(
      RiskFindingSchema.safeParse({
        ...sampleRiskFinding,
        evidenceIds: [],
      }).success,
    ).toBe(false);
  });

  it("returns success and failure for RiskScoreSummarySchema", () => {
    expect(RiskScoreSummarySchema.safeParse(sampleRiskScoreSummary).success).toBe(
      true,
    );
    expect(
      RiskScoreSummarySchema.safeParse({
        ...sampleRiskScoreSummary,
        score: 101,
      }).success,
    ).toBe(false);
  });

  it("returns success and failure for VerificationReportSchema", () => {
    expect(VerificationReportSchema.safeParse(sampleSafeReport).success).toBe(
      true,
    );
    expect(
      VerificationReportSchema.safeParse({
        ...sampleSafeReport,
        toolStatus: "FAILED",
      }).success,
    ).toBe(false);
  });
});

describe("negative contract hardening", () => {
  it("rejects invalid command and artifact statuses", () => {
    expect(
      CommandResultSchema.safeParse({
        id: "cmd:test",
        planId: "test",
        status: "unknown",
      }).success,
    ).toBe(false);
    expect(
      ArtifactResultSchema.safeParse({
        id: "artifact:report",
        artifactId: "report",
        label: "QA report",
        path: ".agentforge/qa-report.md",
        type: "file",
        required: true,
        status: "unknown",
        matchedPaths: [],
      }).success,
    ).toBe(false);
  });

  it("rejects non-positive command timeouts", () => {
    const configCommand = {
      id: "test",
      label: "Run tests",
      command: "pnpm",
      args: ["test"],
      required: true,
      timeoutMs: 1,
    };
    const commandPlan = {
      ...configCommand,
      cwd: "/workspace/agentforge-qa",
    };

    for (const timeoutMs of [0, -1]) {
      expect(
        ConfigCommandSchema.safeParse({ ...configCommand, timeoutMs }).success,
      ).toBe(false);
      expect(
        CommandPlanSchema.safeParse({ ...commandPlan, timeoutMs }).success,
      ).toBe(false);
    }
  });

  it("rejects negative artifact size requirements", () => {
    expect(
      ConfigArtifactSchema.safeParse({
        id: "report",
        label: "QA report",
        path: ".agentforge/qa-report.md",
        type: "file",
        required: true,
        minSizeBytes: -1,
      }).success,
    ).toBe(false);
  });

  it("rejects an empty claim and reversed line range", () => {
    const claim = {
      id: "claim:tests",
      text: "Tests pass.",
      source: "summary.md",
    };

    expect(ClaimSchema.safeParse({ ...claim, text: "" }).success).toBe(false);
    expect(
      ClaimSchema.safeParse({
        ...claim,
        lineStart: 10,
        lineEnd: 9,
      }).success,
    ).toBe(false);
    expect(
      ClaimSchema.safeParse({
        ...claim,
        lineStart: 10,
        lineEnd: 10,
      }).success,
    ).toBe(true);
  });

  it("rejects negative command result durations", () => {
    expect(
      CommandResultSchema.safeParse({
        id: "cmd:test",
        planId: "test",
        status: "passed",
        durationMs: -1,
      }).success,
    ).toBe(false);
  });

  it("rejects unknown fields on stable contract objects", () => {
    expect(
      VerificationRequestSchema.safeParse({
        ...validRequest,
        unexpected: true,
      }).success,
    ).toBe(false);
    expect(
      RiskFindingSchema.safeParse({
        ...sampleRiskFinding,
        unexpected: true,
      }).success,
    ).toBe(false);
    expect(
      VerificationReportSchema.safeParse({
        ...sampleSafeReport,
        unexpected: true,
      }).success,
    ).toBe(false);
  });
});

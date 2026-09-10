import {
  ArtifactResultSchema,
  ClaimSchema,
  ClaimVerdictSchema,
  CommandResultSchema,
  PipelineErrorSchema,
  RiskFindingSchema,
  RiskScoreSummarySchema,
  sampleNormalizedConfig,
  sampleSafeReport,
} from "@agentforge-qa/schemas";
import { describe, expect, it } from "vitest";

import { buildDecisionSummary } from "./build-decision-summary.js";

function safeInputs() {
  return {
    artifacts: sampleSafeReport.artifacts,
    claims: sampleSafeReport.claims,
    claimVerdicts: sampleSafeReport.claimVerdicts,
    commands: sampleSafeReport.commands,
    config: sampleNormalizedConfig,
    finalVerdict: "SAFE_TO_CONTINUE" as const,
    risks: sampleSafeReport.risks,
    riskScore: sampleSafeReport.riskScore,
  };
}

describe("buildDecisionSummary", () => {
  it("calculates a clean SAFE_TO_CONTINUE summary", () => {
    expect(buildDecisionSummary(safeInputs())).toEqual(
      sampleSafeReport.decisionSummary,
    );
  });

  it("handles zero configured commands and zero claims deterministically", () => {
    const summary = buildDecisionSummary({
      ...safeInputs(),
      commands: [],
    });

    expect(summary.commands).toEqual({
      total: 0,
      passed: 0,
      failed: 0,
      skipped: 0,
    });
    expect(summary.claims).toEqual({
      total: 0,
      verified: 0,
      contradicted: 0,
      reviewRequired: 0,
    });
  });

  it("prioritizes a failed required command over other blocking evidence", () => {
    const failedCommand = CommandResultSchema.parse({
      id: "command:test",
      planId: "test",
      status: "failed",
      exitCode: 1,
    });
    const missingArtifact = ArtifactResultSchema.parse({
      ...sampleSafeReport.artifacts[0],
      status: "missing",
      matchedPaths: [],
    });
    const risk = RiskFindingSchema.parse({
      id: "risk:command-failure:test",
      category: "command_failure",
      severity: "error",
      title: "Configured command did not pass",
      description: "The required command failed.",
      evidenceIds: [failedCommand.id],
      blocksVerdict: true,
    });
    const riskScore = RiskScoreSummarySchema.parse({
      schemaVersion: "0.1.0",
      score: 35,
      severity: "high",
      blockingRiskIds: [risk.id],
      warningRiskIds: [],
    });
    const summary = buildDecisionSummary({
      ...safeInputs(),
      artifacts: [missingArtifact],
      commands: [failedCommand],
      finalVerdict: "UNSAFE_TO_PUSH",
      risks: [risk],
      riskScore,
    });

    expect(summary.commands).toMatchObject({ failed: 1, passed: 0 });
    expect(summary.artifacts.requiredMissing).toBe(1);
    expect(summary.nextAction).toBe(
      'Fix the failed required command "test" before pushing.',
    );
  });

  it("identifies missing artifacts, contradicted claims, and skipped commands", () => {
    const missingArtifact = ArtifactResultSchema.parse({
      ...sampleSafeReport.artifacts[0],
      path: "style.css",
      status: "missing",
      matchedPaths: [],
    });
    const claim = ClaimSchema.parse({
      id: "claim:style",
      text: "The application is styled.",
      source: "CLAIMS.md",
    });
    const contradicted = ClaimVerdictSchema.parse({
      id: "claim-verdict:style",
      claimId: claim.id,
      status: "CONTRADICTED",
      matchedEvidenceIds: [missingArtifact.id],
    });
    const skipped = CommandResultSchema.parse({
      id: "command:test",
      planId: "test",
      status: "skipped",
      reason: "Dry run mode.",
    });

    expect(buildDecisionSummary({
      ...safeInputs(),
      artifacts: [missingArtifact],
      claims: [claim],
      claimVerdicts: [contradicted],
      commands: [skipped],
      finalVerdict: "UNSAFE_TO_PUSH",
    }).nextAction).toBe(
      'Restore the required artifact "style.css" and run verification again.',
    );

    expect(buildDecisionSummary({
      ...safeInputs(),
      commands: [skipped],
      finalVerdict: "NEEDS_REVIEW",
    }).nextAction).toBe("Run configured verification commands with --run.");
  });

  it("counts multiple blocking and warning risks", () => {
    const risks = RiskFindingSchema.array().parse([
      {
        id: "risk:blocking",
        category: "missing_artifact",
        severity: "error",
        title: "Missing",
        description: "Missing required evidence.",
        evidenceIds: ["artifact:missing"],
        blocksVerdict: true,
      },
      {
        id: "risk:warning",
        category: "dependency_change",
        severity: "warning",
        title: "Dependency changed",
        description: "Review it.",
        evidenceIds: ["git:status"],
        blocksVerdict: false,
      },
    ]);
    const riskScore = RiskScoreSummarySchema.parse({
      schemaVersion: "0.1.0",
      score: 45,
      severity: "high",
      blockingRiskIds: [risks[0]?.id],
      warningRiskIds: [risks[1]?.id],
    });
    const summary = buildDecisionSummary({
      ...safeInputs(),
      finalVerdict: "UNSAFE_TO_PUSH",
      risks,
      riskScore,
    });

    expect(summary.risks).toEqual({
      total: 2,
      blocking: 1,
      warnings: 1,
      score: 45,
      severity: "high",
    });
  });

  it("gives tool errors the highest next-action priority", () => {
    const error = PipelineErrorSchema.parse({
      id: "error:invalid-config-json",
      code: "INVALID_CONFIG_JSON",
      message: "Config is malformed.",
    });
    const summary = buildDecisionSummary({
      ...safeInputs(),
      artifacts: [],
      commands: [],
      errors: [error],
      finalVerdict: "NEEDS_REVIEW",
    });

    expect(summary.toolErrors).toBe(1);
    expect(summary.nextAction).toBe(
      "Fix INVALID_CONFIG_JSON and run verification again.",
    );
  });
});

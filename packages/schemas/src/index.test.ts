import { describe, expect, it } from "vitest";

import {
  artifactKinds,
  artifactStatuses,
  ArtifactKindSchema,
  claimVerdictStatuses,
  commandStatuses,
  evidenceKinds,
  EvidenceIdSchema,
  finalVerdicts,
  FinalVerdictSchema,
  riskCategories,
  riskSeverities,
  RiskSeveritySchema,
  schemaVersion,
  toolStatuses,
  verificationModes,
  VerificationModeSchema,
} from "./index.js";

describe("@agentforge-qa/schemas primitives and enums", () => {
  it("accepts required literal values", () => {
    expect(FinalVerdictSchema.parse("SAFE_TO_CONTINUE")).toBe(
      "SAFE_TO_CONTINUE",
    );
    expect(RiskSeveritySchema.parse("critical")).toBe("critical");
    expect(ArtifactKindSchema.parse("glob")).toBe("glob");
    expect(VerificationModeSchema.parse("demo")).toBe("demo");
  });

  it("accepts non-empty evidence ids and rejects empty ids", () => {
    expect(EvidenceIdSchema.parse("cmd:test")).toBe("cmd:test");
    expect(EvidenceIdSchema.safeParse("").success).toBe(false);
  });

  it("exports the exact required schema version and literal values", () => {
    expect(schemaVersion).toBe("0.1.0");
    expect(finalVerdicts).toEqual([
      "SAFE_TO_CONTINUE",
      "NEEDS_REVIEW",
      "UNSAFE_TO_PUSH",
      "DEMO_BLOCKED",
    ]);
    expect(toolStatuses).toEqual(["OK", "TOOL_ERROR"]);
    expect(claimVerdictStatuses).toEqual([
      "VERIFIED",
      "PARTIALLY_VERIFIED",
      "UNVERIFIED",
      "CONTRADICTED",
      "NOT_CHECKED",
    ]);
    expect(riskSeverities).toEqual(["info", "warning", "error", "critical"]);
    expect(riskCategories).toEqual([
      "command_failure",
      "missing_artifact",
      "claim_mismatch",
      "risky_file_change",
      "dependency_change",
      "untracked_file",
      "partial_verification",
      "safety_skip",
      "unsupported_repo",
      "tool_error",
    ]);
    expect(evidenceKinds).toEqual([
      "config",
      "repo",
      "git",
      "command",
      "artifact",
      "claim",
      "log",
      "risk",
      "report",
    ]);
    expect(artifactKinds).toEqual(["file", "directory", "glob"]);
    expect(artifactStatuses).toEqual([
      "found",
      "missing",
      "not_checked",
      "error",
    ]);
    expect(commandStatuses).toEqual([
      "passed",
      "failed",
      "skipped",
      "timed_out",
      "error",
    ]);
    expect(verificationModes).toEqual(["local", "ci", "demo"]);
  });
});

import { VerificationReportSchema, schemaVersion } from "@agentforge-qa/schemas";
import { describe, expect, it } from "vitest";

import {
  createEmptyVerificationReport,
  createToolErrorReport,
} from "./create-empty-report.js";

describe("core report helpers", () => {
  it("creates a schema-valid empty report that requires review", () => {
    const report = createEmptyVerificationReport({
      cwd: "C:/work/repo",
      generatedAt: "2026-06-05T00:00:00.000Z",
      mode: "ci",
    });

    expect(VerificationReportSchema.safeParse(report).success).toBe(true);
    expect(report.schemaVersion).toBe(schemaVersion);
    expect(Number.isNaN(Date.parse(report.generatedAt))).toBe(false);
    expect(report.finalVerdict).toBe("NEEDS_REVIEW");
    expect(report.finalVerdict).not.toBe("SAFE_TO_CONTINUE");
    expect(report.toolStatus).toBe("OK");
    expect(report.mode).toBe("ci");
    expect(report.repo.root).toBe("C:/work/repo");
    expect(report.commands).toEqual([]);
    expect(report.artifacts).toEqual([]);
    expect(report.claims).toEqual([]);
    expect(report.claimVerdicts).toEqual([]);
    expect(report.risks).toEqual([]);
    expect(report.summary).toContain("No verification evidence was collected");
  });

  it("creates a schema-valid tool error report without a safe verdict", () => {
    const report = createToolErrorReport({
      id: "error:test",
      code: "TEST_ERROR",
      message: "Test failure",
    });

    expect(VerificationReportSchema.safeParse(report).success).toBe(true);
    expect(report.toolStatus).toBe("TOOL_ERROR");
    expect(report.finalVerdict).toBe("NEEDS_REVIEW");
    expect(report.finalVerdict).not.toBe("SAFE_TO_CONTINUE");
    expect(report.errors).toHaveLength(1);
    expect(report.errors?.[0]?.code).toBe("TEST_ERROR");
    expect(report.summary).toContain("could not complete");
    expect(report.risks).toHaveLength(1);
    expect(report.risks[0]?.category).toBe("tool_error");
    expect(report.riskScore.blockingRiskIds).toEqual([report.risks[0]?.id]);
  });

  it("does not return a report with an invalid generatedAt value", () => {
    expect(() =>
      createEmptyVerificationReport({ generatedAt: "not-a-date" }),
    ).toThrow("generatedAt must be a valid date string");
  });
});

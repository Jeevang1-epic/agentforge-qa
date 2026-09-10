import { describe, expect, it } from "vitest";

import {
  RiskFindingSchema,
  RiskScoreSummarySchema,
  sampleRiskFinding,
  sampleRiskScoreSummary,
} from "./index.js";

describe("risk contracts", () => {
  it("parses a valid risk finding", () => {
    expect(RiskFindingSchema.parse(sampleRiskFinding)).toEqual(
      sampleRiskFinding,
    );
  });

  it("parses a valid risk score summary", () => {
    expect(RiskScoreSummarySchema.parse(sampleRiskScoreSummary)).toEqual(
      sampleRiskScoreSummary,
    );
    expect(sampleRiskScoreSummary.score).toBe(60);
  });

  it("rejects an invalid risk severity", () => {
    const result = RiskFindingSchema.safeParse({
      ...sampleRiskFinding,
      severity: "severe",
    });

    expect(result.success).toBe(false);
  });

  it("rejects a risk without evidence ids", () => {
    const result = RiskFindingSchema.safeParse({
      ...sampleRiskFinding,
      evidenceIds: [],
    });

    expect(result.success).toBe(false);
  });

  it("rejects a risk score above 100", () => {
    const result = RiskScoreSummarySchema.safeParse({
      ...sampleRiskScoreSummary,
      score: 101,
    });

    expect(result.success).toBe(false);
  });

  it("rejects a risk score below 0", () => {
    const result = RiskScoreSummarySchema.safeParse({
      ...sampleRiskScoreSummary,
      score: -1,
    });

    expect(result.success).toBe(false);
  });
});

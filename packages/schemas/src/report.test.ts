import { describe, expect, it } from "vitest";

import {
  sampleDemoBlockedReport,
  sampleSafeReport,
  VerificationReportSchema,
} from "./index.js";

describe("verification report contracts", () => {
  it("parses the safe report sample", () => {
    expect(VerificationReportSchema.parse(sampleSafeReport)).toEqual(
      sampleSafeReport,
    );
    expect(sampleSafeReport.commands.every(({ status }) => status === "passed")).toBe(
      true,
    );
    expect(sampleSafeReport.artifacts.every(({ status }) => status === "found")).toBe(
      true,
    );
    expect(sampleSafeReport.outputPaths).toBeUndefined();
  });

  it("parses the demo-blocked report sample", () => {
    expect(VerificationReportSchema.parse(sampleDemoBlockedReport)).toEqual(
      sampleDemoBlockedReport,
    );
  });

  it("rejects an invalid final verdict", () => {
    const result = VerificationReportSchema.safeParse({
      ...sampleSafeReport,
      finalVerdict: "LOOKS_FINE",
    });

    expect(result.success).toBe(false);
  });
});

import { readFile } from "node:fs/promises";

import {
  sampleDemoBlockedReport,
  sampleSafeReport,
  VerificationReportSchema,
  type VerificationReport,
} from "@agentforge-qa/schemas";
import { describe, expect, it } from "vitest";

import {
  renderJsonReport,
  renderMarkdownReport,
  renderReport,
  type ReportFormat,
} from "./index.js";

function cloneReport(report: VerificationReport): VerificationReport {
  return structuredClone(report);
}

function createToolErrorReportWithoutFinalVerdict(): VerificationReport {
  const base = structuredClone(sampleSafeReport) as Record<string, unknown>;
  delete base.finalVerdict;
  delete base.git;

  return VerificationReportSchema.parse({
    ...base,
    toolStatus: "TOOL_ERROR",
    commands: [],
    artifacts: [],
    claims: [],
    claimVerdicts: [],
    risks: [
      {
        id: "risk:tool-error:invalid-request",
        category: "tool_error",
        severity: "error",
        title: "Verification tool error",
        description: "The verification request could not be parsed.",
        evidenceIds: ["error:invalid-request"],
        nextAction: "Review the request and retry verification.",
        blocksVerdict: true,
      },
    ],
    riskScore: {
      schemaVersion: "0.1.0",
      score: 45,
      severity: "high",
      blockingRiskIds: ["risk:tool-error:invalid-request"],
      warningRiskIds: [],
    },
    summary: "The v0.1 evidence pipeline could not complete safely.",
    decisionSummary: {
      verdict: "NEEDS_REVIEW",
      commands: { total: 0, passed: 0, failed: 0, skipped: 0 },
      artifacts: { total: 0, found: 0, missing: 0, requiredMissing: 0 },
      claims: { total: 0, verified: 0, contradicted: 0, reviewRequired: 0 },
      risks: { total: 1, blocking: 1, warnings: 0, score: 45, severity: "high" },
      toolErrors: 1,
      nextAction: "Fix INVALID_REQUEST and run verification again.",
    },
    errors: [
      {
        id: "error:invalid-request",
        code: "INVALID_REQUEST",
        message: "Invalid request | contains newline\nsecond line",
        details: { reason: "bad | value" },
        causedBy: "unit test",
      },
    ],
  });
}

function createEscapingReport(): VerificationReport {
  return VerificationReportSchema.parse({
    ...sampleSafeReport,
    commands: [
      {
        id: "cmd:unsafe",
        planId: "lint | test",
        status: "failed",
        exitCode: 1,
        durationMs: 1,
        reason: "failed | reason\nsecond line",
      },
    ],
    claims: [
      {
        id: "claim:unsafe",
        text: "claim | text\n[Run](https://example.test)\n<script>alert(1)</script>",
        source: "CLAIMS.md",
        lineStart: 1,
        lineEnd: 3,
      },
    ],
    claimVerdicts: [
      {
        id: "claim-verdict:unsafe",
        claimId: "claim:unsafe",
        status: "UNVERIFIED",
        matchedEvidenceIds: [],
        missingEvidence: ["missing | evidence\nanother line"],
        impact: "impact | details\nmore details",
        nextAction: "inspect | manually",
      },
    ],
  });
}

describe("JSON report rendering", () => {
  it("renders schema-valid reports as deterministic pretty JSON", () => {
    const output = renderJsonReport(sampleSafeReport);

    expect(output).toBe(`${JSON.stringify(sampleSafeReport, null, 2)}\n`);
    expect(output).toContain('\n  "schemaVersion": "0.1.0"');
    expect(output.endsWith("\n")).toBe(true);
    expect(JSON.parse(output)).toEqual(sampleSafeReport);
    expect(JSON.parse(output).decisionSummary).toEqual(
      sampleSafeReport.decisionSummary,
    );
  });

  it("renders minimal valid summary-only JSON", () => {
    const output = renderJsonReport(sampleSafeReport, { summaryOnly: true });

    expect(JSON.parse(output)).toEqual({
      schemaVersion: sampleSafeReport.schemaVersion,
      summary: sampleSafeReport.decisionSummary,
    });
    expect(output).not.toContain('"repo"');
  });

  it("does not mutate the input report", () => {
    const input = cloneReport(sampleSafeReport);
    const before = cloneReport(input);

    renderJsonReport(input);

    expect(input).toEqual(before);
  });

  it("rejects invalid reports", () => {
    expect(() => renderJsonReport({ summary: "not enough report" })).toThrow();
  });
});

describe("Markdown report rendering", () => {
  it("renders stable sections and important metadata", () => {
    const output = renderMarkdownReport(sampleSafeReport);

    expect(output).toContain("# AgentForge QA Verification Report");
    for (const heading of [
      "## Summary",
      "## Metadata",
      "## Repository",
      "## Git Evidence",
      "## Commands",
      "## Artifacts",
      "## Claims",
      "## Risks",
      "## Risk Score",
      "## Errors",
      "## Limitations",
    ]) {
      expect(output).toContain(heading);
    }

    expect(output).toContain("SAFE_TO_CONTINUE");
    expect(output).toContain("All configured command and artifact evidence passed.");
    expect(output).toContain("One schema source file changed.");
    expect(output).toContain("Compiled CLI entry point");
    expect(output.indexOf("## Decision Summary")).toBeLessThan(
      output.indexOf("## Summary"),
    );
    expect(output).toContain("Commands: 1/1 passed");
    expect(output).toContain("Next action: Safe to continue.");
  });

  it("renders only the heading and decision block in summary-only Markdown", () => {
    const output = renderMarkdownReport(sampleSafeReport, { summaryOnly: true });

    expect(output).toContain("# AgentForge QA Verification Report");
    expect(output).toContain("## Decision Summary");
    expect(output).not.toContain("## Metadata");
    expect(output).not.toContain("## Commands");
  });

  it("handles empty sections clearly", () => {
    const output = renderMarkdownReport(sampleDemoBlockedReport);

    expect(output).toContain("No command results.");
    expect(output).toContain("No claims.");
    expect(output).toContain("No claim verdicts.");
    expect(output).toContain("No tool errors.");
    expect(output).toContain("Required demo artifact is missing");
  });

  it("handles TOOL_ERROR reports without a final verdict", () => {
    const output = renderMarkdownReport(createToolErrorReportWithoutFinalVerdict());

    expect(output).toContain("TOOL_ERROR");
    expect(output).toContain("| Final verdict | Not provided |");
    expect(output).toContain("INVALID_REQUEST");
    expect(output).toContain("Invalid request \\| contains newline <br> second line");
    expect(output).toContain("Commands: not executed");
    expect(output).toContain("Artifacts: not collected");
    expect(output).toContain("Claims: not evaluated");
  });

  it("escapes table pipes, newlines, links, and raw HTML-like text", () => {
    const output = renderMarkdownReport(createEscapingReport());

    expect(output).toContain("lint \\| test");
    expect(output).toContain("failed \\| reason <br> second line");
    expect(output).toContain(
      "claim \\| text <br> \\[Run\\]\\(https://example.test\\) <br> &lt;script&gt;alert\\(1\\)&lt;/script&gt;",
    );
    expect(output).toContain("missing \\| evidence <br> another line");
    expect(output).not.toContain("<script>");
  });

  it("does not mutate the input report", () => {
    const input = cloneReport(createEscapingReport());
    const before = cloneReport(input);

    renderMarkdownReport(input);

    expect(input).toEqual(before);
  });

  it("rejects invalid reports", () => {
    expect(() => renderMarkdownReport({ summary: "not enough report" })).toThrow();
  });
});

describe("report rendering dispatcher", () => {
  it("routes JSON format to the JSON renderer", () => {
    expect(renderReport(sampleSafeReport, { format: "json" })).toBe(
      renderJsonReport(sampleSafeReport),
    );
  });

  it("routes Markdown format to the Markdown renderer", () => {
    expect(renderReport(sampleSafeReport, { format: "markdown" })).toBe(
      renderMarkdownReport(sampleSafeReport),
    );
  });

  it("fails clearly for unsupported formats if reached at runtime", () => {
    expect(() =>
      renderReport(sampleSafeReport, { format: "html" as ReportFormat }),
    ).toThrow("Unsupported report format: html");
  });
});

describe("reporter production boundaries", () => {
  it("does not import core, CLI, testkit, filesystem, process, or network modules", async () => {
    const source = await readFile(new URL("./index.ts", import.meta.url), "utf8");
    const forbiddenSpecifiers = [
      "@agentforge-qa/core",
      "agentforge-qa",
      "@agentforge-qa/testkit",
      "node:fs",
      "node:fs/promises",
      "node:child_process",
      "node:process",
      "node:http",
      "node:https",
      "node:net",
      "node:tls",
    ];

    for (const specifier of forbiddenSpecifiers) {
      expect(source).not.toContain(`"${specifier}"`);
      expect(source).not.toContain(`'${specifier}'`);
    }
  });
});

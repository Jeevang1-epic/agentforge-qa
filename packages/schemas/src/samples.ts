import type { NormalizedConfig } from "./config.js";
import { NormalizedConfigSchema } from "./config.js";
import type { VerificationReport } from "./report.js";
import { VerificationReportSchema } from "./report.js";
import type { RiskFinding, RiskScoreSummary } from "./risk.js";
import { RiskFindingSchema, RiskScoreSummarySchema } from "./risk.js";

export const sampleNormalizedConfig = NormalizedConfigSchema.parse({
  schemaVersion: "0.1.0",
  commands: [
    {
      id: "test",
      label: "Run tests",
      command: "pnpm",
      args: ["test"],
      required: true,
      timeoutMs: 120_000,
    },
  ],
  artifacts: [
    {
      id: "cli-build",
      label: "Compiled CLI entry point",
      path: "packages/cli/dist/index.js",
      type: "file",
      required: true,
      claimKeywords: ["build", "CLI"],
      minSizeBytes: 1,
    },
  ],
}) satisfies NormalizedConfig;

export const sampleRiskFinding = RiskFindingSchema.parse({
  id: "risk:missing-artifact:plots/accuracy.png",
  category: "missing_artifact",
  severity: "critical",
  title: "Required demo artifact is missing",
  description: "The expected accuracy plot was not found.",
  evidenceIds: ["artifact:plots/accuracy.png"],
  nextAction: "Generate and verify the required accuracy plot.",
  blocksVerdict: true,
}) satisfies RiskFinding;

export const sampleRiskScoreSummary = RiskScoreSummarySchema.parse({
  schemaVersion: "0.1.0",
  score: 60,
  severity: "critical",
  blockingRiskIds: [sampleRiskFinding.id],
  warningRiskIds: [],
}) satisfies RiskScoreSummary;

export const sampleSafeReport = VerificationReportSchema.parse({
  schemaVersion: "0.1.0",
  generatedAt: "2026-06-05T00:00:00.000Z",
  toolStatus: "OK",
  finalVerdict: "SAFE_TO_CONTINUE",
  mode: "local",
  repo: {
    root: "/workspace/agentforge-qa",
    isGitRepo: true,
    packageManager: "pnpm",
    detectedFrameworks: ["node"],
  },
  git: {
    since: "main",
    changedFiles: ["packages/schemas/src/index.ts"],
    untrackedFiles: [],
    deletedFiles: [],
    dependencyFilesChanged: [],
    summary: "One schema source file changed.",
  },
  commands: [
    {
      id: "cmd:test",
      planId: "test",
      status: "passed",
      exitCode: 0,
      durationMs: 420,
    },
  ],
  artifacts: [
    {
      id: "artifact:cli-build",
      artifactId: "cli-build",
      label: "Compiled CLI entry point",
      path: "packages/cli/dist/index.js",
      type: "file",
      required: true,
      status: "found",
      matchedPaths: ["packages/cli/dist/index.js"],
      sizeBytes: 1_024,
    },
  ],
  claims: [],
  claimVerdicts: [],
  risks: [],
  riskScore: {
    schemaVersion: "0.1.0",
    score: 0,
    severity: "low",
    blockingRiskIds: [],
    warningRiskIds: [],
  },
  summary: "All configured command and artifact evidence passed.",
  decisionSummary: {
    verdict: "SAFE_TO_CONTINUE",
    commands: { total: 1, passed: 1, failed: 0, skipped: 0 },
    artifacts: { total: 1, found: 1, missing: 0, requiredMissing: 0 },
    claims: { total: 0, verified: 0, contradicted: 0, reviewRequired: 0 },
    risks: { total: 0, blocking: 0, warnings: 0, score: 0, severity: "low" },
    toolErrors: 0,
    nextAction: "Safe to continue.",
  },
}) satisfies VerificationReport;

export const sampleDemoBlockedReport = VerificationReportSchema.parse({
  schemaVersion: "0.1.0",
  generatedAt: "2026-06-05T00:00:00.000Z",
  toolStatus: "OK",
  finalVerdict: "DEMO_BLOCKED",
  mode: "demo",
  repo: {
    root: "/workspace/ml-demo",
    isGitRepo: true,
    detectedFrameworks: ["python"],
  },
  commands: [],
  artifacts: [
    {
      id: "artifact:plots/accuracy.png",
      artifactId: "accuracy-plot",
      label: "Accuracy plot",
      path: "plots/accuracy.png",
      type: "file",
      required: true,
      demoCritical: true,
      status: "missing",
      matchedPaths: [],
      reason: "No matching file was found.",
    },
  ],
  claims: [],
  claimVerdicts: [],
  risks: [sampleRiskFinding],
  riskScore: sampleRiskScoreSummary,
  summary: "A demo-critical artifact is missing.",
  decisionSummary: {
    verdict: "DEMO_BLOCKED",
    commands: { total: 0, passed: 0, failed: 0, skipped: 0 },
    artifacts: { total: 1, found: 0, missing: 1, requiredMissing: 1 },
    claims: { total: 0, verified: 0, contradicted: 0, reviewRequired: 0 },
    risks: { total: 1, blocking: 1, warnings: 0, score: 60, severity: "critical" },
    toolErrors: 0,
    nextAction: "Restore the required artifact \"plots/accuracy.png\" and run verification again.",
  },
}) satisfies VerificationReport;

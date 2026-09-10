import {
  RepoProfileSchema,
  RiskFindingSchema,
  VerificationModeSchema,
  VerificationReportSchema,
  schemaVersion,
  type PipelineError,
  type RiskFinding,
  type VerificationMode,
  type VerificationReport,
} from "@agentforge-qa/schemas";

import { createRiskEvidenceId } from "../evidence/evidence-ids.js";
import { calculateRiskScore } from "../risk/calculate-risk-score.js";
import { buildDecisionSummary } from "../summary/build-decision-summary.js";

interface ReportContext {
  cwd?: string;
  generatedAt?: string;
  mode?: VerificationMode;
}

function resolveGeneratedAt(generatedAt?: string): string {
  const resolvedGeneratedAt = generatedAt ?? new Date().toISOString();

  if (Number.isNaN(Date.parse(resolvedGeneratedAt))) {
    throw new TypeError("generatedAt must be a valid date string");
  }

  return resolvedGeneratedAt;
}

function createFallbackRepoProfile(cwd: string) {
  return RepoProfileSchema.parse({
    root: cwd,
    isGitRepo: false,
    detectedFrameworks: [],
    notes: ["Repository evidence was not collected for this report."],
  });
}

export function createEmptyVerificationReport(
  context: ReportContext = {},
): VerificationReport {
  const mode = VerificationModeSchema.parse(context.mode ?? "local");
  const risks: RiskFinding[] = [];
  const riskScore = calculateRiskScore(risks);
  const finalVerdict = "NEEDS_REVIEW" as const;

  return VerificationReportSchema.parse({
    schemaVersion,
    generatedAt: resolveGeneratedAt(context.generatedAt),
    toolStatus: "OK",
    finalVerdict,
    mode,
    repo: createFallbackRepoProfile(context.cwd ?? "."),
    commands: [],
    artifacts: [],
    claims: [],
    claimVerdicts: [],
    risks,
    riskScore,
    summary: "Empty v0.1 report. No verification evidence was collected.",
    decisionSummary: buildDecisionSummary({
      artifacts: [],
      claims: [],
      claimVerdicts: [],
      commands: [],
      finalVerdict,
      risks,
      riskScore,
    }),
  });
}

export function createToolErrorReport(
  error: PipelineError,
  context: ReportContext = {},
): VerificationReport {
  const emptyReport = createEmptyVerificationReport(context);
  const risk = RiskFindingSchema.parse({
    id: createRiskEvidenceId(`tool-error:${error.code.toLowerCase()}`),
    category: "tool_error",
    severity: "error",
    title: "Verification tool error",
    description: error.message,
    evidenceIds: [error.id],
    nextAction: "Review the reported error and retry verification.",
    blocksVerdict: true,
  });

  const risks = [risk];
  const riskScore = calculateRiskScore(risks);
  const finalVerdict = "NEEDS_REVIEW" as const;

  return VerificationReportSchema.parse({
    ...emptyReport,
    toolStatus: "TOOL_ERROR",
    finalVerdict,
    risks,
    riskScore,
    summary: "The v0.1 evidence pipeline could not complete safely.",
    errors: [error],
    decisionSummary: buildDecisionSummary({
      artifacts: [],
      claims: [],
      claimVerdicts: [],
      commands: [],
      errors: [error],
      finalVerdict,
      risks,
      riskScore,
    }),
  });
}

import {
  RiskScoreSummarySchema,
  schemaVersion,
  type RiskFinding,
  type RiskScoreSummary,
} from "@agentforge-qa/schemas";

const severityPoints = {
  info: 0,
  warning: 15,
  error: 35,
  critical: 60,
} as const;

export function calculateRiskScore(
  risks: readonly RiskFinding[],
): RiskScoreSummary {
  const score = Math.min(
    100,
    risks.reduce((total, risk) => total + severityPoints[risk.severity], 0),
  );
  const severity =
    score >= 60
      ? "critical"
      : score >= 35
        ? "high"
        : score >= 15
          ? "medium"
          : "low";

  return RiskScoreSummarySchema.parse({
    schemaVersion,
    score,
    severity,
    blockingRiskIds: risks
      .filter(({ blocksVerdict }) => blocksVerdict === true)
      .map(({ id }) => id),
    warningRiskIds: risks
      .filter(({ severity: riskSeverity }) => riskSeverity === "warning")
      .map(({ id }) => id),
  });
}

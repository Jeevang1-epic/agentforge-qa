import { RiskFindingSchema, type RiskFinding } from "@agentforge-qa/schemas";

import { redactCommandText } from "../commands/command-redaction.js";
import type { ScanResult } from "../scanners/failure-suppression/types.js";

const titles = {
  "AFQ-FS001": "empty failure handler",
  "AFQ-FS002": "default fallback after error",
  "AFQ-FS003": "permissive return after failure",
  "AFQ-FS004": "swallowed promise failure",
  "AFQ-FS005": "suppression language",
} as const;

export function failureSuppressionRisks(scan: ScanResult, evidenceId: string): RiskFinding[] {
  const risks: RiskFinding[] = scan.signals.map((signal, index) => {
    const languageOnly = signal.ruleId === "AFQ-FS005";
    const blocksVerdict = !languageOnly;
    const location = redactCommandText(signal.path).replace(/[\x00-\x1f\x7f]/g, "?").slice(0, 240);
    return RiskFindingSchema.parse({
      id: `risk:failure-suppression:${index + 1}`,
      category: "risky_file_change",
      severity: languageOnly ? "info" : "warning",
      title: `Failure suppression scanner: ${titles[signal.ruleId]}`,
      description: `${signal.ruleId} at ${location}:${signal.line}. ${languageOnly
        ? "Changed comment or commit language mentions fallback or suppression; language alone does not establish incorrect behavior."
        : "The changed error path may hide the original failure. This is evidence for review, not proof of a bug or intent."}${signal.correlated ? " Suppression language in the same changed hunk increases review confidence." : ""}${signal.validationContext ? " Nearby validation-related code warrants closer review." : ""}`,
      evidenceIds: [evidenceId],
      nextAction: languageOnly
        ? "Review the intended failure behavior in context."
        : "Review the failure path and propagate, record, explicitly handle, or document the error behavior.",
      blocksVerdict,
    });
  });
  if (scan.status !== "complete") {
    risks.push(RiskFindingSchema.parse({
      id: "risk:failure-suppression:partial",
      category: "partial_verification",
      severity: "warning",
      title: "Failure suppression scanner: incomplete evidence",
      description: scan.summary,
      evidenceIds: [evidenceId],
      nextAction: "Review skipped source or Git evidence and rerun with a smaller, supported change set.",
      blocksVerdict: true,
    }));
  }
  return risks;
}

import {
  DecisionSummarySchema,
  type ArtifactResult,
  type Claim,
  type ClaimVerdict,
  type CommandResult,
  type DecisionSummary,
  type FinalVerdict,
  type NormalizedConfig,
  type PipelineError,
  type RiskFinding,
  type RiskScoreSummary,
} from "@agentforge-qa/schemas";

interface DecisionSummaryInputs {
  readonly artifacts: readonly ArtifactResult[];
  readonly claims: readonly Claim[];
  readonly claimVerdicts: readonly ClaimVerdict[];
  readonly commands: readonly CommandResult[];
  readonly config?: NormalizedConfig;
  readonly errors?: readonly PipelineError[];
  readonly finalVerdict: FinalVerdict;
  readonly risks: readonly RiskFinding[];
  readonly riskScore: RiskScoreSummary;
}

function quote(value: string): string {
  return `"${value.replace(/"/g, "'")}"`;
}

function determineNextAction(inputs: DecisionSummaryInputs): string {
  const [toolError] = inputs.errors ?? [];

  if (toolError !== undefined) {
    return `Fix ${toolError.code} and run verification again.`;
  }

  const commandConfig = new Map(
    (inputs.config?.commands ?? []).map((command) => [command.id, command]),
  );
  const requiredFailure = inputs.commands.find((command) => {
    const configured = commandConfig.get(command.planId);
    return configured?.required === true &&
      ["error", "failed", "timed_out"].includes(command.status);
  });

  if (requiredFailure !== undefined) {
    return `Fix the failed required command ${quote(requiredFailure.planId)} before pushing.`;
  }

  const missingRequiredArtifact = inputs.artifacts.find(
    (artifact) => artifact.required && artifact.status !== "found",
  );

  if (missingRequiredArtifact !== undefined) {
    return `Restore the required artifact ${quote(missingRequiredArtifact.path)} and run verification again.`;
  }

  const claimsById = new Map(inputs.claims.map((claim) => [claim.id, claim]));
  const contradictedClaim = inputs.claimVerdicts.find(
    (claim) => claim.status === "CONTRADICTED",
  );

  if (contradictedClaim !== undefined) {
    const claim = claimsById.get(contradictedClaim.claimId);
    return `Review claim ${quote(claim?.text ?? contradictedClaim.claimId)} because local evidence contradicts it.`;
  }

  const otherBlockingRisk = inputs.risks.find(
    (risk) => risk.blocksVerdict === true,
  );

  if (otherBlockingRisk !== undefined) {
    return otherBlockingRisk.nextAction ?? `Resolve ${quote(otherBlockingRisk.title)} and run verification again.`;
  }

  const skippedRequiredCommand = inputs.commands.find((command) => {
    const configured = commandConfig.get(command.planId);
    return configured?.required === true && command.status === "skipped";
  });

  if (skippedRequiredCommand !== undefined) {
    return "Run configured verification commands with --run.";
  }

  const reviewClaim = inputs.claimVerdicts.find(
    (claim) => claim.status !== "VERIFIED",
  );

  if (reviewClaim !== undefined) {
    const claim = claimsById.get(reviewClaim.claimId);
    return `Review claim ${quote(claim?.text ?? reviewClaim.claimId)} and provide complete matching evidence.`;
  }

  const warning = inputs.risks.find((risk) => risk.blocksVerdict !== true);

  if (warning !== undefined) {
    return warning.nextAction ?? `Review ${quote(warning.title)} before continuing.`;
  }

  const evidenceCount =
    inputs.commands.length + inputs.artifacts.length + inputs.claimVerdicts.length;
  return evidenceCount > 0
    ? "Safe to continue."
    : "Collect complete verification evidence and run verification again.";
}

export function buildDecisionSummary(
  inputs: DecisionSummaryInputs,
): DecisionSummary {
  return DecisionSummarySchema.parse({
    verdict: inputs.finalVerdict,
    commands: {
      total: inputs.commands.length,
      passed: inputs.commands.filter(({ status }) => status === "passed").length,
      failed: inputs.commands.filter(({ status }) =>
        ["error", "failed", "timed_out"].includes(status),
      ).length,
      skipped: inputs.commands.filter(({ status }) => status === "skipped").length,
    },
    artifacts: {
      total: inputs.artifacts.length,
      found: inputs.artifacts.filter(({ status }) => status === "found").length,
      missing: inputs.artifacts.filter(({ status }) => status === "missing").length,
      requiredMissing: inputs.artifacts.filter(
        ({ required, status }) => required && status !== "found",
      ).length,
    },
    claims: {
      total: inputs.claims.length,
      verified: inputs.claimVerdicts.filter(({ status }) => status === "VERIFIED").length,
      contradicted: inputs.claimVerdicts.filter(({ status }) => status === "CONTRADICTED").length,
      reviewRequired: inputs.claimVerdicts.filter(
        ({ status }) => status !== "VERIFIED" && status !== "CONTRADICTED",
      ).length,
    },
    risks: {
      total: inputs.risks.length,
      blocking: inputs.risks.filter(({ blocksVerdict }) => blocksVerdict === true).length,
      warnings: inputs.risks.filter(({ blocksVerdict }) => blocksVerdict !== true).length,
      score: inputs.riskScore.score,
      severity: inputs.riskScore.severity,
    },
    toolErrors: inputs.errors?.length ?? 0,
    nextAction: determineNextAction(inputs),
  });
}

import type {
  ArtifactResult,
  ClaimVerdict,
  CommandResult,
  FinalVerdict,
  RiskFinding,
  ToolStatus,
} from "@agentforge-qa/schemas";

interface VerdictInputs {
  artifacts: readonly ArtifactResult[];
  claimVerdicts: readonly ClaimVerdict[];
  commands: readonly CommandResult[];
  risks: readonly RiskFinding[];
  toolStatus: ToolStatus;
}

export function determineVerdict(inputs: VerdictInputs): FinalVerdict {
  if (inputs.toolStatus === "TOOL_ERROR") {
    return "NEEDS_REVIEW";
  }

  if (
    inputs.risks.some(
      ({ blocksVerdict, severity }) =>
        blocksVerdict === true && severity === "critical",
    )
  ) {
    return "DEMO_BLOCKED";
  }

  if (
    inputs.artifacts.some(
      ({ demoCritical, required, status }) =>
        required && demoCritical !== true && status !== "found",
    ) ||
    inputs.claimVerdicts.some(({ status }) => status === "CONTRADICTED") ||
    inputs.risks.some(
      ({ blocksVerdict, category, severity }) =>
        blocksVerdict === true &&
        (category === "command_failure" ||
          ((severity === "error" || severity === "critical") &&
            category !== "safety_skip" &&
            category !== "tool_error")),
    )
  ) {
    return "UNSAFE_TO_PUSH";
  }

  if (
    inputs.risks.some(({ blocksVerdict }) => blocksVerdict === true) ||
    inputs.claimVerdicts.some(({ status }) => status !== "VERIFIED")
  ) {
    return "NEEDS_REVIEW";
  }

  const hasEvidence =
    inputs.commands.length + inputs.artifacts.length + inputs.claimVerdicts.length > 0;
  const commandsRan = inputs.commands.every(({ status }) => status === "passed");
  const artifactsChecked = inputs.artifacts.every(({ status }) => status === "found");
  const claimsVerified = inputs.claimVerdicts.every(
    ({ status }) => status === "VERIFIED",
  );

  return hasEvidence && commandsRan && artifactsChecked && claimsVerified
    ? "SAFE_TO_CONTINUE"
    : "NEEDS_REVIEW";
}

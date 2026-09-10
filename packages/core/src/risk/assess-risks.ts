import {
  RiskFindingSchema,
  type ArtifactResult,
  type ClaimVerdict,
  type CommandResult,
  type NormalizedConfig,
  type RepoProfile,
  type RiskFinding,
} from "@agentforge-qa/schemas";

import type { CollectedGitEvidence } from "../git/collect-git-evidence.js";
import { createRiskEvidenceId } from "../evidence/evidence-ids.js";

interface RiskInputs {
  artifactResults: readonly ArtifactResult[];
  claimVerdicts: readonly ClaimVerdict[];
  commandResults: readonly CommandResult[];
  config: NormalizedConfig;
  git: CollectedGitEvidence;
  repo: RepoProfile;
}

function createRisk(
  localId: string,
  risk: Omit<RiskFinding, "id">,
): RiskFinding {
  return RiskFindingSchema.parse({
    id: createRiskEvidenceId(localId),
    ...risk,
  });
}

export function assessRisks(inputs: RiskInputs): RiskFinding[] {
  const risks: RiskFinding[] = [];
  const commandConfigById = new Map(
    inputs.config.commands.map((command) => [command.id, command]),
  );

  for (const result of inputs.commandResults) {
    const command = commandConfigById.get(result.planId);

    if (command === undefined || result.status === "passed") {
      continue;
    }

    if (result.status === "skipped") {
      const dryRun = result.reason?.includes("Dry run") === true;

      risks.push(
        createRisk(`command-skipped:${result.planId}`, {
          category: dryRun ? "partial_verification" : "safety_skip",
          severity: command.required && !dryRun ? "error" : "warning",
          title: dryRun ? "Configured command was not run" : "Command was skipped for safety",
          description:
            result.reason ?? "The configured command was skipped without a reason.",
          evidenceIds: [result.id],
          nextAction: dryRun
            ? "Run verification without dry-run mode when execution is appropriate."
            : "Replace the command with an explicitly allowed validation command.",
          blocksVerdict: command.required,
        }),
      );
      continue;
    }

    risks.push(
      createRisk(`command-failure:${result.planId}`, {
        category: "command_failure",
        severity: command.required ? "error" : "warning",
        title:
          result.status === "timed_out"
            ? "Configured command timed out"
            : "Configured command did not pass",
        description:
          result.reason ??
          `Command ${result.planId} completed with status ${result.status}.`,
        evidenceIds: [result.id],
        nextAction: "Review the command logs and make the configured check pass.",
        blocksVerdict: command.required,
      }),
    );
  }

  for (const artifact of inputs.artifactResults) {
    if (
      artifact.status === "found" ||
      (!artifact.required && artifact.demoCritical !== true)
    ) {
      continue;
    }

    const demoCritical = artifact.demoCritical === true;

    risks.push(
      createRisk(`missing-artifact:${artifact.artifactId}`, {
        category: "missing_artifact",
        severity: demoCritical ? "critical" : "error",
        title: demoCritical
          ? "Demo-critical artifact is unavailable"
          : "Required artifact is unavailable",
        description:
          artifact.reason ??
          `Required artifact ${artifact.path} completed with status ${artifact.status}.`,
        evidenceIds: [artifact.id],
        nextAction: "Create and verify the required artifact inside the repository.",
        blocksVerdict: true,
      }),
    );
  }

  for (const verdict of inputs.claimVerdicts) {
    if (verdict.status === "VERIFIED") {
      continue;
    }

    const contradicted = verdict.status === "CONTRADICTED";

    risks.push(
      createRisk(`claim:${verdict.claimId}`, {
        category: contradicted ? "claim_mismatch" : "partial_verification",
        severity: contradicted ? "error" : "warning",
        title: contradicted
          ? "Claim is contradicted by local evidence"
          : "Claim is not fully verified",
        description:
          verdict.missingEvidence?.join(" ") ??
          `Claim verdict is ${verdict.status}.`,
        evidenceIds: [verdict.id],
        nextAction: verdict.nextAction,
        blocksVerdict: contradicted,
      }),
    );
  }

  if (!inputs.repo.isGitRepo) {
    risks.push(
      createRisk("unsupported-repo", {
        category: "unsupported_repo",
        severity: "warning",
        title: "Git repository was not detected",
        description: inputs.git.evidence.summary,
        evidenceIds: [inputs.git.evidenceId],
        nextAction: "Run verification from a Git repository when Git evidence is required.",
        blocksVerdict: true,
      }),
    );
  } else if (inputs.git.status === "error") {
    risks.push(
      createRisk("git-evidence-error", {
        category: "tool_error",
        severity: "error",
        title: "Git evidence could not be collected",
        description: inputs.git.evidence.summary,
        evidenceIds: [inputs.git.evidenceId],
        nextAction: "Review the repository and requested Git reference.",
        blocksVerdict: true,
      }),
    );
  }

  if (inputs.git.evidence.dependencyFilesChanged.length > 0) {
    risks.push(
      createRisk("dependency-files-changed", {
        category: "dependency_change",
        severity: "warning",
        title: "Dependency files changed",
        description: `Changed dependency files: ${inputs.git.evidence.dependencyFilesChanged.join(", ")}.`,
        evidenceIds: [inputs.git.evidenceId],
        nextAction: "Review dependency changes before continuing.",
        blocksVerdict: false,
      }),
    );
  }

  if (inputs.git.evidence.untrackedFiles.length > 0) {
    risks.push(
      createRisk("untracked-files", {
        category: "untracked_file",
        severity: "warning",
        title: "Repository contains untracked files",
        description: `${inputs.git.evidence.untrackedFiles.length} untracked files were detected.`,
        evidenceIds: [inputs.git.evidenceId],
        nextAction: "Review untracked files before continuing.",
        blocksVerdict: false,
      }),
    );
  }

  return RiskFindingSchema.array().parse(risks);
}

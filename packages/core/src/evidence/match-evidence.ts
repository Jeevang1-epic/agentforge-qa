import {
  ClaimVerdictSchema,
  type ArtifactResult,
  type Claim,
  type ClaimVerdict,
  type CommandResult,
  type NormalizedConfig,
} from "@agentforge-qa/schemas";

import { createClaimVerdictEvidenceId } from "./evidence-ids.js";

const evidenceAssertionPattern =
  /\b(artifact|build|built|created|generated|lint|plot|produced|report|test|tests|typecheck|wrote)\b/i;

function containsTerm(text: string, term: string): boolean {
  const normalizedTerm = term.trim().toLowerCase();

  if (normalizedTerm.length <= 1) {
    return false;
  }

  if (/^[a-z0-9]+(?: [a-z0-9]+)*$/.test(normalizedTerm)) {
    const terms = new Set([normalizedTerm]);

    if (
      !normalizedTerm.includes(" ") &&
      normalizedTerm.length > 3 &&
      !normalizedTerm.endsWith("s")
    ) {
      terms.add(`${normalizedTerm}s`);
    }

    return [...terms].some((candidate) => {
      const escapedTerm = candidate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp(
        `(?:^|[^a-z0-9])${escapedTerm}(?:$|[^a-z0-9])`,
      ).test(text);
    });
  }

  return text.includes(normalizedTerm);
}

function commandMatchesClaim(
  claimText: string,
  command: NormalizedConfig["commands"][number],
): boolean {
  if (command.claimKeywords !== undefined) {
    return command.claimKeywords.some((term) => containsTerm(claimText, term));
  }

  const meaningfulArgs = command.args.filter(
    (arg) =>
      !arg.startsWith("-") && /^[A-Za-z0-9][A-Za-z0-9:._/-]*$/.test(arg),
  );

  return [command.id, command.label, ...meaningfulArgs].some((term) =>
    containsTerm(claimText, term),
  );
}

function artifactMatchesClaim(
  claimText: string,
  artifact: NormalizedConfig["artifacts"][number],
): boolean {
  return [
    artifact.id,
    artifact.label,
    artifact.path,
    ...(artifact.claimKeywords ?? []),
  ].some((term) => containsTerm(claimText, term));
}

export function matchEvidence(
  claims: readonly Claim[],
  config: NormalizedConfig,
  commandResults: readonly CommandResult[],
  artifactResults: readonly ArtifactResult[],
): ClaimVerdict[] {
  const commandResultsByPlanId = new Map(
    commandResults.map((result) => [result.planId, result]),
  );
  const artifactResultsById = new Map(
    artifactResults.map((result) => [result.artifactId, result]),
  );

  return ClaimVerdictSchema.array().parse(
    claims.map((claim) => {
      const claimText = claim.text.toLowerCase();
      const matchedCommands = config.commands
        .filter((command) => commandMatchesClaim(claimText, command))
        .flatMap((command) => {
          const result = commandResultsByPlanId.get(command.id);
          return result === undefined ? [] : [{ command, result }];
        });
      const matchedArtifacts = config.artifacts
        .filter((artifact) => artifactMatchesClaim(claimText, artifact))
        .flatMap((artifact) => {
          const result = artifactResultsById.get(artifact.id);
          return result === undefined ? [] : [result];
        });
      const matchedEvidenceIds = [
        ...new Set([
          ...matchedCommands.map(({ result }) => result.id),
          ...matchedArtifacts.map(({ id }) => id),
        ]),
      ];
      const hasContradiction =
        matchedCommands.some(({ command, result }) =>
          command.required && ["error", "failed", "timed_out"].includes(result.status),
        ) ||
        matchedArtifacts.some(({ status }) =>
          ["error", "missing"].includes(status),
        );
      const hasPositiveEvidence =
        matchedCommands.some(({ result }) => result.status === "passed") ||
        matchedArtifacts.some(({ status }) => status === "found");
      const hasIncompleteEvidence =
        matchedCommands.some(({ command, result }) =>
          command.required && result.status === "skipped",
        ) ||
        matchedArtifacts.some(({ status }) => status === "not_checked");
      let status: ClaimVerdict["status"];

      if (hasContradiction) {
        status = "CONTRADICTED";
      } else if (hasPositiveEvidence && hasIncompleteEvidence) {
        status = "PARTIALLY_VERIFIED";
      } else if (hasPositiveEvidence) {
        status = "VERIFIED";
      } else if (
        matchedEvidenceIds.length > 0 ||
        evidenceAssertionPattern.test(claim.text)
      ) {
        status = "UNVERIFIED";
      } else {
        status = "NOT_CHECKED";
      }

      return {
        id: createClaimVerdictEvidenceId(claim.id),
        claimId: claim.id,
        status,
        matchedEvidenceIds,
        ...(status === "VERIFIED"
          ? {}
          : {
              missingEvidence: [
                hasContradiction
                  ? "Matched evidence contradicts the claim."
                  : "No complete matching evidence verified the claim.",
              ],
              nextAction:
                "Review the claim and provide a configured command or artifact that proves it.",
            }),
      };
    }),
  );
}

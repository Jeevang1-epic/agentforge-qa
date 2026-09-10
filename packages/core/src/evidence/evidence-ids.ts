import { EvidenceIdSchema, type EvidenceId } from "@agentforge-qa/schemas";

function createEvidenceId(
  kind: "artifact" | "claim" | "claim-verdict" | "command" | "git" | "risk",
  localId: string,
): EvidenceId {
  return EvidenceIdSchema.parse(`${kind}:${localId}`);
}

export function createCommandEvidenceId(planId: string): EvidenceId {
  return createEvidenceId("command", planId);
}

export function createArtifactEvidenceId(artifactId: string): EvidenceId {
  return createEvidenceId("artifact", artifactId);
}

export function createClaimEvidenceId(claimId: string): EvidenceId {
  return createEvidenceId("claim", claimId);
}

export function createClaimVerdictEvidenceId(claimId: string): EvidenceId {
  return createEvidenceId("claim-verdict", claimId);
}

export function createGitEvidenceId(localId: string): EvidenceId {
  return createEvidenceId("git", localId);
}

export function createRiskEvidenceId(localId: string): EvidenceId {
  return createEvidenceId("risk", localId);
}

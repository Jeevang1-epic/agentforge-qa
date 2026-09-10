import { z } from "zod";

export const finalVerdicts = [
  "SAFE_TO_CONTINUE",
  "NEEDS_REVIEW",
  "UNSAFE_TO_PUSH",
  "DEMO_BLOCKED",
] as const;

export const FinalVerdictSchema = z.enum(finalVerdicts);
export type FinalVerdict = z.infer<typeof FinalVerdictSchema>;

export const toolStatuses = ["OK", "TOOL_ERROR"] as const;

export const ToolStatusSchema = z.enum(toolStatuses);
export type ToolStatus = z.infer<typeof ToolStatusSchema>;

export const claimVerdictStatuses = [
  "VERIFIED",
  "PARTIALLY_VERIFIED",
  "UNVERIFIED",
  "CONTRADICTED",
  "NOT_CHECKED",
] as const;

export const ClaimVerdictStatusSchema = z.enum(claimVerdictStatuses);
export type ClaimVerdictStatus = z.infer<typeof ClaimVerdictStatusSchema>;

export const riskSeverities = [
  "info",
  "warning",
  "error",
  "critical",
] as const;

export const RiskSeveritySchema = z.enum(riskSeverities);
export type RiskSeverity = z.infer<typeof RiskSeveritySchema>;

export const riskCategories = [
  "command_failure",
  "missing_artifact",
  "claim_mismatch",
  "risky_file_change",
  "dependency_change",
  "untracked_file",
  "partial_verification",
  "safety_skip",
  "unsupported_repo",
  "tool_error",
] as const;

export const RiskCategorySchema = z.enum(riskCategories);
export type RiskCategory = z.infer<typeof RiskCategorySchema>;

export const evidenceKinds = [
  "config",
  "repo",
  "git",
  "command",
  "artifact",
  "claim",
  "log",
  "risk",
  "report",
] as const;

export const EvidenceKindSchema = z.enum(evidenceKinds);
export type EvidenceKind = z.infer<typeof EvidenceKindSchema>;

export const artifactKinds = ["file", "directory", "glob"] as const;

export const ArtifactKindSchema = z.enum(artifactKinds);
export type ArtifactKind = z.infer<typeof ArtifactKindSchema>;

export const artifactStatuses = [
  "found",
  "missing",
  "not_checked",
  "error",
] as const;

export const ArtifactStatusSchema = z.enum(artifactStatuses);
export type ArtifactStatus = z.infer<typeof ArtifactStatusSchema>;

export const commandStatuses = [
  "passed",
  "failed",
  "skipped",
  "timed_out",
  "error",
] as const;

export const CommandStatusSchema = z.enum(commandStatuses);
export type CommandStatus = z.infer<typeof CommandStatusSchema>;

export const verificationModes = ["local", "ci", "demo"] as const;

export const VerificationModeSchema = z.enum(verificationModes);
export type VerificationMode = z.infer<typeof VerificationModeSchema>;

export const riskScoreSeverities = [
  "low",
  "medium",
  "high",
  "critical",
] as const;

export const RiskScoreSeveritySchema = z.enum(riskScoreSeverities);
export type RiskScoreSeverity = z.infer<typeof RiskScoreSeveritySchema>;

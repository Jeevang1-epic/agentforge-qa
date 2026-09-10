import { z } from "zod";

import {
  FinalVerdictSchema,
  RiskScoreSeveritySchema,
} from "./enums.js";
import { NonNegativeIntegerSchema } from "./primitives.js";

export const DecisionCommandSummarySchema = z
  .object({
    total: NonNegativeIntegerSchema,
    passed: NonNegativeIntegerSchema,
    failed: NonNegativeIntegerSchema,
    skipped: NonNegativeIntegerSchema,
  })
  .strict();

export type DecisionCommandSummary = z.infer<
  typeof DecisionCommandSummarySchema
>;

export const DecisionArtifactSummarySchema = z
  .object({
    total: NonNegativeIntegerSchema,
    found: NonNegativeIntegerSchema,
    missing: NonNegativeIntegerSchema,
    requiredMissing: NonNegativeIntegerSchema,
  })
  .strict();

export type DecisionArtifactSummary = z.infer<
  typeof DecisionArtifactSummarySchema
>;

export const DecisionClaimSummarySchema = z
  .object({
    total: NonNegativeIntegerSchema,
    verified: NonNegativeIntegerSchema,
    contradicted: NonNegativeIntegerSchema,
    reviewRequired: NonNegativeIntegerSchema,
  })
  .strict();

export type DecisionClaimSummary = z.infer<typeof DecisionClaimSummarySchema>;

export const DecisionRiskSummarySchema = z
  .object({
    total: NonNegativeIntegerSchema,
    blocking: NonNegativeIntegerSchema,
    warnings: NonNegativeIntegerSchema,
    score: z.number().min(0).max(100),
    severity: RiskScoreSeveritySchema,
  })
  .strict();

export type DecisionRiskSummary = z.infer<typeof DecisionRiskSummarySchema>;

export const DecisionSummarySchema = z
  .object({
    verdict: FinalVerdictSchema,
    commands: DecisionCommandSummarySchema,
    artifacts: DecisionArtifactSummarySchema,
    claims: DecisionClaimSummarySchema,
    risks: DecisionRiskSummarySchema,
    toolErrors: NonNegativeIntegerSchema,
    nextAction: z.string().min(1),
  })
  .strict();

export type DecisionSummary = z.infer<typeof DecisionSummarySchema>;

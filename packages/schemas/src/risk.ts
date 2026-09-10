import { z } from "zod";

import {
  RiskCategorySchema,
  RiskScoreSeveritySchema,
  RiskSeveritySchema,
} from "./enums.js";
import {
  EvidenceIdSchema,
  NonEmptyStringSchema,
  SchemaVersionSchema,
} from "./primitives.js";

export const RiskFindingSchema = z
  .object({
    id: EvidenceIdSchema,
    category: RiskCategorySchema,
    severity: RiskSeveritySchema,
    title: NonEmptyStringSchema,
    description: NonEmptyStringSchema,
    evidenceIds: z.array(EvidenceIdSchema).min(1),
    nextAction: z.string().optional(),
    blocksVerdict: z.boolean().optional(),
  })
  .strict();

export type RiskFinding = z.infer<typeof RiskFindingSchema>;

export const RiskScoreSummarySchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    score: z.number().min(0).max(100),
    severity: RiskScoreSeveritySchema,
    blockingRiskIds: z.array(EvidenceIdSchema),
    warningRiskIds: z.array(EvidenceIdSchema),
  })
  .strict();

export type RiskScoreSummary = z.infer<typeof RiskScoreSummarySchema>;

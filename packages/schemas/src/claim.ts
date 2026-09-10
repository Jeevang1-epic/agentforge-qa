import { z } from "zod";

import { ClaimVerdictStatusSchema } from "./enums.js";
import {
  EvidenceIdSchema,
  NonEmptyStringSchema,
  PositiveIntegerSchema,
} from "./primitives.js";

export const ClaimSchema = z
  .object({
    id: EvidenceIdSchema,
    text: NonEmptyStringSchema,
    source: z.string(),
    category: z.string().optional(),
    lineStart: PositiveIntegerSchema.optional(),
    lineEnd: PositiveIntegerSchema.optional(),
  })
  .strict()
  .superRefine((claim, context) => {
    if (
      claim.lineStart !== undefined &&
      claim.lineEnd !== undefined &&
      claim.lineEnd < claim.lineStart
    ) {
      context.addIssue({
        code: "custom",
        message: "lineEnd must be greater than or equal to lineStart",
        path: ["lineEnd"],
      });
    }
  });

export type Claim = z.infer<typeof ClaimSchema>;

export const ClaimVerdictSchema = z
  .object({
    id: EvidenceIdSchema,
    claimId: EvidenceIdSchema,
    status: ClaimVerdictStatusSchema,
    matchedEvidenceIds: z.array(EvidenceIdSchema),
    missingEvidence: z.array(z.string()).optional(),
    impact: z.string().optional(),
    nextAction: z.string().optional(),
  })
  .strict();

export type ClaimVerdict = z.infer<typeof ClaimVerdictSchema>;

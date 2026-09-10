import { z } from "zod";

import { ArtifactKindSchema, ArtifactStatusSchema } from "./enums.js";
import {
  EvidenceIdSchema,
  NonNegativeIntegerSchema,
} from "./primitives.js";

export const ArtifactResultSchema = z
  .object({
    id: EvidenceIdSchema,
    artifactId: z.string(),
    label: z.string(),
    path: z.string(),
    type: ArtifactKindSchema,
    required: z.boolean(),
    demoCritical: z.boolean().optional(),
    status: ArtifactStatusSchema,
    matchedPaths: z.array(z.string()),
    sizeBytes: NonNegativeIntegerSchema.optional(),
    modifiedAt: z.string().optional(),
    reason: z.string().optional(),
  })
  .strict();

export type ArtifactResult = z.infer<typeof ArtifactResultSchema>;

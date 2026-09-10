import { z } from "zod";

import { VerificationModeSchema } from "./enums.js";
import { NonEmptyStringSchema } from "./primitives.js";

export const VerificationRequestSchema = z
  .object({
    cwd: NonEmptyStringSchema,
    configPath: z.string().optional(),
    since: z.string().optional(),
    claimFile: z.string().optional(),
    outputDir: z.string().optional(),
    mode: VerificationModeSchema,
    dryRun: z.boolean().optional(),
    strict: z.boolean().optional(),
  })
  .strict();

export type VerificationRequest = z.infer<typeof VerificationRequestSchema>;

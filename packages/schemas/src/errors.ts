import { z } from "zod";

import { UnknownRecordSchema } from "./primitives.js";

// Error details are diagnostic extension data; keys vary by the producing tool.
export const PipelineErrorSchema = z
  .object({
    id: z.string(),
    message: z.string(),
    code: z.string(),
    details: UnknownRecordSchema.optional(),
    causedBy: z.string().optional(),
  })
  .strict();

export type PipelineError = z.infer<typeof PipelineErrorSchema>;

import { z } from "zod";

import { CommandStatusSchema } from "./enums.js";
import {
  EvidenceIdSchema,
  NonNegativeIntegerSchema,
  PositiveIntegerSchema,
} from "./primitives.js";

export const CommandPlanSchema = z
  .object({
    id: z.string(),
    label: z.string(),
    command: z.string(),
    args: z.array(z.string()),
    required: z.boolean(),
    timeoutMs: PositiveIntegerSchema,
    cwd: z.string(),
  })
  .strict();

export type CommandPlan = z.infer<typeof CommandPlanSchema>;

export const CommandResultSchema = z
  .object({
    id: EvidenceIdSchema,
    planId: z.string(),
    status: CommandStatusSchema,
    exitCode: z.number().optional(),
    startedAt: z.string().optional(),
    finishedAt: z.string().optional(),
    durationMs: NonNegativeIntegerSchema.optional(),
    stdoutLogPath: z.string().optional(),
    stderrLogPath: z.string().optional(),
    reason: z.string().optional(),
  })
  .strict();

export type CommandResult = z.infer<typeof CommandResultSchema>;

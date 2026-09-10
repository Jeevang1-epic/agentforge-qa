import { z } from "zod";

import {
  maxConfigArtifacts,
  maxConfigCommands,
} from "./constants.js";
import { ArtifactKindSchema } from "./enums.js";
import {
  NonEmptyStringSchema,
  NonNegativeIntegerSchema,
  PositiveIntegerSchema,
  SchemaVersionSchema,
  UnknownRecordSchema,
} from "./primitives.js";

export const ConfigCommandSchema = z
  .object({
    id: NonEmptyStringSchema,
    label: NonEmptyStringSchema,
    command: NonEmptyStringSchema,
    args: z.array(z.string()),
    required: z.boolean(),
    timeoutMs: PositiveIntegerSchema,
    cwd: z.string().optional(),
    claimKeywords: z.array(z.string()).optional(),
  })
  .strict();

export type ConfigCommand = z.infer<typeof ConfigCommandSchema>;

export const ConfigArtifactSchema = z
  .object({
    id: NonEmptyStringSchema,
    label: NonEmptyStringSchema,
    path: NonEmptyStringSchema,
    type: ArtifactKindSchema,
    required: z.boolean(),
    demoCritical: z.boolean().optional(),
    claimKeywords: z.array(z.string()).optional(),
    minSizeBytes: NonNegativeIntegerSchema.optional(),
  })
  .strict();

export type ConfigArtifact = z.infer<typeof ConfigArtifactSchema>;

// These v0.1 sections are extension points with no agreed field set yet.
// Keep values unknown rather than inventing fields or accepting untyped data.
export const ConfigSafetySchema = UnknownRecordSchema;

export type ConfigSafety = z.infer<typeof ConfigSafetySchema>;

export const ConfigReportingSchema = UnknownRecordSchema;

export type ConfigReporting = z.infer<typeof ConfigReportingSchema>;

export const ConfigGitSchema = UnknownRecordSchema;

export type ConfigGit = z.infer<typeof ConfigGitSchema>;

export const NormalizedConfigSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    commands: z.array(ConfigCommandSchema).max(maxConfigCommands),
    artifacts: z.array(ConfigArtifactSchema).max(maxConfigArtifacts),
    safety: ConfigSafetySchema.optional(),
    reporting: ConfigReportingSchema.optional(),
    git: ConfigGitSchema.optional(),
  })
  .strict();

export type NormalizedConfig = z.infer<typeof NormalizedConfigSchema>;

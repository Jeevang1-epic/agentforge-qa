import { z } from "zod";

import { schemaVersion } from "./constants.js";

export const NonEmptyStringSchema = z.string().min(1);

export const EvidenceIdSchema = NonEmptyStringSchema;
export type EvidenceId = z.infer<typeof EvidenceIdSchema>;

export const SchemaVersionSchema = z.literal(schemaVersion);
export type SchemaVersion = z.infer<typeof SchemaVersionSchema>;

export const NonNegativeIntegerSchema = z.number().int().nonnegative();
export const PositiveIntegerSchema = z.number().int().positive();

export const UnknownRecordSchema = z.record(z.string(), z.unknown());

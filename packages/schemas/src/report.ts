import { z } from "zod";

import { ArtifactResultSchema } from "./artifact.js";
import { ClaimSchema, ClaimVerdictSchema } from "./claim.js";
import { CommandResultSchema } from "./command.js";
import { DecisionSummarySchema } from "./decision-summary.js";
import {
  FinalVerdictSchema,
  ToolStatusSchema,
  VerificationModeSchema,
} from "./enums.js";
import { PipelineErrorSchema } from "./errors.js";
import { GitEvidenceSchema } from "./git.js";
import { SchemaVersionSchema, UnknownRecordSchema } from "./primitives.js";
import { RepoProfileSchema } from "./repo.js";
import { RiskFindingSchema, RiskScoreSummarySchema } from "./risk.js";

// Output path keys may expand as reporters are added, so v0.1 only requires an object.
export const ReportOutputPathsSchema = UnknownRecordSchema;

export type ReportOutputPaths = z.infer<typeof ReportOutputPathsSchema>;

export const VerificationReportSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    generatedAt: z.string(),
    toolStatus: ToolStatusSchema,
    finalVerdict: FinalVerdictSchema.optional(),
    mode: VerificationModeSchema,
    repo: RepoProfileSchema,
    git: GitEvidenceSchema.optional(),
    commands: z.array(CommandResultSchema),
    artifacts: z.array(ArtifactResultSchema),
    claims: z.array(ClaimSchema),
    claimVerdicts: z.array(ClaimVerdictSchema),
    risks: z.array(RiskFindingSchema),
    riskScore: RiskScoreSummarySchema,
    summary: z.string(),
    decisionSummary: DecisionSummarySchema,
    outputPaths: ReportOutputPathsSchema.optional(),
    errors: z.array(PipelineErrorSchema).optional(),
  })
  .strict();

export type VerificationReport = z.infer<typeof VerificationReportSchema>;

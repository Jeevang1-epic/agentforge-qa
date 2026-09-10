import { z } from "zod";

export const GitEvidenceSchema = z
  .object({
    since: z.string().optional(),
    changedFiles: z.array(z.string()),
    untrackedFiles: z.array(z.string()),
    deletedFiles: z.array(z.string()),
    dependencyFilesChanged: z.array(z.string()),
    summary: z.string(),
  })
  .strict();

export type GitEvidence = z.infer<typeof GitEvidenceSchema>;

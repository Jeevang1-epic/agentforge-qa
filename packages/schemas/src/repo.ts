import { z } from "zod";

export const RepoProfileSchema = z
  .object({
    root: z.string(),
    isGitRepo: z.boolean(),
    packageManager: z.string().optional(),
    detectedFrameworks: z.array(z.string()),
    notes: z.array(z.string()).optional(),
  })
  .strict();

export type RepoProfile = z.infer<typeof RepoProfileSchema>;

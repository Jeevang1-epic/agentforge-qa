import { lstat } from "node:fs/promises";

import {
  ArtifactResultSchema,
  type ArtifactResult,
  type ConfigArtifact,
} from "@agentforge-qa/schemas";

import {
  resolveExistingAncestorInsideRepo,
  resolveExistingPathInsideRepo,
  resolvePathInsideRepo,
  toRepoRelativePath,
} from "../commands/command-paths.js";
import { createArtifactEvidenceId } from "../evidence/evidence-ids.js";
import { searchArtifactGlob } from "./search-artifact-glob.js";

function baseArtifactResult(artifact: ConfigArtifact): Omit<
  ArtifactResult,
  "matchedPaths" | "status"
> {
  return {
    id: createArtifactEvidenceId(artifact.id),
    artifactId: artifact.id,
    label: artifact.label,
    path: artifact.path,
    type: artifact.type,
    required: artifact.required,
    ...(artifact.demoCritical === undefined
      ? {}
      : { demoCritical: artifact.demoCritical }),
  };
}

function createArtifactResult(
  artifact: ConfigArtifact,
  result: Pick<ArtifactResult, "matchedPaths" | "status"> &
    Partial<Pick<ArtifactResult, "modifiedAt" | "reason" | "sizeBytes">>,
): ArtifactResult {
  return ArtifactResultSchema.parse({
    ...baseArtifactResult(artifact),
    ...result,
  });
}

function isMissingPathError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

async function checkGlobArtifact(
  artifact: ConfigArtifact,
  repoRoot: string,
): Promise<ArtifactResult> {
  try {
    const searchResult = await searchArtifactGlob(repoRoot, artifact.path);

    if (searchResult.error !== undefined) {
      return createArtifactResult(artifact, {
        status: "error",
        matchedPaths: [],
        reason: searchResult.error,
      });
    }

    return createArtifactResult(artifact, {
      status: searchResult.matches.length > 0 ? "found" : "missing",
      matchedPaths: searchResult.matches,
      ...(searchResult.matches.length > 0
        ? {}
        : { reason: "No paths matched the bounded artifact glob." }),
    });
  } catch {
    return createArtifactResult(artifact, {
      status: "error",
      matchedPaths: [],
      reason: "Artifact glob search could not complete safely.",
    });
  }
}

async function checkPathArtifact(
  artifact: ConfigArtifact,
  repoRoot: string,
): Promise<ArtifactResult> {
  const pathReview = resolvePathInsideRepo(repoRoot, artifact.path, "artifact path");

  if (!pathReview.approved || pathReview.path === undefined) {
    return createArtifactResult(artifact, {
      status: "error",
      matchedPaths: [],
      reason: pathReview.reason,
    });
  }

  const ancestorReview = await resolveExistingAncestorInsideRepo(
    repoRoot,
    pathReview.path,
    "artifact path",
  );

  if (!ancestorReview.approved) {
    return createArtifactResult(artifact, {
      status: "error",
      matchedPaths: [],
      reason: ancestorReview.reason,
    });
  }

  try {
    const stats = await lstat(pathReview.path);

    if (stats.isSymbolicLink()) {
      return createArtifactResult(artifact, {
        status: "error",
        matchedPaths: [],
        reason: "Artifact paths must not be symbolic links in v0.1.",
      });
    }

    const existingPathReview = await resolveExistingPathInsideRepo(
      repoRoot,
      pathReview.path,
      "artifact path",
    );

    if (!existingPathReview.approved || existingPathReview.path === undefined) {
      return createArtifactResult(artifact, {
        status: "error",
        matchedPaths: [],
        reason: existingPathReview.reason,
      });
    }

    const expectedKindFound =
      artifact.type === "file" ? stats.isFile() : stats.isDirectory();

    if (!expectedKindFound) {
      return createArtifactResult(artifact, {
        status: "missing",
        matchedPaths: [],
        reason: `The configured artifact is not a ${artifact.type}.`,
      });
    }

    const matchedPath = toRepoRelativePath(repoRoot, existingPathReview.path);

    if (
      artifact.type === "file" &&
      artifact.minSizeBytes !== undefined &&
      stats.size < artifact.minSizeBytes
    ) {
      return createArtifactResult(artifact, {
        status: "missing",
        matchedPaths: [matchedPath],
        sizeBytes: stats.size,
        modifiedAt: stats.mtime.toISOString(),
        reason: `File size is below the required ${artifact.minSizeBytes} bytes.`,
      });
    }

    return createArtifactResult(artifact, {
      status: "found",
      matchedPaths: [matchedPath],
      ...(artifact.type === "file" ? { sizeBytes: stats.size } : {}),
      modifiedAt: stats.mtime.toISOString(),
    });
  } catch (error) {
    return createArtifactResult(artifact, {
      status: isMissingPathError(error) ? "missing" : "error",
      matchedPaths: [],
      reason: isMissingPathError(error)
        ? "The configured artifact path was not found."
        : "The configured artifact path could not be checked safely.",
    });
  }
}

export async function checkArtifacts(
  artifacts: readonly ConfigArtifact[],
  repoRoot: string,
): Promise<ArtifactResult[]> {
  const results: ArtifactResult[] = [];

  for (const artifact of artifacts) {
    results.push(
      artifact.type === "glob"
        ? await checkGlobArtifact(artifact, repoRoot)
        : await checkPathArtifact(artifact, repoRoot),
    );
  }

  return ArtifactResultSchema.array().parse(results);
}

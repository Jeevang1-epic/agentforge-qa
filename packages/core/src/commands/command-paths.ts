import { realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep, win32 } from "node:path";

const controlCharacterPattern = /[\0-\x1F\x7F]/;
const windowsDrivePattern = /^[A-Za-z]:/;

export interface ResolvedCommandPath {
  approved: boolean;
  code: string;
  reason: string;
  path?: string;
}

export function isPathInsideRepo(repoRoot: string, candidatePath: string): boolean {
  const relativePath = relative(resolve(repoRoot), resolve(candidatePath));

  return (
    relativePath === "" ||
    (!relativePath.startsWith(`..${sep}`) &&
      relativePath !== ".." &&
      !isAbsolute(relativePath))
  );
}

export function resolvePathInsideRepo(
  repoRoot: string,
  requestedPath: string,
  label: string,
): ResolvedCommandPath {
  const codeLabel = label.toUpperCase().replaceAll(" ", "_");

  if (controlCharacterPattern.test(repoRoot)) {
    return {
      approved: false,
      code: "REPO_ROOT_CONTROL_CHARACTER_REJECTED",
      reason: "Repository root must not contain control characters.",
    };
  }

  if (repoRoot.trim().length === 0) {
    return {
      approved: false,
      code: "REPO_ROOT_REQUIRED",
      reason: "A repository root is required.",
    };
  }

  if (requestedPath.trim().length === 0) {
    return {
      approved: false,
      code: `${codeLabel}_REQUIRED`,
      reason: `${label} is required.`,
    };
  }

  if (controlCharacterPattern.test(requestedPath)) {
    return {
      approved: false,
      code: `${codeLabel}_CONTROL_CHARACTER_REJECTED`,
      reason: `${label} must not contain control characters.`,
    };
  }

  if (
    !isAbsolute(requestedPath) &&
    (win32.isAbsolute(requestedPath) || windowsDrivePattern.test(requestedPath))
  ) {
    return {
      approved: false,
      code: `${codeLabel}_OUTSIDE_REPO`,
      reason: `${label} must resolve inside the repository root.`,
    };
  }

  const normalizedRepoRoot = resolve(repoRoot);
  const normalizedPath = isAbsolute(requestedPath)
    ? resolve(requestedPath)
    : resolve(normalizedRepoRoot, requestedPath);

  if (!isPathInsideRepo(normalizedRepoRoot, normalizedPath)) {
    return {
      approved: false,
      code: `${codeLabel}_OUTSIDE_REPO`,
      reason: `${label} must resolve inside the repository root.`,
    };
  }

  return {
    approved: true,
    code: "APPROVED",
    reason: `${label} resolves inside the repository root.`,
    path: normalizedPath,
  };
}

function isMissingPathError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

export async function resolveExistingPathInsideRepo(
  repoRoot: string,
  requestedPath: string,
  label: string,
): Promise<ResolvedCommandPath> {
  const lexicalReview = resolvePathInsideRepo(repoRoot, requestedPath, label);

  if (!lexicalReview.approved || lexicalReview.path === undefined) {
    return lexicalReview;
  }

  try {
    const [realRepoRoot, realRequestedPath] = await Promise.all([
      realpath(resolve(repoRoot)),
      realpath(lexicalReview.path),
    ]);

    if (!isPathInsideRepo(realRepoRoot, realRequestedPath)) {
      return {
        approved: false,
        code: `${label.toUpperCase().replaceAll(" ", "_")}_OUTSIDE_REPO`,
        reason: `${label} must resolve inside the repository root.`,
      };
    }

    return {
      approved: true,
      code: "APPROVED",
      reason: `${label} resolves to an existing path inside the repository root.`,
      path: realRequestedPath,
    };
  } catch (error) {
    return {
      approved: false,
      code: isMissingPathError(error)
        ? `${label.toUpperCase().replaceAll(" ", "_")}_NOT_FOUND`
        : `${label.toUpperCase().replaceAll(" ", "_")}_RESOLUTION_ERROR`,
      reason: isMissingPathError(error)
        ? `${label} must exist before command execution.`
        : `${label} could not be safely resolved.`,
    };
  }
}

export async function resolveExistingAncestorInsideRepo(
  repoRoot: string,
  requestedPath: string,
  label: string,
): Promise<ResolvedCommandPath> {
  const lexicalReview = resolvePathInsideRepo(repoRoot, requestedPath, label);

  if (!lexicalReview.approved || lexicalReview.path === undefined) {
    return lexicalReview;
  }

  let candidate = lexicalReview.path;

  while (true) {
    const review = await resolveExistingPathInsideRepo(repoRoot, candidate, label);

    if (review.approved) {
      return {
        ...lexicalReview,
        reason: `${label} has an existing ancestor inside the repository root.`,
      };
    }

    if (!review.code.endsWith("_NOT_FOUND")) {
      return review;
    }

    const parent = dirname(candidate);

    if (parent === candidate) {
      return review;
    }

    candidate = parent;
  }
}

export function toRepoRelativePath(repoRoot: string, targetPath: string): string {
  return relative(resolve(repoRoot), resolve(targetPath)).replaceAll("\\", "/");
}

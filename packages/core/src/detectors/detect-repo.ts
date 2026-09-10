import { lstat, realpath, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { RepoProfileSchema, type RepoProfile } from "@agentforge-qa/schemas";

import { EvidenceModuleError } from "../errors/pipeline-errors.js";

type PathKind = "directory" | "file" | "missing" | "other";

interface GitRootDetection {
  markerKind: "directory" | "file";
  root: string;
}

async function getPathKind(path: string): Promise<PathKind> {
  try {
    const stats = await lstat(path);

    if (stats.isDirectory()) {
      return "directory";
    }

    if (stats.isFile()) {
      return "file";
    }

    return "other";
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return "missing";
    }

    throw error;
  }
}

async function findGitRoot(
  startPath: string,
): Promise<GitRootDetection | undefined> {
  let candidate = startPath;

  while (true) {
    const markerKind = await getPathKind(join(candidate, ".git"));

    if (markerKind === "directory" || markerKind === "file") {
      return {
        markerKind,
        root: candidate,
      };
    }

    const parent = dirname(candidate);

    if (parent === candidate) {
      return undefined;
    }

    candidate = parent;
  }
}

async function detectPackageManager(root: string): Promise<string | undefined> {
  for (const [lockfile, packageManager] of [
    ["pnpm-lock.yaml", "pnpm"],
    ["package-lock.json", "npm"],
    ["yarn.lock", "yarn"],
  ] as const) {
    if ((await getPathKind(join(root, lockfile))) === "file") {
      return packageManager;
    }
  }

  return undefined;
}

async function detectFrameworks(root: string): Promise<string[]> {
  const names = new Set(
    (await readdir(root, { withFileTypes: true })).map((entry) =>
      entry.name.toLowerCase(),
    ),
  );
  const frameworks: string[] = [];

  if (names.has("package.json")) {
    frameworks.push("node");
  }

  if (names.has("pyproject.toml") || names.has("requirements.txt")) {
    frameworks.push("python");
  }

  if ([...names].some((name) => name.startsWith("vite.config."))) {
    frameworks.push("vite");
  }

  if ([...names].some((name) => name.startsWith("next.config."))) {
    frameworks.push("next");
  }

  return frameworks;
}

export async function detectRepo(cwd: string): Promise<RepoProfile> {
  let realCwd: string;

  try {
    realCwd = await realpath(resolve(cwd));
  } catch {
    throw new EvidenceModuleError(
      "REPO_CWD_NOT_FOUND",
      "The verification cwd must resolve to an existing local directory.",
    );
  }

  if ((await getPathKind(realCwd)) !== "directory") {
    throw new EvidenceModuleError(
      "REPO_CWD_NOT_DIRECTORY",
      "The verification cwd must be a directory.",
    );
  }

  const gitRoot = await findGitRoot(realCwd);
  const root = gitRoot?.root ?? realCwd;
  const isGitRepo = gitRoot !== undefined;
  const packageManager = await detectPackageManager(root);
  const notes =
    gitRoot?.markerKind === "file"
      ? [
          "Detected a .git file marker; read-only Git evidence will confirm the worktree root.",
        ]
      : isGitRepo
        ? []
        : ["No .git directory or worktree file was found at the cwd or its ancestors."];

  return RepoProfileSchema.parse({
    root,
    isGitRepo,
    ...(packageManager === undefined ? {} : { packageManager }),
    detectedFrameworks: await detectFrameworks(root),
    ...(notes.length === 0 ? {} : { notes }),
  });
}

import { readdir } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

import {
  resolveExistingPathInsideRepo,
  resolvePathInsideRepo,
} from "../commands/command-paths.js";

const ignoredDirectoryNames = new Set([
  ".git",
  "coverage",
  "dist",
  "node_modules",
]);
const MAX_GLOB_ENTRIES = 10_000;
const MAX_GLOB_MATCHES = 1_000;
const MAX_GLOB_DEPTH = 20;

export interface ArtifactGlobSearchResult {
  error?: string;
  matches: string[];
}

function escapeRegexCharacter(character: string): string {
  return /[\\^$.*+?()[\]{}|]/.test(character) ? `\\${character}` : character;
}

function globPatternToRegex(pattern: string): RegExp {
  let expression = "^";

  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index] ?? "";

    if (character === "*" && pattern[index + 1] === "*") {
      if (pattern[index + 2] === "/") {
        expression += "(?:.*/)?";
        index += 2;
      } else {
        expression += ".*";
        index += 1;
      }
    } else if (character === "*") {
      expression += "[^/]*";
    } else if (character === "?") {
      expression += "[^/]";
    } else {
      expression += escapeRegexCharacter(character);
    }
  }

  return new RegExp(`${expression}$`);
}

function validateGlobPattern(repoRoot: string, pattern: string): string | undefined {
  const normalizedPattern = pattern.replaceAll("\\", "/");
  const pathReview = resolvePathInsideRepo(repoRoot, pattern, "artifact glob");

  if (!pathReview.approved) {
    return pathReview.reason;
  }

  if (
    isAbsolute(pattern) ||
    normalizedPattern.split("/").includes("..") ||
    /[\0-\x1F\x7F]/.test(pattern)
  ) {
    return "Artifact glob must be a safe relative pattern inside the repository.";
  }

  return /[\[\]{}]/.test(pattern)
    ? "Artifact glob uses unsupported pattern syntax."
    : undefined;
}

function isIgnoredPath(relativePath: string, name: string): boolean {
  return (
    ignoredDirectoryNames.has(name) ||
    relativePath === ".agentforge/logs" ||
    relativePath.startsWith(".agentforge/logs/")
  );
}

export async function searchArtifactGlob(
  repoRoot: string,
  pattern: string,
): Promise<ArtifactGlobSearchResult> {
  const patternError = validateGlobPattern(repoRoot, pattern);

  if (patternError !== undefined) {
    return { error: patternError, matches: [] };
  }

  const rootReview = await resolveExistingPathInsideRepo(
    repoRoot,
    repoRoot,
    "repo root",
  );

  if (!rootReview.approved || rootReview.path === undefined) {
    return { error: rootReview.reason, matches: [] };
  }

  const matcher = globPatternToRegex(pattern.replaceAll("\\", "/"));
  const matches: string[] = [];
  const directories = [{ depth: 0, path: rootReview.path, relativePath: "" }];
  let visitedEntries = 0;

  while (directories.length > 0) {
    const directory = directories.pop();

    if (directory === undefined) {
      break;
    }

    const entries = await readdir(directory.path, { withFileTypes: true });

    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      visitedEntries += 1;

      if (visitedEntries > MAX_GLOB_ENTRIES) {
        return {
          error: `Artifact glob exceeded the ${MAX_GLOB_ENTRIES} entry safety limit.`,
          matches: [],
        };
      }

      if (entry.isSymbolicLink()) {
        continue;
      }

      const relativePath =
        directory.relativePath.length === 0
          ? entry.name
          : `${directory.relativePath}/${entry.name}`;

      if (isIgnoredPath(relativePath, entry.name)) {
        continue;
      }

      if (matcher.test(relativePath)) {
        matches.push(relativePath);

        if (matches.length > MAX_GLOB_MATCHES) {
          return {
            error: `Artifact glob exceeded the ${MAX_GLOB_MATCHES} match safety limit.`,
            matches: [],
          };
        }
      }

      if (entry.isDirectory()) {
        if (directory.depth >= MAX_GLOB_DEPTH) {
          return {
            error: `Artifact glob exceeded the ${MAX_GLOB_DEPTH} directory-depth safety limit.`,
            matches: [],
          };
        }

        directories.push({
          depth: directory.depth + 1,
          path: join(directory.path, entry.name),
          relativePath,
        });
      }
    }
  }

  return { matches: matches.sort() };
}

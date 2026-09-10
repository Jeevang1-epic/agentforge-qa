import { lstat, readFile } from "node:fs/promises";
import { extname } from "node:path";

import {
  NormalizedConfigSchema,
  schemaVersion,
  type NormalizedConfig,
} from "@agentforge-qa/schemas";

import { EvidenceModuleError } from "../errors/pipeline-errors.js";
import {
  resolveExistingAncestorInsideRepo,
  resolveExistingPathInsideRepo,
  toRepoRelativePath,
} from "../commands/command-paths.js";

const MAX_CONFIG_FILE_BYTES = 1_000_000;
const DEFAULT_CONFIG_PATHS = [
  "agentforge.config.json",
  ".agentforge/config.json",
] as const;

export interface LoadedConfig {
  config: NormalizedConfig;
  configPath?: string;
  found: boolean;
  summary: string;
}

function createDefaultConfig(): NormalizedConfig {
  return NormalizedConfigSchema.parse({
    schemaVersion,
    commands: [],
    artifacts: [],
  });
}

function isMissingPathCode(code: string): boolean {
  return code.endsWith("_NOT_FOUND");
}

async function readConfigCandidate(
  repoRoot: string,
  requestedPath: string,
  explicit: boolean,
): Promise<LoadedConfig | undefined> {
  if (extname(requestedPath).toLowerCase() !== ".json") {
    throw new EvidenceModuleError(
      "UNSUPPORTED_CONFIG_TYPE",
      "Only JSON configuration files are supported in v0.1.",
    );
  }

  const ancestorReview = await resolveExistingAncestorInsideRepo(
    repoRoot,
    requestedPath,
    "config path",
  );

  if (!ancestorReview.approved) {
    throw new EvidenceModuleError(ancestorReview.code, ancestorReview.reason);
  }

  const pathReview = await resolveExistingPathInsideRepo(
    repoRoot,
    requestedPath,
    "config path",
  );

  if (!pathReview.approved || pathReview.path === undefined) {
    if (!explicit && isMissingPathCode(pathReview.code)) {
      return undefined;
    }

    throw new EvidenceModuleError(pathReview.code, pathReview.reason);
  }

  const stats = await lstat(pathReview.path);

  if (!stats.isFile() || stats.size > MAX_CONFIG_FILE_BYTES) {
    throw new EvidenceModuleError(
      "INVALID_CONFIG_FILE",
      `Config must be a JSON file no larger than ${MAX_CONFIG_FILE_BYTES} bytes.`,
    );
  }

  let contents: string;
  try {
    contents = await readFile(pathReview.path, "utf8");
  } catch (error) {
    throw new EvidenceModuleError(
      "CONFIG_READ_ERROR",
      "The AgentForge QA config file could not be read safely.",
      {
        causedBy: error instanceof Error ? error.message : String(error),
      },
    );
  }

  let parsedJson: unknown;
  try {
    const normalizedContents = contents.charCodeAt(0) === 0xfeff
      ? contents.slice(1)
      : contents;
    parsedJson = JSON.parse(normalizedContents) as unknown;
  } catch (error) {
    throw new EvidenceModuleError(
      "INVALID_CONFIG_JSON",
      "The AgentForge QA config file is not valid JSON.",
      {
        causedBy: error instanceof Error ? error.message : String(error),
      },
    );
  }

  const configResult = NormalizedConfigSchema.safeParse(parsedJson);

  if (!configResult.success) {
    throw new EvidenceModuleError(
      "INVALID_CONFIG",
      "The AgentForge QA config does not match NormalizedConfigSchema.",
      {
        issues: configResult.error.issues.map((issue) => ({
          message: issue.message,
          path: issue.path.map(String).join("."),
        })),
      },
    );
  }

  const configPath = toRepoRelativePath(repoRoot, pathReview.path);

  return {
    config: configResult.data,
    configPath,
    found: true,
    summary: `Loaded JSON configuration from ${configPath}.`,
  };
}

export async function loadConfig(
  repoRoot: string,
  requestedPath?: string,
): Promise<LoadedConfig> {
  const rootReview = await resolveExistingPathInsideRepo(
    repoRoot,
    repoRoot,
    "repo root",
  );

  if (!rootReview.approved || rootReview.path === undefined) {
    throw new EvidenceModuleError(rootReview.code, rootReview.reason);
  }

  const canonicalRepoRoot = rootReview.path;

  if (requestedPath !== undefined) {
    const loaded = await readConfigCandidate(
      canonicalRepoRoot,
      requestedPath,
      true,
    );

    if (loaded === undefined) {
      throw new EvidenceModuleError(
        "CONFIG_NOT_FOUND",
        "The requested AgentForge QA config file was not found.",
      );
    }

    return loaded;
  }

  for (const defaultPath of DEFAULT_CONFIG_PATHS) {
    const loaded = await readConfigCandidate(
      canonicalRepoRoot,
      defaultPath,
      false,
    );

    if (loaded !== undefined) {
      return loaded;
    }
  }

  return {
    config: createDefaultConfig(),
    found: false,
    summary:
      "No AgentForge QA JSON config was found; using an empty default config.",
  };
}

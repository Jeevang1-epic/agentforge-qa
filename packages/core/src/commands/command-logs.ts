import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { redactCommandText } from "./command-redaction.js";
import {
  resolveExistingAncestorInsideRepo,
  resolveExistingPathInsideRepo,
  resolvePathInsideRepo,
  toRepoRelativePath,
  type ResolvedCommandPath,
} from "./command-paths.js";

export const DEFAULT_COMMAND_LOG_DIRECTORY = ".agentforge/logs";
export const DEFAULT_MAX_CAPTURE_BYTES = 1_000_000;
export const MAX_CAPTURE_BYTES = 5_000_000;

export interface OutputCollector {
  append(chunk: Uint8Array | string): void;
  isTruncated(): boolean;
  toString(): string;
}

export interface CommandLogOptions {
  repoRoot: string;
  logDirectory?: string;
  maxCaptureBytes?: number;
}

export interface CommandLogPaths {
  stdoutLogPath: string;
  stderrLogPath: string;
}

export async function reviewCommandLogDirectory(
  options: CommandLogOptions,
): Promise<ResolvedCommandPath> {
  const logDirectoryReview = resolvePathInsideRepo(
    options.repoRoot,
    options.logDirectory ?? DEFAULT_COMMAND_LOG_DIRECTORY,
    "log directory",
  );

  if (!logDirectoryReview.approved || logDirectoryReview.path === undefined) {
    return logDirectoryReview;
  }

  const ancestorReview = await resolveExistingAncestorInsideRepo(
    options.repoRoot,
    logDirectoryReview.path,
    "log directory",
  );

  return ancestorReview.approved ? logDirectoryReview : ancestorReview;
}

export function createOutputCollector(
  maxCaptureBytes = DEFAULT_MAX_CAPTURE_BYTES,
): OutputCollector {
  const captureLimit =
    Number.isInteger(maxCaptureBytes) && maxCaptureBytes > 0
      ? Math.min(maxCaptureBytes, MAX_CAPTURE_BYTES)
      : DEFAULT_MAX_CAPTURE_BYTES;
  const chunks: Buffer[] = [];
  let capturedBytes = 0;
  let truncated = false;

  return {
    append(chunk): void {
      if (capturedBytes >= captureLimit) {
        truncated = true;
        return;
      }

      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      const remainingBytes = captureLimit - capturedBytes;
      const capturedChunk =
        buffer.length > remainingBytes ? buffer.subarray(0, remainingBytes) : buffer;

      chunks.push(capturedChunk);
      capturedBytes += capturedChunk.length;
      truncated ||= capturedChunk.length < buffer.length;
    },
    isTruncated(): boolean {
      return truncated;
    },
    toString(): string {
      const output = Buffer.concat(chunks).toString("utf8");

      return truncated ? `${output}\n[OUTPUT TRUNCATED]\n` : output;
    },
  };
}

function sanitizeLogName(planId: string): string {
  const sanitized = redactCommandText(planId)
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/\.+/g, "-")
    .replace(/^-+|-+$/g, "");

  return sanitized.length > 0 ? sanitized.slice(0, 80) : "command";
}

export async function writeCommandLogs(
  planId: string,
  startedAt: string,
  stdout: string,
  stderr: string,
  options: CommandLogOptions,
): Promise<CommandLogPaths> {
  const logDirectoryReview = await reviewCommandLogDirectory(options);

  if (!logDirectoryReview.approved || logDirectoryReview.path === undefined) {
    throw new Error(logDirectoryReview.reason);
  }

  await mkdir(logDirectoryReview.path, { recursive: true });

  const existingLogDirectoryReview = await resolveExistingPathInsideRepo(
    options.repoRoot,
    logDirectoryReview.path,
    "log directory",
  );

  if (
    !existingLogDirectoryReview.approved ||
    existingLogDirectoryReview.path === undefined
  ) {
    throw new Error(existingLogDirectoryReview.reason);
  }

  const logStem = `${sanitizeLogName(planId)}-${startedAt.replace(/\D/g, "")}`;
  const stdoutPath = join(
    existingLogDirectoryReview.path,
    `${logStem}.stdout.log`,
  );
  const stderrPath = join(
    existingLogDirectoryReview.path,
    `${logStem}.stderr.log`,
  );

  await Promise.all([
    writeFile(stdoutPath, redactCommandText(stdout), {
      encoding: "utf8",
      flag: "wx",
    }),
    writeFile(stderrPath, redactCommandText(stderr), {
      encoding: "utf8",
      flag: "wx",
    }),
  ]);

  const realRepoRootReview = await resolveExistingPathInsideRepo(
    options.repoRoot,
    options.repoRoot,
    "repo root",
  );

  if (!realRepoRootReview.approved || realRepoRootReview.path === undefined) {
    throw new Error(realRepoRootReview.reason);
  }

  return {
    stdoutLogPath: toRepoRelativePath(realRepoRootReview.path, stdoutPath),
    stderrLogPath: toRepoRelativePath(realRepoRootReview.path, stderrPath),
  };
}

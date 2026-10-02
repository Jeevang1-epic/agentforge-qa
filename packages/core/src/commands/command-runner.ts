import { spawn } from "node:child_process";

import {
  CommandResultSchema,
  type CommandPlan,
  type CommandResult,
} from "@agentforge-qa/schemas";

import { createCommandEvidenceId } from "../evidence/evidence-ids.js";
import { normalizeCommandName } from "./command-policy.js";
import {
  createOutputCollector,
  reviewCommandLogDirectory,
  writeCommandLogs,
  type CommandLogOptions,
} from "./command-logs.js";
import { redactCommandText } from "./command-redaction.js";
import { resolveExistingPathInsideRepo } from "./command-paths.js";
import {
  reviewCommandSafety,
  type CommandSafetyOptions,
  type CommandSafetyReview,
} from "./command-safety.js";
import { resolveKillGraceMs } from "./command-timeouts.js";

export interface CommandRunOptions extends CommandSafetyOptions, CommandLogOptions {
  dryRun?: boolean;
  killGraceMs?: number;
  persistLogs?: boolean;
}

export interface CommandExecution {
  stdoutTruncated?: boolean;
  result: CommandResult;
  stderr: string;
  stdout: string;
}

interface ProcessOutcome {
  exitCode?: number;
  error?: unknown;
  timedOut: boolean;
}

const allowedEnvironmentKeys = new Set([
  "APPDATA",
  "CI",
  "COMSPEC",
  "HOME",
  "LOCALAPPDATA",
  "NUMBER_OF_PROCESSORS",
  "PATH",
  "PATHEXT",
  "PROCESSOR_ARCHITECTURE",
  "PROGRAMFILES",
  "PROGRAMFILES(X86)",
  "PWD",
  "SYSTEMROOT",
  "TEMP",
  "TMP",
  "USER",
  "USERNAME",
  "USERPROFILE",
  "WINDIR",
]);

export function createCommandEnvironment(
  source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};

  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined && allowedEnvironmentKeys.has(key.toUpperCase())) {
      environment[key] = value;
    }
  }

  return environment;
}

function createSkippedResult(plan: CommandPlan, reason: string): CommandResult {
  return CommandResultSchema.parse({
    id: createCommandEvidenceId(plan.id),
    planId: plan.id,
    status: "skipped",
    reason: redactCommandText(reason),
  });
}

function createSkippedExecution(
  plan: CommandPlan,
  reason: string,
): CommandExecution {
  return {
    result: createSkippedResult(plan, reason),
    stderr: "",
    stdout: "",
  };
}

function createErrorResult(
  plan: CommandPlan,
  startedAt: string,
  startedAtMs: number,
  error: unknown,
  logPaths: Partial<Pick<CommandResult, "stderrLogPath" | "stdoutLogPath">> = {},
): CommandResult {
  const finishedAtMs = Date.now();
  const message = error instanceof Error ? error.message : String(error);

  return CommandResultSchema.parse({
    id: createCommandEvidenceId(plan.id),
    planId: plan.id,
    status: "error",
    startedAt,
    finishedAt: new Date(finishedAtMs).toISOString(),
    durationMs: Math.max(0, finishedAtMs - startedAtMs),
    ...logPaths,
    reason: redactCommandText(`Command runner error: ${message}`),
  });
}

async function executeApprovedCommand(
  plan: CommandPlan,
  review: CommandSafetyReview,
  options: CommandRunOptions,
): Promise<CommandExecution> {
  if (
    !review.approved ||
    review.normalizedCwd === undefined ||
    review.timeoutMs === undefined
  ) {
    return createSkippedExecution(
      plan,
      `Safety review rejected command: ${review.code}. ${review.reason}`,
    );
  }

  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();
  const stdout = createOutputCollector(options.maxCaptureBytes);
  const stderr = createOutputCollector(options.maxCaptureBytes);

  try {
    const cwdReview = await resolveExistingPathInsideRepo(
      options.repoRoot,
      review.normalizedCwd,
      "cwd",
    );

    if (!cwdReview.approved || cwdReview.path === undefined) {
      return createSkippedExecution(
        plan,
        `Safety review rejected command: ${cwdReview.code}. ${cwdReview.reason}`,
      );
    }

    const logDirectoryReview = options.persistLogs === false
      ? { approved: true, code: "APPROVED", reason: "In-memory capture only." }
      : await reviewCommandLogDirectory(options);

    if (!logDirectoryReview.approved) {
      return createSkippedExecution(
        plan,
        `Safety review rejected command: ${logDirectoryReview.code}. ${logDirectoryReview.reason}`,
      );
    }

    const executable =
      normalizeCommandName(review.normalizedCommand) === "node"
        ? process.execPath
        : review.normalizedCommand;
    const child = spawn(executable, review.normalizedArgs, {
      cwd: cwdReview.path,
      env: {
        ...createCommandEnvironment(),
        ...(normalizeCommandName(review.normalizedCommand) === "git"
          ? { GIT_NO_LAZY_FETCH: "1", GIT_TERMINAL_PROMPT: "0" }
          : {}),
      },
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    child.stdout.on("data", (chunk: Buffer) => stdout.append(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.append(chunk));

    const outcome = await new Promise<ProcessOutcome>((resolve) => {
      let settled = false;
      let timedOut = false;
      let forceKillTimer: NodeJS.Timeout | undefined;

      const finish = (result: ProcessOutcome): void => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(timeoutTimer);

        if (forceKillTimer !== undefined) {
          clearTimeout(forceKillTimer);
        }

        resolve(result);
      };

      const timeoutTimer = setTimeout(() => {
        timedOut = true;
        child.kill();
        forceKillTimer = setTimeout(() => {
          child.kill("SIGKILL");
        }, resolveKillGraceMs(options.killGraceMs));
      }, review.timeoutMs);

      child.once("error", (error) => finish({ error, timedOut }));
      child.once("close", (exitCode) =>
        finish({
          ...(exitCode === null ? {} : { exitCode }),
          timedOut,
        }),
      );
    });

    const finishedAtMs = Date.now();
    const capturedStdout = stdout.toString();
    const capturedStderr = stderr.toString();
    const logPaths = options.persistLogs === false ? {} : await writeCommandLogs(
      plan.id,
      startedAt,
      capturedStdout,
      capturedStderr,
      options,
    );

    if (outcome.error !== undefined) {
      return {
        result: createErrorResult(
          plan,
          startedAt,
          startedAtMs,
          outcome.error,
          logPaths,
        ),
        stderr: capturedStderr,
        stdout: capturedStdout,
        stdoutTruncated: stdout.isTruncated(),
      };
    }

    const status = outcome.timedOut
      ? "timed_out"
      : outcome.exitCode === 0
        ? "passed"
        : "failed";

    return {
      result: CommandResultSchema.parse({
        id: createCommandEvidenceId(plan.id),
        planId: plan.id,
        status,
        ...(outcome.exitCode === undefined
          ? {}
          : { exitCode: outcome.exitCode }),
        startedAt,
        finishedAt: new Date(finishedAtMs).toISOString(),
        durationMs: Math.max(0, finishedAtMs - startedAtMs),
        ...logPaths,
        ...(outcome.timedOut
          ? { reason: `Command exceeded its ${review.timeoutMs}ms timeout.` }
          : {}),
      }),
      stderr: capturedStderr,
      stdout: capturedStdout,
      stdoutTruncated: stdout.isTruncated(),
    };
  } catch (error) {
    return {
      result: createErrorResult(plan, startedAt, startedAtMs, error),
      stderr: stderr.toString(),
      stdout: stdout.toString(),
      stdoutTruncated: stdout.isTruncated(),
    };
  }
}

export async function runApprovedCommandWithOutput(
  plan: CommandPlan,
  options: CommandRunOptions,
): Promise<CommandExecution> {
  const stablePlan: CommandPlan = {
    ...plan,
    args: [...plan.args],
  };
  const stableOptions: CommandRunOptions = { ...options };
  const review = reviewCommandSafety(stablePlan, stableOptions);

  if (!review.approved) {
    return createSkippedExecution(
      stablePlan,
      `Safety review rejected command: ${review.code}. ${review.reason}`,
    );
  }

  if (stableOptions.dryRun === true) {
    return createSkippedExecution(
      stablePlan,
      "Dry run requested; command was not executed.",
    );
  }

  return executeApprovedCommand(stablePlan, review, stableOptions);
}

export async function runApprovedCommand(
  plan: CommandPlan,
  options: CommandRunOptions,
): Promise<CommandResult> {
  return (await runApprovedCommandWithOutput(plan, options)).result;
}

export async function runCommandPlan(
  plan: CommandPlan,
  options: CommandRunOptions,
): Promise<CommandResult> {
  return runApprovedCommand(plan, options);
}

export async function runCommandPlanWithOutput(
  plan: CommandPlan,
  options: CommandRunOptions,
): Promise<CommandExecution> {
  return runApprovedCommandWithOutput(plan, options);
}

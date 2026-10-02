#!/usr/bin/env node

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { runVerification } from "@agentforge-qa/core";
import { renderReport, type ReportFormat } from "@agentforge-qa/reporters";
import type { VerificationReport, VerificationRequest } from "@agentforge-qa/schemas";

export const CLI_VERSION = "0.3.0";

export const CLI_HELP = `AgentForge QA ${CLI_VERSION}

Local-first verification for AI coding-agent work.

Usage:
  agentforge-qa --help
  agentforge-qa --version
  agentforge-qa verify [repo] [options]

Available options:
  --help, -h           Show this help text
  --version, -v        Show the CLI version

Verify options:
  --config <path>      Use a JSON AgentForge QA config path
  --claims <path>      Use a Markdown or text claim file
  --since <ref>        Use a Git base/ref for changed-file evidence
  --format <markdown|json>
                       Render Markdown or JSON to stdout (default: markdown)
  --run                Execute configured commands through the safe runner
  --dry-run            Keep configured commands skipped (default)
  --exit-zero          Return exit code 0 after a report is produced
  --summary-only       Print only the decision summary
  --verbose            Print operational details to stderr

The verify command is dry-run by default. Use --run to opt in to configured
command execution through @agentforge-qa/core. stdout is reserved for report output;
report-file writing is not implemented yet.
`;

export const VERIFY_HELP = `AgentForge QA verify

Usage:
  agentforge-qa verify [repo] [options]

Arguments:
  repo                 Repository directory to verify (default: current cwd)

Options:
  --config <path>      Use a JSON AgentForge QA config path
  --claims <path>      Use a Markdown or text claim file
  --since <ref>        Use a Git base/ref for changed-file evidence
  --format <markdown|json>
                       Render Markdown or JSON to stdout (default: markdown)
  --run                Execute configured commands through the safe runner
  --dry-run            Keep configured commands skipped (default)
  --exit-zero          Return exit code 0 after a report is produced
  --summary-only       Print only the decision summary
  --verbose            Print operational details to stderr
  --help, -h           Show this help text

stdout contains the rendered report only. JSON output is emitted without banners
or progress text. Markdown output is plain report content by default. Operational
details and errors go to stderr. Report-file writing is not implemented yet.
`;

export interface CliEvaluation {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

interface VerifyCliOptions {
  readonly claimFile?: string;
  readonly configPath?: string;
  readonly dryRun: boolean;
  readonly exitZero: boolean;
  readonly format: ReportFormat;
  readonly repo?: string;
  readonly since?: string;
  readonly summaryOnly: boolean;
  readonly verbose: boolean;
}

interface UsageError {
  readonly hint?: string;
  readonly message: string;
}

interface CliStreams {
  readonly stderr: {
    write(chunk: string): unknown;
  };
  readonly stdout: {
    write(chunk: string): unknown;
  };
}

export interface CliDependencies {
  readonly cwd: () => string;
  readonly renderReport: (
    report: unknown,
    options: {
      readonly format: ReportFormat;
      readonly summaryOnly?: boolean;
    },
  ) => string;
  readonly runVerification: (
    request: VerificationRequest,
  ) => Promise<VerificationReport>;
}

const defaultCliDependencies: CliDependencies = {
  cwd: () => process.cwd(),
  renderReport,
  runVerification,
};

function createEvaluation(
  exitCode: number,
  stdout = "",
  stderr = "",
): CliEvaluation {
  return {
    exitCode,
    stdout,
    stderr,
  };
}

function createUsageError(
  message: string,
  hint: string | undefined = undefined,
  helpCommand = "agentforge-qa verify --help",
): CliEvaluation {
  return createEvaluation(
    2,
    "",
    [
      `AgentForge QA error: ${message}`,
      ...(hint === undefined ? [] : [`Fix: ${hint}`]),
      `Run ${helpCommand} for usage.`,
    ].join("\n") + "\n",
  );
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isReportFormat(value: string): value is ReportFormat {
  return value === "json" || value === "markdown";
}

function splitOptionToken(token: string): {
  readonly hasInlineValue: boolean;
  readonly name: string;
  readonly value?: string;
} {
  const separatorIndex = token.indexOf("=");

  if (separatorIndex === -1) {
    return {
      hasInlineValue: false,
      name: token,
    };
  }

  return {
    hasInlineValue: true,
    name: token.slice(0, separatorIndex),
    value: token.slice(separatorIndex + 1),
  };
}

function readOptionValue(
  optionName: string,
  inlineValue: string | undefined,
  hasInlineValue: boolean,
  args: readonly string[],
  index: number,
): { readonly nextIndex: number; readonly value: string } | UsageError {
  if (hasInlineValue) {
    if (inlineValue === undefined || inlineValue.length === 0) {
      return {
        hint: `Pass a value after ${optionName}.`,
        message: `${optionName} requires a value.`,
      };
    }

    return {
      nextIndex: index + 1,
      value: inlineValue,
    };
  }

  const value = args[index + 1];

  if (value === undefined || value.startsWith("--")) {
    return {
      hint: `Pass a value after ${optionName}.`,
      message: `${optionName} requires a value.`,
    };
  }

  return {
    nextIndex: index + 2,
    value,
  };
}

function rejectInlineBooleanValue(
  optionName: string,
  hasInlineValue: boolean,
): UsageError | undefined {
  return hasInlineValue
    ? {
        hint: `Use ${optionName} by itself.`,
        message: `${optionName} does not accept a value.`,
      }
    : undefined;
}

function parseVerifyArgs(args: readonly string[]): VerifyCliOptions | UsageError {
  let configPath: string | undefined;
  let claimFile: string | undefined;
  let dryRunRequested = false;
  let exitZero = false;
  let format: ReportFormat = "markdown";
  let repo: string | undefined;
  let runRequested = false;
  let since: string | undefined;
  let summaryOnly = false;
  let verbose = false;
  let index = 0;

  while (index < args.length) {
    const token = args[index];

    if (token === undefined) {
      break;
    }

    if (token === "--help" || token === "-h") {
      return { message: "--help must be handled before parsing verify options." };
    }

    if (token.startsWith("--")) {
      const { hasInlineValue, name, value } = splitOptionToken(token);

      switch (name) {
        case "--config": {
          const result = readOptionValue(name, value, hasInlineValue, args, index);

          if ("message" in result) {
            return result;
          }

          configPath = result.value;
          index = result.nextIndex;
          continue;
        }
        case "--claims": {
          const result = readOptionValue(name, value, hasInlineValue, args, index);

          if ("message" in result) {
            return result;
          }

          claimFile = result.value;
          index = result.nextIndex;
          continue;
        }
        case "--since": {
          const result = readOptionValue(name, value, hasInlineValue, args, index);

          if ("message" in result) {
            return result;
          }

          since = result.value;
          index = result.nextIndex;
          continue;
        }
        case "--format": {
          const result = readOptionValue(name, value, hasInlineValue, args, index);

          if ("message" in result) {
            return result;
          }

          if (!isReportFormat(result.value)) {
            return {
              hint: "Use --format markdown or --format json.",
              message: `invalid --format value "${result.value}".`,
            };
          }

          format = result.value;
          index = result.nextIndex;
          continue;
        }
        case "--run": {
          const error = rejectInlineBooleanValue(name, hasInlineValue);

          if (error !== undefined) {
            return error;
          }

          runRequested = true;
          index += 1;
          continue;
        }
        case "--dry-run": {
          const error = rejectInlineBooleanValue(name, hasInlineValue);

          if (error !== undefined) {
            return error;
          }

          dryRunRequested = true;
          index += 1;
          continue;
        }
        case "--exit-zero": {
          const error = rejectInlineBooleanValue(name, hasInlineValue);

          if (error !== undefined) {
            return error;
          }

          exitZero = true;
          index += 1;
          continue;
        }
        case "--summary-only": {
          const error = rejectInlineBooleanValue(name, hasInlineValue);

          if (error !== undefined) {
            return error;
          }

          summaryOnly = true;
          index += 1;
          continue;
        }
        case "--verbose": {
          const error = rejectInlineBooleanValue(name, hasInlineValue);

          if (error !== undefined) {
            return error;
          }

          verbose = true;
          index += 1;
          continue;
        }
        default:
          return {
            hint: "Run agentforge-qa verify --help to see supported options.",
            message: `unknown verify option "${name}".`,
          };
      }
    }

    if (token.startsWith("-")) {
      return {
        hint: "Run agentforge-qa verify --help to see supported options.",
        message: `unknown verify option "${token}".`,
      };
    }

    if (repo !== undefined) {
      return {
        hint: "Pass at most one repository path after verify.",
        message: "only one repository argument is supported.",
      };
    }

    repo = token;
    index += 1;
  }

  if (runRequested && dryRunRequested) {
    return {
      hint: "Use --run to execute configured commands, or omit it to stay dry-run.",
      message: "--run and --dry-run cannot be used together.",
    };
  }

  return {
    ...(claimFile === undefined ? {} : { claimFile }),
    ...(configPath === undefined ? {} : { configPath }),
    dryRun: !runRequested,
    exitZero,
    format,
    ...(repo === undefined ? {} : { repo }),
    ...(since === undefined ? {} : { since }),
    summaryOnly,
    verbose,
  };
}

function createVerificationRequest(
  options: VerifyCliOptions,
  dependencies: CliDependencies,
): VerificationRequest {
  const cwd = options.repo === undefined
    ? resolve(dependencies.cwd())
    : resolve(dependencies.cwd(), options.repo);

  return {
    ...(options.claimFile === undefined ? {} : { claimFile: options.claimFile }),
    ...(options.configPath === undefined
      ? {}
      : { configPath: options.configPath }),
    cwd,
    dryRun: options.dryRun,
    mode: "local",
    ...(options.since === undefined ? {} : { since: options.since }),
  };
}

function determineReportExitCode(
  report: VerificationReport,
  exitZero: boolean,
): number {
  if (exitZero) {
    return 0;
  }

  if (report.toolStatus === "TOOL_ERROR") {
    return 2;
  }

  return report.finalVerdict === "SAFE_TO_CONTINUE" ? 0 : 1;
}

function summarizeToolError(report: VerificationReport): string {
  const [firstError] = report.errors ?? [];

  if (firstError === undefined) {
    return "Verification returned TOOL_ERROR; see report output for details.";
  }

  return `Verification returned TOOL_ERROR (${firstError.code}): ${firstError.message}`;
}

async function evaluateVerifyCli(
  args: readonly string[],
  dependencies: CliDependencies,
): Promise<CliEvaluation> {
  if (args.includes("--help") || args.includes("-h")) {
    return createEvaluation(0, VERIFY_HELP);
  }

  const parsedOptions = parseVerifyArgs(args);

  if ("message" in parsedOptions) {
    return createUsageError(parsedOptions.message, parsedOptions.hint);
  }

  const request = createVerificationRequest(parsedOptions, dependencies);
  let stderr = parsedOptions.verbose
    ? [
        `AgentForge QA verify: cwd=${request.cwd}`,
        `AgentForge QA verify: format=${parsedOptions.format}`,
        `AgentForge QA verify: dryRun=${String(request.dryRun)}`,
      ].join("\n") + "\n"
    : "";

  try {
    const report = await dependencies.runVerification(request);
    const stdout = dependencies.renderReport(report, {
      format: parsedOptions.format,
      summaryOnly: parsedOptions.summaryOnly,
    });
    const exitCode = determineReportExitCode(report, parsedOptions.exitZero);

    if (report.toolStatus === "TOOL_ERROR") {
      stderr += `${summarizeToolError(report)}\n`;
    }

    if (parsedOptions.verbose) {
      stderr += [
        `AgentForge QA verify: toolStatus=${report.toolStatus}`,
        `AgentForge QA verify: finalVerdict=${report.finalVerdict ?? "not provided"}`,
        `AgentForge QA verify: exitCode=${String(exitCode)}`,
      ].join("\n") + "\n";
    }

    return createEvaluation(exitCode, stdout, stderr);
  } catch (error) {
    return createEvaluation(
      3,
      "",
      `AgentForge QA internal error: ${formatError(error)}\n`,
    );
  }
}

export async function evaluateCli(
  args: readonly string[],
  dependencies: CliDependencies = defaultCliDependencies,
): Promise<CliEvaluation> {
  const [command, ...commandArgs] = args;

  if (
    args.length === 0 ||
    command === "--help" ||
    command === "-h"
  ) {
    return createEvaluation(0, CLI_HELP);
  }

  if (command === "--version" || command === "-v") {
    return createEvaluation(0, `${CLI_VERSION}\n`);
  }

  if (command === "verify") {
    return evaluateVerifyCli(commandArgs, dependencies);
  }

  return createUsageError(
    command?.startsWith("-")
      ? `unknown top-level option "${command}".`
      : `unknown command "${args.join(" ")}".`,
    "Available commands: verify.",
    "agentforge-qa --help",
  );
}

export async function runCli(
  args: readonly string[] = process.argv.slice(2),
  dependencies: CliDependencies = defaultCliDependencies,
  streams: CliStreams = {
    stderr: process.stderr,
    stdout: process.stdout,
  },
): Promise<number> {
  const result = await evaluateCli(args, dependencies);

  if (result.stdout.length > 0) {
    streams.stdout.write(result.stdout);
  }

  if (result.stderr.length > 0) {
    streams.stderr.write(result.stderr);
  }

  return result.exitCode;
}

const invokedPath = process.argv[1];

if (
  invokedPath !== undefined &&
  import.meta.url === pathToFileURL(invokedPath).href
) {
  process.exitCode = await runCli();
}

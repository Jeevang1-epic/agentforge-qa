import type { CommandPlan } from "@agentforge-qa/schemas";

import { reviewCommandPolicy } from "./command-policy.js";
import { resolvePathInsideRepo } from "./command-paths.js";
import { redactCommandText } from "./command-redaction.js";
import {
  DEFAULT_MAX_COMMAND_TIMEOUT_MS,
  reviewCommandTimeout,
} from "./command-timeouts.js";

const controlCharacterPattern = /[\0-\x1F\x7F]/;
const shellOperatorPattern = /[|&;<>`%^]|\$\(|\$\{/;
const commandWhitespacePattern = /\s/;
const commandPathSeparatorPattern = /[\\/]/;
const executableExtensionPattern = /\.(?:bat|cmd|com|exe)$/i;

export interface CommandSafetyOptions {
  repoRoot: string;
  maxTimeoutMs?: number;
}

export interface CommandSafetyReview {
  approved: boolean;
  code: string;
  reason: string;
  normalizedCommand: string;
  normalizedArgs: string[];
  normalizedCwd?: string;
  timeoutMs?: number;
  warnings: string[];
}

function rejectedReview(
  code: string,
  reason: string,
  normalizedCommand: string,
  normalizedArgs: string[],
): CommandSafetyReview {
  return {
    approved: false,
    code,
    reason: redactCommandText(reason),
    normalizedCommand,
    normalizedArgs,
    warnings: [],
  };
}

export function reviewCommandSafety(
  plan: CommandPlan,
  options: CommandSafetyOptions,
): CommandSafetyReview {
  const normalizedCommand = plan.command.trim();
  const normalizedArgs = [...plan.args];
  const commandValues = [normalizedCommand, ...normalizedArgs];

  if (normalizedCommand.length === 0) {
    return rejectedReview(
      "COMMAND_REQUIRED",
      "Command is required.",
      normalizedCommand,
      normalizedArgs,
    );
  }

  if (commandPathSeparatorPattern.test(normalizedCommand)) {
    return rejectedReview(
      "EXECUTABLE_PATH_REJECTED",
      "Command must use an allowlisted executable name, not an executable path.",
      normalizedCommand,
      normalizedArgs,
    );
  }

  if (executableExtensionPattern.test(normalizedCommand)) {
    return rejectedReview(
      "EXECUTABLE_EXTENSION_REJECTED",
      "Command must use an allowlisted executable name without a script or executable extension.",
      normalizedCommand,
      normalizedArgs,
    );
  }

  if (commandWhitespacePattern.test(normalizedCommand)) {
    return rejectedReview(
      "RAW_COMMAND_STRING_REJECTED",
      "Command must be a single executable name with arguments supplied separately.",
      normalizedCommand,
      normalizedArgs,
    );
  }

  if (commandValues.some((value) => controlCharacterPattern.test(value))) {
    return rejectedReview(
      "CONTROL_CHARACTER_REJECTED",
      "Command and args must not contain control characters.",
      normalizedCommand,
      normalizedArgs,
    );
  }

  if (commandValues.some((value) => shellOperatorPattern.test(value))) {
    return rejectedReview(
      "SHELL_OPERATOR_REJECTED",
      "Command and args must not contain shell-control operators.",
      normalizedCommand,
      normalizedArgs,
    );
  }

  const policyReview = reviewCommandPolicy(normalizedCommand, normalizedArgs);

  if (!policyReview.approved) {
    return {
      ...rejectedReview(
        policyReview.code,
        policyReview.reason,
        normalizedCommand,
        normalizedArgs,
      ),
      warnings: policyReview.warnings,
    };
  }

  const cwdReview = resolvePathInsideRepo(options.repoRoot, plan.cwd, "cwd");

  if (!cwdReview.approved || cwdReview.path === undefined) {
    return {
      ...rejectedReview(
        cwdReview.code,
        cwdReview.reason,
        normalizedCommand,
        normalizedArgs,
      ),
      warnings: policyReview.warnings,
    };
  }

  const timeoutReview = reviewCommandTimeout(
    plan.timeoutMs,
    options.maxTimeoutMs ?? DEFAULT_MAX_COMMAND_TIMEOUT_MS,
  );

  if (!timeoutReview.approved || timeoutReview.timeoutMs === undefined) {
    return {
      ...rejectedReview(
        timeoutReview.code,
        timeoutReview.reason,
        normalizedCommand,
        normalizedArgs,
      ),
      normalizedCwd: cwdReview.path,
      warnings: policyReview.warnings,
    };
  }

  return {
    approved: true,
    code: "APPROVED",
    reason: "Command plan passed the v0.1 safety review.",
    normalizedCommand,
    normalizedArgs,
    normalizedCwd: cwdReview.path,
    timeoutMs: timeoutReview.timeoutMs,
    warnings: policyReview.warnings,
  };
}

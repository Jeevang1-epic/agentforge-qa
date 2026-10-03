import { basename } from "node:path";

const allowedCommandNames = new Set([
  "git",
  "node",
  "npm",
  "pnpm",
  "yarn",
  "tsc",
  "vitest",
]);

const deniedCommandNames = new Set([
  "rm",
  "rmdir",
  "del",
  "erase",
  "sudo",
  "su",
  "chmod",
  "chown",
  "curl",
  "wget",
  "ssh",
  "scp",
  "ftp",
  "vercel",
  "netlify",
  "railway",
  "docker",
  "kubectl",
]);

const packageManagerNames = new Set(["npm", "pnpm", "yarn"]);
const allowedPackageScripts = new Set([
  "build",
  "lint",
  "smoke",
  "test",
  "typecheck",
]);
const deniedPackageManagerSubcommands = new Set([
  "add",
  "audit",
  "cache",
  "config",
  "create",
  "deploy",
  "dlx",
  "exec",
  "fund",
  "i",
  "init",
  "install",
  "link",
  "login",
  "logout",
  "pack",
  "prune",
  "publish",
  "rebuild",
  "remove",
  "set",
  "uninstall",
  "unlink",
  "update",
  "upgrade",
  "whoami",
]);
const safeGitReferencePattern = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;
export function isSafeGitReference(value: string): boolean {
  return safeGitReferencePattern.test(value) && !value.includes("..");
}

export const SCANNER_LOG_ARGS = [
  "log", "--format=medium", "--no-decorate", "--no-show-signature", "--max-count=101",
] as const;
const safeGitGlobalArgs = [
  "-c",
  "core.fsmonitor=false",
  "--no-optional-locks",
] as const;

export interface CommandPolicyReview {
  approved: boolean;
  code: string;
  reason: string;
  warnings: string[];
}

export function normalizeCommandName(command: string): string {
  return basename(command).replace(/\.(?:cmd|com|exe)$/i, "").toLowerCase();
}

function reviewPackageManagerArgs(args: readonly string[]): CommandPolicyReview {
  const subcommand = args[0]?.toLowerCase();

  if (subcommand === undefined) {
    return {
      approved: false,
      code: "PACKAGE_MANAGER_SUBCOMMAND_REQUIRED",
      reason: "Package manager commands require an explicitly allowed subcommand.",
      warnings: [],
    };
  }

  if (deniedPackageManagerSubcommands.has(subcommand)) {
    return {
      approved: false,
      code: "DENIED_PACKAGE_MANAGER_SUBCOMMAND",
      reason: `Package manager subcommand "${subcommand}" is denied by the v0.1 safety policy.`,
      warnings: [],
    };
  }

  const scriptName = subcommand === "run" ? args[1]?.toLowerCase() : subcommand;

  if (scriptName === undefined || !allowedPackageScripts.has(scriptName)) {
    return {
      approved: false,
      code: "UNSUPPORTED_PACKAGE_MANAGER_SUBCOMMAND",
      reason:
        "Only explicitly allowed validation and build scripts may run through a package manager.",
      warnings: [],
    };
  }

  return {
    approved: true,
    code: "APPROVED",
    reason: "Package manager validation command is approved.",
    warnings: [
      "Package scripts may execute repository-controlled code and must remain explicitly configured.",
    ],
  };
}

function stripRequiredGitSafetyOptions(
  args: readonly string[],
): readonly string[] | undefined {
  if (!safeGitGlobalArgs.every((value, index) => args[index] === value)) return undefined;
  let cursor = safeGitGlobalArgs.length;
  while (args[cursor] === "-c" &&
    /^filter\.[A-Za-z0-9_.-]{1,100}\.(?:(?:clean|smudge|process)=|required=false)$/.test(args[cursor + 1] ?? "")) {
    cursor += 2;
  }
  return args.slice(cursor);
}

function reviewGitArgs(args: readonly string[]): CommandPolicyReview {
  const safeArgs = stripRequiredGitSafetyOptions(args);

  if (safeArgs === undefined) {
    return {
      approved: false,
      code: "GIT_SAFETY_OPTIONS_REQUIRED",
      reason:
        "Git evidence commands must disable fsmonitor hooks and optional locks.",
      warnings: [],
    };
  }

  if (
    safeArgs.length === 4 &&
    safeArgs[0] === "status" &&
    safeArgs[1] === "--porcelain=v1" &&
    safeArgs[2] === "-z" &&
    safeArgs[3] === "--untracked-files=all"
  ) {
    return {
      approved: true,
      code: "APPROVED",
      reason: "Read-only git status evidence command is approved.",
      warnings: [],
    };
  }

  if (
    safeArgs.length === 2 &&
    safeArgs[0] === "rev-parse" &&
    (safeArgs[1] === "--is-inside-work-tree" || safeArgs[1] === "--show-toplevel")
  ) {
    return {
      approved: true,
      code: "APPROVED",
      reason: "Read-only git repository detection command is approved.",
      warnings: [],
    };
  }

  const usesNullDelimitedOutput = safeArgs[2] === "-z";
  const since = usesNullDelimitedOutput ? safeArgs[3] : safeArgs[2];

  if (
    (safeArgs.length === 3 && safeArgs.join(" ") === "rev-parse --verify HEAD") ||
    (safeArgs.length === 5 && safeArgs.join(" ") === "config --null --name-only --get-regexp filter[.]") ||
    (safeArgs.length === 6 &&
      safeArgs[0] === "ls-tree" && safeArgs[1] === "--full-tree" && safeArgs[2] === "-z" &&
      isSafeGitReference(safeArgs[3] ?? "") && safeArgs[4] === "--" &&
      /^:\(literal\)[^\0\r\n]+$/.test(safeArgs[5] ?? "")) ||
    (safeArgs.length === 3 && safeArgs[0] === "cat-file" && safeArgs[1] === "blob" &&
      /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(safeArgs[2] ?? "")) ||
    (safeArgs.length === 7 && safeArgs[0] === "diff" &&
      safeArgs[1] === "--no-ext-diff" && safeArgs[2] === "--no-textconv" &&
      safeArgs[3] === "--name-status" && safeArgs[4] === "-z" &&
      isSafeGitReference(safeArgs[5] ?? "") && safeArgs[6] === "HEAD") ||
    (safeArgs.length === SCANNER_LOG_ARGS.length + 2 &&
      SCANNER_LOG_ARGS.every((arg, i) => safeArgs[i] === arg) &&
      (safeArgs[SCANNER_LOG_ARGS.length] ?? "").endsWith("..HEAD") &&
      isSafeGitReference((safeArgs[SCANNER_LOG_ARGS.length] ?? "").slice(0, -6)) &&
      safeArgs[SCANNER_LOG_ARGS.length + 1] === "--")
  ) {
    return { approved: true, code: "APPROVED", reason: "Bounded read-only scanner evidence command is approved.", warnings: [] };
  }

  if (
    safeArgs.length === (usesNullDelimitedOutput ? 4 : 3) &&
    safeArgs[0] === "diff" &&
    safeArgs[1] === "--name-status" &&
    since !== undefined &&
    safeGitReferencePattern.test(since) &&
    !since.includes("..")
  ) {
    return {
      approved: true,
      code: "APPROVED",
      reason: "Read-only git diff evidence command is approved.",
      warnings: [],
    };
  }

  return {
    approved: false,
    code: "UNSUPPORTED_GIT_COMMAND",
    reason:
      "Only read-only git status, rev-parse, and safe diff evidence commands are allowed.",
    warnings: [],
  };
}

export function reviewCommandPolicy(
  normalizedCommand: string,
  normalizedArgs: readonly string[],
): CommandPolicyReview {
  const commandName = normalizeCommandName(normalizedCommand);

  if (deniedCommandNames.has(commandName)) {
    return {
      approved: false,
      code: "DENIED_COMMAND",
      reason: `Command "${commandName}" is denied by the v0.1 safety policy.`,
      warnings: [],
    };
  }

  if (!allowedCommandNames.has(commandName)) {
    return {
      approved: false,
      code: "UNSUPPORTED_COMMAND",
      reason: `Command "${commandName}" is not in the v0.1 allowlist.`,
      warnings: [],
    };
  }

  if (packageManagerNames.has(commandName)) {
    return reviewPackageManagerArgs(normalizedArgs);
  }

  if (commandName === "git") {
    return reviewGitArgs(normalizedArgs);
  }

  return {
    approved: true,
    code: "APPROVED",
    reason: `Command "${commandName}" is approved by the v0.1 safety policy.`,
    warnings:
      commandName === "node"
        ? [
            "Node commands can execute repository-controlled code and must never be derived from claim text.",
          ]
        : [],
  };
}

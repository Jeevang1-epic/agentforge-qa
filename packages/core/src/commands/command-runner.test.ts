import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  CommandPlanSchema,
  CommandResultSchema,
  type CommandPlan,
} from "@agentforge-qa/schemas";
import { afterEach, describe, expect, it } from "vitest";

import {
  createCommandEnvironment,
  runApprovedCommand,
  runCommandPlan,
  runCommandPlanWithOutput,
} from "./command-runner.js";

const temporaryRepoRoots: string[] = [];

async function createRepoRoot(): Promise<string> {
  const repoRoot = await mkdtemp(join(tmpdir(), "agentforge-command-runner-"));
  temporaryRepoRoots.push(repoRoot);
  return repoRoot;
}

function createPlan(repoRoot: string, overrides: Partial<CommandPlan> = {}): CommandPlan {
  return CommandPlanSchema.parse({
    id: "runner-test",
    label: "Runner test",
    command: "node",
    args: ["-e", "console.log('agentforge-ok')"],
    required: true,
    timeoutMs: 5_000,
    cwd: repoRoot,
    ...overrides,
  });
}

async function readRepoLog(repoRoot: string, path: string | undefined): Promise<string> {
  expect(path).toBeTypeOf("string");
  return readFile(join(repoRoot, path ?? ""), "utf8");
}

afterEach(async () => {
  await Promise.all(
    temporaryRepoRoots.splice(0).map((repoRoot) =>
      rm(repoRoot, { recursive: true, force: true }),
    ),
  );
});

describe("safe command runner", () => {
  it("runs an approved command with shell disabled and writes captured logs", async () => {
    const repoRoot = await createRepoRoot();
    const result = await runApprovedCommand(createPlan(repoRoot), { repoRoot });

    expect(CommandResultSchema.safeParse(result).success).toBe(true);
    expect(result.status).toBe("passed");
    expect(result.exitCode).toBe(0);
    expect(await readRepoLog(repoRoot, result.stdoutLogPath)).toContain(
      "agentforge-ok",
    );
    expect(await readRepoLog(repoRoot, result.stderrLogPath)).toBe("");
  });

  it("returns failed for a non-zero exit and captures stderr", async () => {
    const repoRoot = await createRepoRoot();
    const result = await runCommandPlan(
      createPlan(repoRoot, {
        args: ["-e", "console.error('agentforge-error'),process.exit(2)"],
      }),
      { repoRoot },
    );

    expect(result.status).toBe("failed");
    expect(result.exitCode).toBe(2);
    expect(await readRepoLog(repoRoot, result.stderrLogPath)).toContain(
      "agentforge-error",
    );
  });

  it("skips dry runs without executing the command", async () => {
    const repoRoot = await createRepoRoot();
    const markerPath = join(repoRoot, "should-not-exist.txt");
    const result = await runCommandPlan(
      createPlan(repoRoot, {
        args: [
          "-e",
          "require('node:fs').writeFileSync(process.argv[1], 'unexpected')",
          markerPath,
        ],
      }),
      { repoRoot, dryRun: true },
    );

    expect(result.status).toBe("skipped");
    expect(result.reason).toContain("Dry run");
    await expect(access(markerPath)).rejects.toThrow();
  });

  it("skips unsafe commands without executing them", async () => {
    const repoRoot = await createRepoRoot();
    const result = await runCommandPlan(
      createPlan(repoRoot, { command: "rm", args: ["-rf", "."] }),
      { repoRoot },
    );

    expect(result.status).toBe("skipped");
    expect(result.reason).toContain("DENIED_COMMAND");
    expect(result.stdoutLogPath).toBeUndefined();
  });

  it("terminates commands that exceed their timeout", async () => {
    const repoRoot = await createRepoRoot();
    const result = await runCommandPlan(
      createPlan(repoRoot, {
        args: ["-e", "setTimeout(function () {}, 10000)"],
        timeoutMs: 100,
      }),
      { repoRoot, killGraceMs: 50 },
    );

    expect(result.status).toBe("timed_out");
    expect(result.reason).toContain("100ms timeout");
  });

  it("redacts secrets before writing stdout and stderr logs", async () => {
    const repoRoot = await createRepoRoot();
    const result = await runCommandPlan(
      createPlan(repoRoot, {
        args: [
          "-e",
          "console.log('TOKEN=abc ghp_123456 sk-abcdef Bearer bearer-value'),console.error('SECRET=stderr-secret')",
        ],
      }),
      { repoRoot },
    );
    const stdout = await readRepoLog(repoRoot, result.stdoutLogPath);
    const stderr = await readRepoLog(repoRoot, result.stderrLogPath);

    expect(stdout).toContain("TOKEN=[REDACTED]");
    expect(stdout).toContain("[REDACTED_GITHUB_TOKEN]");
    expect(stdout).toContain("[REDACTED_API_KEY]");
    expect(stdout).toContain("Bearer [REDACTED]");
    expect(stdout).not.toContain("ghp_123456");
    expect(stderr).toContain("SECRET=[REDACTED]");
    expect(stderr).not.toContain("stderr-secret");
  });

  it("keeps raw machine output in memory while redacting persisted logs", async () => {
    const repoRoot = await createRepoRoot();
    const execution = await runCommandPlanWithOutput(
      createPlan(repoRoot, {
        args: ["-e", "console.log('TOKEN=machine-readable')"],
      }),
      { repoRoot },
    );
    const stdoutLog = await readRepoLog(
      repoRoot,
      execution.result.stdoutLogPath,
    );

    expect(execution.result.status).toBe("passed");
    expect(execution.stdout).toContain("TOKEN=machine-readable");
    expect(stdoutLog).toContain("TOKEN=[REDACTED]");
    expect(stdoutLog).not.toContain("machine-readable");
  });

  it("caps captured output and marks truncated logs", async () => {
    const repoRoot = await createRepoRoot();
    const result = await runCommandPlan(
      createPlan(repoRoot, {
        args: ["-e", "console.log('1234567890')"],
      }),
      { repoRoot, maxCaptureBytes: 5 },
    );

    const stdout = await readRepoLog(repoRoot, result.stdoutLogPath);

    expect(stdout).toContain("12345");
    expect(stdout).toContain("[OUTPUT TRUNCATED]");
    expect(stdout).not.toContain("67890");
  });

  it("refuses to write logs outside the repository", async () => {
    const repoRoot = await createRepoRoot();
    const markerPath = join(repoRoot, "should-not-exist.txt");
    const result = await runCommandPlan(
      createPlan(repoRoot, {
        args: [
          "-e",
          "require('node:fs').writeFileSync(process.argv[1], 'unexpected')",
          markerPath,
        ],
      }),
      {
        repoRoot,
        logDirectory: join(repoRoot, "..", "outside-logs"),
      },
    );

    expect(result.status).toBe("skipped");
    expect(result.reason).toContain("log directory must resolve inside");
    await expect(access(markerPath)).rejects.toThrow();
  });

  it("skips execution when cwd does not exist", async () => {
    const repoRoot = await createRepoRoot();
    const result = await runCommandPlan(
      createPlan(repoRoot, { cwd: join(repoRoot, "missing") }),
      { repoRoot },
    );

    expect(result.status).toBe("skipped");
    expect(result.reason).toContain("CWD_NOT_FOUND");
  });

  it("sanitizes and redacts log filenames inside the repository", async () => {
    const repoRoot = await createRepoRoot();
    const result = await runCommandPlan(
      createPlan(repoRoot, { id: "../../TOKEN=filename-secret" }),
      { repoRoot },
    );

    expect(result.status).toBe("passed");

    for (const logPath of [result.stdoutLogPath, result.stderrLogPath]) {
      expect(logPath).toMatch(/^\.agentforge\/logs\//);
      expect(logPath).not.toContain("..");
      expect(logPath).not.toContain("filename-secret");
      expect(await readRepoLog(repoRoot, logPath)).toBeTypeOf("string");
    }
  });

  it("redacts unsafe command secrets from skipped reasons", async () => {
    const repoRoot = await createRepoRoot();
    const result = await runCommandPlan(
      createPlan(repoRoot, { command: "ghp_123456" }),
      { repoRoot },
    );

    expect(result.status).toBe("skipped");
    expect(result.reason).toContain("[REDACTED_GITHUB_TOKEN]");
    expect(result.reason).not.toContain("ghp_123456");
  });

  it("does not pass secret environment variables to child commands", async () => {
    const environment = createCommandEnvironment({
      OPENAI_API_KEY: "sk-secret",
      GITHUB_TOKEN: "github-secret",
      Path: "C:/tools",
      TEMP: "C:/temp",
    });

    expect(environment.OPENAI_API_KEY).toBeUndefined();
    expect(environment.GITHUB_TOKEN).toBeUndefined();
    expect(environment.Path).toBe("C:/tools");
    expect(environment.TEMP).toBe("C:/temp");
  });
});

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  sampleDemoBlockedReport,
  sampleSafeReport,
  VerificationReportSchema,
  type VerificationReport,
  type VerificationRequest,
} from "@agentforge-qa/schemas";
import { renderReport } from "@agentforge-qa/reporters";
import { describe, expect, it, vi } from "vitest";

import {
  CLI_HELP,
  CLI_VERSION,
  VERIFY_HELP,
  evaluateCli,
  runCli,
  type CliDependencies,
} from "./index.js";

const ansiPattern = /\x1B\[[0-?]*[ -/]*[@-~]/;
const cliSourceUrl = new URL("./index.ts", import.meta.url);
const cliManifestUrl = new URL("../package.json", import.meta.url);

interface CliPackageManifest {
  readonly bin?: Readonly<Record<string, string>>;
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly devDependencies?: Readonly<Record<string, string>>;
  readonly exports?: Readonly<
    Record<
      string,
      Readonly<{
        readonly import?: string;
        readonly types?: string;
      }>
    >
  >;
  readonly files?: readonly string[];
  readonly scripts?: Readonly<Record<string, string>>;
}

async function readCliManifest(): Promise<CliPackageManifest> {
  return JSON.parse(await readFile(cliManifestUrl, "utf8")) as CliPackageManifest;
}

function createToolErrorReport(): VerificationReport {
  return VerificationReportSchema.parse({
    ...sampleSafeReport,
    toolStatus: "TOOL_ERROR",
    finalVerdict: "NEEDS_REVIEW",
    risks: [
      {
        id: "risk:tool-error:test",
        category: "tool_error",
        severity: "error",
        title: "Verification tool error",
        description: "The verification request could not be completed.",
        evidenceIds: ["error:test"],
        nextAction: "Review the error and retry verification.",
        blocksVerdict: true,
      },
    ],
    riskScore: {
      schemaVersion: "0.1.0",
      score: 45,
      severity: "high",
      blockingRiskIds: ["risk:tool-error:test"],
      warningRiskIds: [],
    },
    summary: "The verification pipeline could not complete safely.",
    decisionSummary: {
      verdict: "NEEDS_REVIEW",
      commands: { total: 1, passed: 1, failed: 0, skipped: 0 },
      artifacts: { total: 1, found: 1, missing: 0, requiredMissing: 0 },
      claims: { total: 0, verified: 0, contradicted: 0, reviewRequired: 0 },
      risks: { total: 1, blocking: 1, warnings: 0, score: 45, severity: "high" },
      toolErrors: 1,
      nextAction: "Fix TEST_TOOL_ERROR and run verification again.",
    },
    errors: [
      {
        id: "error:test",
        code: "TEST_TOOL_ERROR",
        message: "Synthetic tool error for CLI tests.",
      },
    ],
  });
}

function createDependencies(
  report: VerificationReport = sampleSafeReport,
  cwd = resolve("C:/workspace"),
): {
  readonly dependencies: CliDependencies;
  readonly requests: VerificationRequest[];
  readonly runVerification: ReturnType<typeof vi.fn>;
} {
  const requests: VerificationRequest[] = [];
  const runVerification = vi.fn(async (request: VerificationRequest) => {
    requests.push(request);
    return report;
  });

  return {
    dependencies: {
      cwd: () => cwd,
      renderReport,
      runVerification,
    },
    requests,
    runVerification,
  };
}

describe("agentforge-qa CLI foundation", () => {
  it("returns help without side effects", async () => {
    await expect(evaluateCli(["--help"])).resolves.toEqual({
      exitCode: 0,
      stdout: CLI_HELP,
      stderr: "",
    });
    expect(CLI_HELP).toContain("agentforge-qa verify [repo] [options]");
    expect(CLI_HELP).toContain("--format <markdown|json>");
    expect(CLI_HELP).toContain("--summary-only");
    expect(CLI_HELP).toContain("report-file writing is not implemented yet");
  });

  it("returns the package version", async () => {
    await expect(evaluateCli(["--version"])).resolves.toEqual({
      exitCode: 0,
      stdout: `${CLI_VERSION}\n`,
      stderr: "",
    });
  });

  it("returns command-specific verify help", async () => {
    await expect(evaluateCli(["verify", "--help"])).resolves.toEqual({
      exitCode: 0,
      stdout: VERIFY_HELP,
      stderr: "",
    });
    expect(VERIFY_HELP).toContain("--run");
    expect(VERIFY_HELP).toContain("--dry-run");
    expect(VERIFY_HELP).toContain(
      "--summary-only       Print only the decision summary",
    );
    expect(VERIFY_HELP).toContain("stdout contains the rendered report only");
  });

  it("returns a clear usage error for unsupported commands", async () => {
    const result = await evaluateCli(["init"]);

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain('AgentForge QA error: unknown command "init".');
    expect(result.stderr).toContain("Fix: Available commands: verify.");
    expect(result.stderr).toContain("Run agentforge-qa --help for usage.");
  });
});

describe("agentforge-qa verify request mapping", () => {
  it("defaults verify to the current cwd and dry-run markdown output", async () => {
    const { dependencies, requests } = createDependencies();
    const result = await evaluateCli(["verify"], dependencies);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("# AgentForge QA Verification Report");
    expect(result.stderr).toBe("");
    expect(requests).toEqual([
      {
        cwd: resolve("C:/workspace"),
        dryRun: true,
        mode: "local",
      },
    ]);
  });

  it("accepts an explicit repo path and maps supported options", async () => {
    const { dependencies, requests } = createDependencies(
      sampleSafeReport,
      resolve("C:/workspace"),
    );
    const result = await evaluateCli(
      [
        "verify",
        "nested-repo",
        "--config",
        "agentforge.config.json",
        "--claims",
        "claims.md",
        "--since",
        "main",
        "--format",
        "json",
        "--run",
      ],
      dependencies,
    );

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(sampleSafeReport);
    expect(result.stderr).toBe("");
    expect(requests).toEqual([
      {
        claimFile: "claims.md",
        configPath: "agentforge.config.json",
        cwd: resolve("C:/workspace", "nested-repo"),
        dryRun: false,
        mode: "local",
        since: "main",
      },
    ]);
  });

  it("keeps --dry-run explicit and rejects --run with --dry-run", async () => {
    const { dependencies, requests } = createDependencies();
    const dryRunResult = await evaluateCli(["verify", "--dry-run"], dependencies);

    expect(dryRunResult.exitCode).toBe(0);
    expect(requests[0]?.dryRun).toBe(true);

    const conflict = await evaluateCli(["verify", "--run", "--dry-run"], dependencies);

    expect(conflict.exitCode).toBe(2);
    expect(conflict.stdout).toBe("");
    expect(conflict.stderr).toContain("--run and --dry-run cannot be used together");
    expect(conflict.stderr).toContain("Use --run to execute configured commands");
    expect(requests).toHaveLength(1);
  });

  it("rejects invalid formats, unknown options, and missing option values", async () => {
    const { dependencies, runVerification } = createDependencies();

    for (const args of [
      ["verify", "--format", "html"],
      ["verify", "--wat"],
      ["verify", "--config"],
    ]) {
      const result = await evaluateCli(args, dependencies);

      expect(result.exitCode).toBe(2);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("AgentForge QA error:");
      expect(result.stderr).toContain("Run agentforge-qa verify --help for usage.");
    }

    expect(runVerification).not.toHaveBeenCalled();
  });

  it("includes actionable details for common usage errors", async () => {
    const { dependencies } = createDependencies();
    const invalidFormat = await evaluateCli(
      ["verify", "--format", "html"],
      dependencies,
    );
    const missingConfig = await evaluateCli(["verify", "--config"], dependencies);
    const unknownOption = await evaluateCli(["verify", "--wat"], dependencies);

    expect(invalidFormat.stderr).toContain(
      'AgentForge QA error: invalid --format value "html".',
    );
    expect(invalidFormat.stderr).toContain(
      "Fix: Use --format markdown or --format json.",
    );
    expect(missingConfig.stderr).toContain(
      "AgentForge QA error: --config requires a value.",
    );
    expect(missingConfig.stderr).toContain(
      "Fix: Pass a value after --config.",
    );
    expect(unknownOption.stderr).toContain(
      'AgentForge QA error: unknown verify option "--wat".',
    );
  });

  it("accepts paths with spaces and treats option values as data", async () => {
    const { dependencies, requests } = createDependencies(
      sampleSafeReport,
      resolve("C:/workspace with spaces"),
    );
    const result = await evaluateCli(
      [
        "verify",
        "repo with spaces",
        "--config",
        "configs/local qa.json",
        "--claims",
        "claim files/release notes.md",
        "--since",
        "feature/long-lived branch",
        "--format",
        "json",
      ],
      dependencies,
    );

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(sampleSafeReport);
    expect(result.stderr).toBe("");
    expect(requests).toEqual([
      {
        claimFile: "claim files/release notes.md",
        configPath: "configs/local qa.json",
        cwd: resolve("C:/workspace with spaces", "repo with spaces"),
        dryRun: true,
        mode: "local",
        since: "feature/long-lived branch",
      },
    ]);
  });

  it("documents dashed option values and format casing behavior", async () => {
    const { dependencies, requests } = createDependencies();
    const inlineDashedValue = await evaluateCli(
      ["verify", "--since=--base-ref"],
      dependencies,
    );
    const separatedDashedValue = await evaluateCli(
      ["verify", "--since", "--base-ref"],
      dependencies,
    );
    const uppercaseFormat = await evaluateCli(
      ["verify", "--format", "JSON"],
      dependencies,
    );
    const booleanValue = await evaluateCli(
      ["verify", "--run=false"],
      dependencies,
    );

    expect(inlineDashedValue.exitCode).toBe(0);
    expect(requests[0]).toMatchObject({
      dryRun: true,
      since: "--base-ref",
    });
    expect(separatedDashedValue.exitCode).toBe(2);
    expect(separatedDashedValue.stdout).toBe("");
    expect(separatedDashedValue.stderr).toContain(
      "AgentForge QA error: --since requires a value.",
    );
    expect(uppercaseFormat.exitCode).toBe(2);
    expect(uppercaseFormat.stderr).toContain(
      'AgentForge QA error: invalid --format value "JSON".',
    );
    expect(booleanValue.exitCode).toBe(2);
    expect(booleanValue.stderr).toContain(
      "AgentForge QA error: --run does not accept a value.",
    );
  });

  it("keeps long but reasonable option values intact", async () => {
    const longRef = `feature/${"a".repeat(256)}`;
    const { dependencies, requests } = createDependencies();
    const result = await evaluateCli(
      ["verify", "--since", longRef, "--format", "json"],
      dependencies,
    );

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(sampleSafeReport);
    expect(requests[0]?.since).toBe(longRef);
  });
});

describe("agentforge-qa verify output and exit codes", () => {
  it("prints parseable JSON only to stdout for --format json", async () => {
    const { dependencies } = createDependencies();
    const result = await evaluateCli(["verify", "--format", "json"], dependencies);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(sampleSafeReport);
    expect(result.stdout.trimStart().startsWith("{")).toBe(true);
    expect(result.stdout).not.toMatch(ansiPattern);
    expect(result.stderr).toBe("");
  });

  it("keeps Markdown stdout as plain report content", async () => {
    const { dependencies } = createDependencies();
    const result = await evaluateCli(["verify", "--format", "markdown"], dependencies);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("# AgentForge QA Verification Report");
    expect(result.stdout).not.toMatch(ansiPattern);
    expect(result.stderr).toBe("");
  });

  it("prints only the Markdown decision summary with --summary-only", async () => {
    const { dependencies } = createDependencies();
    const result = await evaluateCli(
      ["verify", "--summary-only", "--format", "markdown"],
      dependencies,
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("## Decision Summary");
    expect(result.stdout).not.toContain("## Metadata");
    expect(result.stderr).toBe("");
  });

  it.each([
    ["summary before format", ["verify", "--summary-only", "--format", "json"]],
    ["format before summary", ["verify", "--format", "json", "--summary-only"]],
    ["with exit-zero", ["verify", "--exit-zero", "--summary-only", "--format", "json"]],
  ] as const)("prints minimal parseable JSON with %s", async (_label, args) => {
    const { dependencies } = createDependencies();
    const result = await evaluateCli(args, dependencies);
    const parsed = JSON.parse(result.stdout);

    expect(result.exitCode).toBe(0);
    expect(parsed).toEqual({
      schemaVersion: sampleSafeReport.schemaVersion,
      summary: sampleSafeReport.decisionSummary,
    });
    expect(result.stdout).not.toContain("# AgentForge");
    expect(result.stderr).toBe("");
  });

  it("rejects a value attached to --summary-only", async () => {
    const { dependencies } = createDependencies();
    const result = await evaluateCli(
      ["verify", "--summary-only=true"],
      dependencies,
    );

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("--summary-only does not accept a value");
  });

  it("prints verbose operational details to stderr only", async () => {
    const { dependencies } = createDependencies();
    const result = await evaluateCli(
      ["verify", "--format", "json", "--verbose"],
      dependencies,
    );

    expect(JSON.parse(result.stdout)).toEqual(sampleSafeReport);
    expect(result.stderr).toContain("AgentForge QA verify: cwd=");
    expect(result.stderr).toContain("AgentForge QA verify: format=json");
    expect(result.stderr).toContain("AgentForge QA verify: exitCode=0");
  });

  it("returns 1 for valid reports that are not safe to continue", async () => {
    const { dependencies } = createDependencies(sampleDemoBlockedReport);
    const result = await evaluateCli(["verify"], dependencies);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("DEMO_BLOCKED");
  });

  it("returns 2 for tool-error reports and keeps the report on stdout", async () => {
    const { dependencies } = createDependencies(createToolErrorReport());
    const result = await evaluateCli(["verify", "--format", "json"], dependencies);

    expect(result.exitCode).toBe(2);
    expect(JSON.parse(result.stdout)).toMatchObject({
      toolStatus: "TOOL_ERROR",
      errors: [{ code: "TEST_TOOL_ERROR" }],
    });
    expect(result.stderr).toContain(
      "Verification returned TOOL_ERROR (TEST_TOOL_ERROR)",
    );
    expect(result.stderr).not.toMatch(ansiPattern);
  });

  it("allows --exit-zero after a report is produced", async () => {
    const { dependencies } = createDependencies(sampleDemoBlockedReport);
    const result = await evaluateCli(["verify", "--exit-zero"], dependencies);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("DEMO_BLOCKED");
  });

  it("returns 3 for unexpected CLI or renderer errors", async () => {
    const dependencies: CliDependencies = {
      cwd: () => resolve("C:/workspace"),
      renderReport: () => {
        throw new Error("renderer failed");
      },
      runVerification: async () => sampleSafeReport,
    };
    const result = await evaluateCli(["verify"], dependencies);

    expect(result.exitCode).toBe(3);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("AgentForge QA internal error: renderer failed");
    expect(result.stderr).not.toContain("\n    at ");
  });

  it("writes stdout and stderr to separate streams in runCli", async () => {
    const { dependencies } = createDependencies(createToolErrorReport());
    const stdout: string[] = [];
    const stderr: string[] = [];
    const exitCode = await runCli(["verify", "--format", "json"], dependencies, {
      stdout: { write: (chunk) => stdout.push(chunk) },
      stderr: { write: (chunk) => stderr.push(chunk) },
    });

    expect(exitCode).toBe(2);
    expect(JSON.parse(stdout.join(""))).toMatchObject({
      toolStatus: "TOOL_ERROR",
    });
    expect(stderr.join("")).toContain("Verification returned TOOL_ERROR");
  });
});

describe("agentforge-qa CLI regression matrix", () => {
  it("covers common command paths with stable exit and stream behavior", async () => {
    const cases: readonly {
      readonly args: readonly string[];
      readonly expectedExitCode: number;
      readonly report?: VerificationReport;
    }[] = [
      { args: ["--help"], expectedExitCode: 0 },
      { args: ["--version"], expectedExitCode: 0 },
      { args: ["verify", "--help"], expectedExitCode: 0 },
      { args: ["verify"], expectedExitCode: 0 },
      { args: ["verify", "."], expectedExitCode: 0 },
      { args: ["verify", "--format", "markdown"], expectedExitCode: 0 },
      { args: ["verify", "--format", "json"], expectedExitCode: 0 },
      { args: ["verify", "--verbose"], expectedExitCode: 0 },
      {
        args: ["verify", "--exit-zero"],
        expectedExitCode: 0,
        report: sampleDemoBlockedReport,
      },
      { args: ["verify", "--dry-run"], expectedExitCode: 0 },
      { args: ["verify", "--run"], expectedExitCode: 0 },
      { args: ["verify", "--run", "--dry-run"], expectedExitCode: 2 },
      { args: ["verify", "--format"], expectedExitCode: 2 },
      { args: ["verify", "--format", "xml"], expectedExitCode: 2 },
      { args: ["unknown"], expectedExitCode: 2 },
    ];

    for (const { args, expectedExitCode, report = sampleSafeReport } of cases) {
      const { dependencies } = createDependencies(report);
      const result = await evaluateCli(args, dependencies);

      expect(result.exitCode, args.join(" ")).toBe(expectedExitCode);
      expect(result.stdout, args.join(" ")).not.toMatch(ansiPattern);
      expect(result.stderr, args.join(" ")).not.toMatch(ansiPattern);
      expect(result.stderr, args.join(" ")).not.toContain("\n    at ");

      if (args.includes("--format") && args.includes("json") && result.exitCode === 0) {
        expect(JSON.parse(result.stdout), args.join(" ")).toEqual(report);
        expect(result.stderr, args.join(" ")).toBe("");
      }

      if (result.exitCode === 2) {
        expect(result.stdout, args.join(" ")).toBe("");
        expect(result.stderr, args.join(" ")).toContain("AgentForge QA error:");
      }
    }
  });
});

describe("agentforge-qa verify core tool-error paths", () => {
  it("handles a missing repo path through the core verifier", async () => {
    const missingRepo = resolve(process.cwd(), "__missing_agentforge_cli_repo__");
    const result = await evaluateCli([
      "verify",
      missingRepo,
      "--format",
      "json",
    ]);

    expect(result.exitCode).toBe(2);
    expect(JSON.parse(result.stdout)).toMatchObject({
      toolStatus: "TOOL_ERROR",
      errors: [{ code: "REPO_CWD_NOT_FOUND" }],
    });
    expect(result.stderr).toContain("REPO_CWD_NOT_FOUND");
  });

  it("handles a missing config path through the core verifier", async () => {
    const result = await evaluateCli([
      "verify",
      "--config",
      "__missing_agentforge_config__.json",
      "--format",
      "json",
    ]);

    expect(result.exitCode).toBe(2);
    expect(JSON.parse(result.stdout)).toMatchObject({
      toolStatus: "TOOL_ERROR",
    });
    expect(result.stderr).toContain("CONFIG_PATH_NOT_FOUND");
  });

  it("handles a missing claims path through the core verifier", async () => {
    const result = await evaluateCli([
      "verify",
      "--claims",
      "__missing_agentforge_claims__.md",
      "--format",
      "json",
    ]);

    expect(result.exitCode).toBe(2);
    expect(JSON.parse(result.stdout)).toMatchObject({
      toolStatus: "TOOL_ERROR",
    });
    expect(result.stderr).toContain("CLAIM_FILE_NOT_FOUND");
  });
});

describe("agentforge-qa local invocation readiness", () => {
  it("keeps the executable name and shebang ready for built local invocation", async () => {
    const manifest = await readCliManifest();
    const source = await readFile(cliSourceUrl, "utf8");

    expect(manifest.bin?.["agentforge-qa"]).toBe("./dist/index.js");
    expect(source.replaceAll("\r\n", "\n").startsWith("#!/usr/bin/env node\n")).toBe(true);
  });

  it("keeps the package surface limited to built output", async () => {
    const manifest = await readCliManifest();

    expect(manifest.files).toEqual(["dist"]);
    expect(manifest.exports?.["."]).toEqual({
      types: "./dist/index.d.ts",
      import: "./dist/index.js",
    });
    expect(manifest.bin?.["agentforge-qa"]).toBe("./dist/index.js");
  });

  it("has no install-time lifecycle hooks or unexpected runtime dependencies", async () => {
    const manifest = await readCliManifest();
    const forbiddenLifecycleScripts = [
      "preinstall",
      "install",
      "postinstall",
      "prepare",
      "prepublish",
      "prepublishOnly",
    ];

    for (const scriptName of forbiddenLifecycleScripts) {
      expect(manifest.scripts?.[scriptName]).toBeUndefined();
    }

    expect(manifest.dependencies).toEqual({
      "@agentforge-qa/core": "0.3.0",
      "@agentforge-qa/reporters": "0.3.0",
      "@agentforge-qa/schemas": "0.3.0",
    });
    expect(manifest.devDependencies ?? {}).toEqual({});
  });
});

describe("agentforge-qa CLI production boundaries", () => {
  it("does not import direct command, Git, network, or filesystem-writing modules", async () => {
    const source = await readFile(cliSourceUrl, "utf8");
    const forbiddenSpecifiers = [
      "node:child_process",
      "node:fs",
      "node:fs/promises",
      "node:http",
      "node:https",
      "node:net",
      "node:tls",
    ];

    for (const specifier of forbiddenSpecifiers) {
      expect(source).not.toContain(`"${specifier}"`);
      expect(source).not.toContain(`'${specifier}'`);
    }

    expect(source).not.toContain("spawn(");
    expect(source).not.toContain("exec(");
    expect(source).not.toContain("writeFile(");
  });
});

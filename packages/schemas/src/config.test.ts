import { describe, expect, it } from "vitest";

import {
  ConfigArtifactSchema,
  ConfigCommandSchema,
  NormalizedConfigSchema,
  maxConfigArtifacts,
  maxConfigCommands,
  sampleNormalizedConfig,
  VerificationRequestSchema,
} from "./index.js";

describe("configuration contracts", () => {
  it("parses a valid normalized config", () => {
    expect(NormalizedConfigSchema.parse(sampleNormalizedConfig)).toEqual(
      sampleNormalizedConfig,
    );
    expect(sampleNormalizedConfig).not.toHaveProperty("safety");
    expect(sampleNormalizedConfig).not.toHaveProperty("reporting");
    expect(sampleNormalizedConfig).not.toHaveProperty("git");
  });

  it("parses a valid verification request", () => {
    expect(
      VerificationRequestSchema.parse({
        cwd: "/workspace/agentforge-qa",
        configPath: "agentforge.config.json",
        since: "main",
        claimFile: "codex-summary.md",
        outputDir: ".agentforge",
        mode: "local",
        dryRun: true,
        strict: false,
      }),
    ).toMatchObject({
      cwd: "/workspace/agentforge-qa",
      mode: "local",
      dryRun: true,
    });
  });

  it("rejects an invalid schema version", () => {
    const result = NormalizedConfigSchema.safeParse({
      ...sampleNormalizedConfig,
      schemaVersion: "1.0.0",
    });

    expect(result.success).toBe(false);
  });

  it("rejects a config command with a raw string instead of an args array", () => {
    const result = ConfigCommandSchema.safeParse({
      id: "test",
      label: "Run tests",
      command: "pnpm",
      args: "test",
      required: true,
      timeoutMs: 120_000,
    });

    expect(result.success).toBe(false);
  });

  it("accepts optional command claim keywords without requiring them", () => {
    const command = sampleNormalizedConfig.commands[0];
    expect(ConfigCommandSchema.parse(command).claimKeywords).toBeUndefined();
    expect(
      ConfigCommandSchema.parse({
        ...command,
        claimKeywords: ["local storage", "persistence"],
      }).claimKeywords,
    ).toEqual(["local storage", "persistence"]);
  });

  it("rejects an artifact with an invalid type", () => {
    const result = ConfigArtifactSchema.safeParse({
      id: "report",
      label: "QA report",
      path: ".agentforge/qa-report.md",
      type: "archive",
      required: true,
    });

    expect(result.success).toBe(false);
  });

  it("bounds configured work lists", () => {
    const command = sampleNormalizedConfig.commands[0];
    const artifact = sampleNormalizedConfig.artifacts[0];

    expect(command).toBeDefined();
    expect(artifact).toBeDefined();
    expect(
      NormalizedConfigSchema.safeParse({
        ...sampleNormalizedConfig,
        commands: Array.from({ length: maxConfigCommands + 1 }, () => command),
      }).success,
    ).toBe(false);
    expect(
      NormalizedConfigSchema.safeParse({
        ...sampleNormalizedConfig,
        artifacts: Array.from({ length: maxConfigArtifacts + 1 }, () => artifact),
      }).success,
    ).toBe(false);
  });
});

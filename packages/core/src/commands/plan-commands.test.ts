import { resolve } from "node:path";

import { ConfigCommandSchema } from "@agentforge-qa/schemas";
import { describe, expect, it } from "vitest";

import { planCommands } from "./plan-commands.js";

describe("planCommands", () => {
  it("normalizes configured commands into plans rooted at the repository", () => {
    const repoRoot = resolve("C:/work/repo");
    const commands = ConfigCommandSchema.array().parse([
      {
        id: "test",
        label: "Test",
        command: "pnpm",
        args: ["test"],
        required: true,
        timeoutMs: 30_000,
      },
      {
        id: "nested",
        label: "Nested",
        command: "node",
        args: ["--version"],
        required: false,
        timeoutMs: 5_000,
        cwd: "packages/core",
      },
    ]);

    const plans = planCommands(commands, repoRoot);

    expect(plans[0]?.cwd).toBe(repoRoot);
    expect(plans[1]?.cwd).toBe(resolve(repoRoot, "packages/core"));
  });
});

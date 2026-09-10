import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { EvidenceModuleError } from "../errors/pipeline-errors.js";
import { loadConfig } from "./load-config.js";

const temporaryRoots: string[] = [];

async function createRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "agentforge-config-"));
  temporaryRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) =>
      rm(root, { recursive: true, force: true }),
    ),
  );
});

describe("loadConfig", () => {
  it("uses a schema-valid empty default when no JSON config exists", async () => {
    const loaded = await loadConfig(await createRoot());

    expect(loaded.found).toBe(false);
    expect(loaded.config.commands).toEqual([]);
    expect(loaded.config.artifacts).toEqual([]);
    expect(loaded.summary).toContain("No AgentForge QA JSON config");
  });

  it("loads and validates a root JSON config", async () => {
    const root = await createRoot();
    await writeFile(
      join(root, "agentforge.config.json"),
      JSON.stringify({
        schemaVersion: "0.1.0",
        commands: [],
        artifacts: [],
      }),
    );

    const loaded = await loadConfig(root);

    expect(loaded.found).toBe(true);
    expect(loaded.configPath).toBe("agentforge.config.json");
  });

  it.each([
    ["without a BOM", ""],
    ["with a UTF-8 BOM", "\ufeff"],
  ])("loads valid JSON %s", async (_label, prefix) => {
    const root = await createRoot();
    await writeFile(
      join(root, "agentforge.config.json"),
      `${prefix}${JSON.stringify({
        schemaVersion: "0.1.0",
        commands: [],
        artifacts: [],
      })}`,
      "utf8",
    );

    expect((await loadConfig(root)).found).toBe(true);
  });

  it.each([
    ["malformed JSON", "{"],
    ["malformed JSON after a BOM", "\ufeff{"],
    ["an empty file", ""],
  ])("retains INVALID_CONFIG_JSON for %s", async (_label, contents) => {
    const root = await createRoot();
    await writeFile(join(root, "agentforge.config.json"), contents, "utf8");

    await expect(loadConfig(root)).rejects.toMatchObject({
      code: "INVALID_CONFIG_JSON",
    });
  });

  it("removes only one leading BOM", async () => {
    const root = await createRoot();
    await writeFile(
      join(root, "agentforge.config.json"),
      `\ufeff\ufeff${JSON.stringify({
        schemaVersion: "0.1.0",
        commands: [],
        artifacts: [],
      })}`,
      "utf8",
    );

    await expect(loadConfig(root)).rejects.toMatchObject({
      code: "INVALID_CONFIG_JSON",
    });
  });

  it("loads the secondary .agentforge JSON config", async () => {
    const root = await createRoot();
    await mkdir(join(root, ".agentforge"));
    await writeFile(
      join(root, ".agentforge", "config.json"),
      JSON.stringify({
        schemaVersion: "0.1.0",
        commands: [],
        artifacts: [],
      }),
    );

    expect((await loadConfig(root)).configPath).toBe(".agentforge/config.json");
  });

  it("returns a controlled error for invalid JSON or schema data", async () => {
    const invalidJsonRoot = await createRoot();
    await writeFile(join(invalidJsonRoot, "agentforge.config.json"), "{");

    await expect(loadConfig(invalidJsonRoot)).rejects.toMatchObject({
      code: "INVALID_CONFIG_JSON",
    });

    const invalidSchemaRoot = await createRoot();
    await writeFile(
      join(invalidSchemaRoot, "agentforge.config.json"),
      JSON.stringify({ commands: [], artifacts: [] }),
    );

    await expect(loadConfig(invalidSchemaRoot)).rejects.toMatchObject({
      code: "INVALID_CONFIG",
    });
  });

  it("does not support executable JS or TS config files", async () => {
    const root = await createRoot();

    for (const configPath of ["agentforge.config.js", "agentforge.config.ts"]) {
      await expect(loadConfig(root, configPath)).rejects.toBeInstanceOf(
        EvidenceModuleError,
      );
      await expect(loadConfig(root, configPath)).rejects.toMatchObject({
        code: "UNSUPPORTED_CONFIG_TYPE",
      });
    }
  });

  it("rejects traversal, outside absolute paths, control characters, and oversized files", async () => {
    const root = await createRoot();
    const outside = await createRoot();
    const outsideConfig = join(outside, "outside.json");
    await writeFile(outsideConfig, "{}");
    await writeFile(join(root, "large.json"), " ".repeat(1_000_001));

    await expect(loadConfig(root, "../outside.json")).rejects.toMatchObject({
      code: "CONFIG_PATH_OUTSIDE_REPO",
    });
    await expect(loadConfig(root, outsideConfig)).rejects.toMatchObject({
      code: "CONFIG_PATH_OUTSIDE_REPO",
    });
    await expect(loadConfig(root, "nested\0config.json")).rejects.toMatchObject({
      code: "CONFIG_PATH_CONTROL_CHARACTER_REJECTED",
    });
    await expect(loadConfig(root, "large.json")).rejects.toMatchObject({
      code: "INVALID_CONFIG_FILE",
    });
  });

  it("rejects config symlink escapes where the platform permits them", async () => {
    const root = await createRoot();
    const outside = await createRoot();
    const outsideConfig = join(outside, "outside.json");
    await writeFile(outsideConfig, "{}");

    try {
      await symlink(outsideConfig, join(root, "linked.json"), "file");
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        ["EACCES", "EPERM", "UNKNOWN"].includes(
          String((error as NodeJS.ErrnoException).code),
        )
      ) {
        return;
      }

      throw error;
    }

    await expect(loadConfig(root, "linked.json")).rejects.toMatchObject({
      code: "CONFIG_PATH_OUTSIDE_REPO",
    });
  });
});

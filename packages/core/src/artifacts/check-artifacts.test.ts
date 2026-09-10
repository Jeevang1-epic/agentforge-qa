import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ConfigArtifactSchema, type ConfigArtifact } from "@agentforge-qa/schemas";
import { afterEach, describe, expect, it } from "vitest";

import { checkArtifacts } from "./check-artifacts.js";

const temporaryRoots: string[] = [];

async function createRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "agentforge-artifacts-"));
  temporaryRoots.push(root);
  return root;
}

function artifact(overrides: Partial<ConfigArtifact>): ConfigArtifact {
  return ConfigArtifactSchema.parse({
    id: "artifact",
    label: "Artifact",
    path: "artifact.txt",
    type: "file",
    required: true,
    ...overrides,
  });
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) =>
      rm(root, { recursive: true, force: true }),
    ),
  );
});

describe("checkArtifacts", () => {
  it("checks files, directories, missing paths, and minimum sizes", async () => {
    const root = await createRoot();
    await mkdir(join(root, "results"));
    await writeFile(join(root, "artifact.txt"), "evidence");

    const results = await checkArtifacts(
      [
        artifact({ id: "file-found" }),
        artifact({ id: "file-missing", path: "missing.txt" }),
        artifact({
          id: "directory-found",
          path: "results",
          type: "directory",
        }),
        artifact({
          id: "directory-missing",
          path: "missing-directory",
          type: "directory",
        }),
        artifact({ id: "too-small", minSizeBytes: 100 }),
      ],
      root,
    );

    expect(results.map(({ status }) => status)).toEqual([
      "found",
      "missing",
      "found",
      "missing",
      "missing",
    ]);
    expect(results[0]?.sizeBytes).toBe(8);
    expect(results[4]?.reason).toContain("below the required");
  });

  it("rejects traversal and returns sorted bounded glob matches outside ignored paths", async () => {
    const root = await createRoot();
    await Promise.all(
      [
        "nested",
        "dist",
        "coverage",
        "node_modules",
        ".git",
        join(".agentforge", "logs"),
      ].map((path) => mkdir(join(root, path), { recursive: true })),
    );
    await Promise.all([
      writeFile(join(root, "nested", "z-report.txt"), "report"),
      writeFile(join(root, "nested", "a-report.txt"), "report"),
      writeFile(join(root, "dist", "ignored.txt"), "ignored"),
      writeFile(join(root, "coverage", "ignored.txt"), "ignored"),
      writeFile(join(root, "node_modules", "ignored.txt"), "ignored"),
      writeFile(join(root, ".git", "ignored.txt"), "ignored"),
      writeFile(join(root, ".agentforge", "logs", "ignored.txt"), "ignored"),
    ]);

    const [traversal, glob] = await checkArtifacts(
      [
        artifact({ id: "traversal", path: "../outside.txt" }),
        artifact({ id: "glob", path: "**/*.txt", type: "glob" }),
      ],
      root,
    );

    expect(traversal?.status).toBe("error");
    expect(traversal?.reason).toContain("inside the repository");
    expect(glob?.status).toBe("found");
    expect(glob?.matchedPaths).toEqual([
      "nested/a-report.txt",
      "nested/z-report.txt",
    ]);
  });

  it("rejects symlink artifacts and symlink escapes where the platform permits them", async () => {
    const root = await createRoot();
    const outside = await createRoot();
    await writeFile(join(outside, "secret.txt"), "outside");

    try {
      await symlink(outside, join(root, "outside-link"), "junction");
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

    const [existingEscape, missingEscape, glob] = await checkArtifacts(
      [
        artifact({ id: "existing-escape", path: "outside-link/secret.txt" }),
        artifact({ id: "missing-escape", path: "outside-link/missing.txt" }),
        artifact({ id: "glob", path: "**/*.txt", type: "glob" }),
      ],
      root,
    );

    expect(existingEscape?.status).toBe("error");
    expect(existingEscape?.reason).toContain("inside the repository");
    expect(missingEscape?.status).toBe("error");
    expect(missingEscape?.reason).toContain("inside the repository");
    expect(glob?.matchedPaths).toEqual([]);
  });

  it("fails closed when a bounded glob exceeds its directory-depth limit", async () => {
    const root = await createRoot();
    let directory = root;

    for (let depth = 0; depth < 22; depth += 1) {
      directory = join(directory, `depth-${depth}`);
      await mkdir(directory);
    }

    const [glob] = await checkArtifacts(
      [artifact({ id: "deep-glob", path: "**/*.txt", type: "glob" })],
      root,
    );

    expect(glob?.status).toBe("error");
    expect(glob?.reason).toContain("directory-depth safety limit");
  });
});

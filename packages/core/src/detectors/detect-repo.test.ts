import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { detectRepo } from "./detect-repo.js";

const temporaryRoots: string[] = [];

async function createRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "agentforge-repo-"));
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

describe("detectRepo", () => {
  it("finds a Git root, package manager, and basic framework hints", async () => {
    const root = await createRoot();
    const nested = join(root, "packages", "app");
    await mkdir(join(root, ".git"));
    await mkdir(nested, { recursive: true });
    await Promise.all([
      writeFile(join(root, "pnpm-lock.yaml"), ""),
      writeFile(join(root, "package.json"), "{}"),
      writeFile(join(root, "vite.config.ts"), ""),
      writeFile(join(root, "pyproject.toml"), ""),
    ]);

    const repo = await detectRepo(nested);

    expect(repo.root).toBe(await realpath(root));
    expect(repo.isGitRepo).toBe(true);
    expect(repo.packageManager).toBe("pnpm");
    expect(repo.detectedFrameworks).toEqual(["node", "python", "vite"]);
  });

  it("handles a non-Git directory safely", async () => {
    const root = await createRoot();
    const repo = await detectRepo(root);

    expect(repo.root).toBe(await realpath(root));
    expect(repo.isGitRepo).toBe(false);
    expect(repo.notes?.[0]).toContain("No .git directory or worktree file");
  });

  it("recognizes a .git worktree file marker for later Git confirmation", async () => {
    const root = await createRoot();
    const nested = join(root, "nested");
    await mkdir(nested);
    await writeFile(join(root, ".git"), "gitdir: ../worktrees/example\n");

    const repo = await detectRepo(nested);

    expect(repo.root).toBe(await realpath(root));
    expect(repo.isGitRepo).toBe(true);
    expect(repo.notes?.[0]).toContain(".git file marker");
  });
});

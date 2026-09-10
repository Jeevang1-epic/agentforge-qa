import { spawn } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { RepoProfileSchema } from "@agentforge-qa/schemas";
import { afterEach, describe, expect, it } from "vitest";

import { detectRepo } from "../detectors/detect-repo.js";
import {
  collectGitEvidence,
  parseNameStatusZ,
  parseStatusPorcelainZ,
} from "./collect-git-evidence.js";

const temporaryRoots: string[] = [];

async function createRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "agentforge-git-"));
  temporaryRoots.push(root);
  return root;
}

async function runGit(cwd: string, args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn("git", args, {
      cwd,
      shell: false,
      stdio: "ignore",
      windowsHide: true,
    });

    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`git ${args[0] ?? ""} exited with ${code}`));
      }
    });
  });
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) =>
      rm(root, { recursive: true, force: true }),
    ),
  );
});

describe("collectGitEvidence", () => {
  it("collects exact read-only status and diff paths without its own logs", async () => {
    const root = await createRoot();
    await runGit(root, ["init"]);
    await runGit(root, ["config", "user.email", "agentforge@example.invalid"]);
    await runGit(root, ["config", "user.name", "AgentForge Test"]);
    await Promise.all([
      writeFile(join(root, "file with spaces.txt"), "before"),
      writeFile(join(root, "old-name.txt"), "rename"),
      writeFile(join(root, "deleted.txt"), "delete"),
      writeFile(join(root, "pnpm-lock.yaml"), "lockfileVersion: 9"),
    ]);
    await runGit(root, ["add", "."]);
    await runGit(root, ["commit", "-m", "baseline"]);
    await runGit(root, ["mv", "old-name.txt", "new-name.txt"]);
    await Promise.all([
      writeFile(join(root, "file with spaces.txt"), "after"),
      writeFile(join(root, "pnpm-lock.yaml"), "lockfileVersion: 9\nchanged: true"),
      writeFile(join(root, "untracked file.txt"), "evidence"),
      writeFile(join(root, "TOKEN=abc.txt"), "raw machine-readable path"),
      unlink(join(root, "deleted.txt")),
    ]);

    const collected = await collectGitEvidence(await detectRepo(root), "HEAD");

    expect(collected.status).toBe("collected");
    expect(collected.evidence.changedFiles).toEqual(
      expect.arrayContaining([
        "deleted.txt",
        "file with spaces.txt",
        "new-name.txt",
        "old-name.txt",
        "pnpm-lock.yaml",
      ]),
    );
    expect(collected.evidence.deletedFiles).toContain("deleted.txt");
    expect(collected.evidence.untrackedFiles).toEqual(
      expect.arrayContaining(["TOKEN=abc.txt", "untracked file.txt"]),
    );
    expect(collected.evidence.dependencyFilesChanged).toContain("pnpm-lock.yaml");
    expect(
      [
        ...collected.evidence.changedFiles,
        ...collected.evidence.untrackedFiles,
      ].some((path) => path.startsWith(".agentforge/logs/")),
    ).toBe(false);
    expect(collected.evidence.summary).toContain("read-only Git evidence");
  });

  it("handles a non-Git directory without running Git commands", async () => {
    const root = await createRoot();
    const collected = await collectGitEvidence(
      RepoProfileSchema.parse({
        root,
        isGitRepo: false,
        detectedFrameworks: [],
      }),
    );

    expect(collected.status).toBe("not_git_repo");
    expect(collected.evidence.changedFiles).toEqual([]);
    expect(collected.evidence.summary).toContain("no .git marker");
  });

  it("detects and confirms an actual linked Git worktree", async () => {
    const container = await createRoot();
    const mainRoot = join(container, "main");
    const worktreeRoot = join(container, "linked");
    await mkdir(mainRoot);
    await runGit(mainRoot, ["init"]);
    await runGit(mainRoot, [
      "config",
      "user.email",
      "agentforge@example.invalid",
    ]);
    await runGit(mainRoot, ["config", "user.name", "AgentForge Test"]);
    await writeFile(join(mainRoot, "tracked.txt"), "baseline");
    await runGit(mainRoot, ["add", "."]);
    await runGit(mainRoot, ["commit", "-m", "baseline"]);
    await runGit(mainRoot, [
      "worktree",
      "add",
      "-b",
      "agentforge-linked-test",
      worktreeRoot,
    ]);
    await writeFile(join(worktreeRoot, "worktree-only.txt"), "evidence");

    const repo = await detectRepo(worktreeRoot);
    const collected = await collectGitEvidence(repo);

    expect(repo.root).toBe(await realpath(worktreeRoot));
    expect(repo.notes?.[0]).toContain(".git file marker");
    expect(collected.status).toBe("collected");
    expect(collected.evidence.untrackedFiles).toContain("worktree-only.txt");
  });

  it("parses NUL-delimited status and diff records without quoted-path ambiguity", () => {
    const status = parseStatusPorcelainZ(
      "R  new name.txt\0old name.txt\0?? untracked file.txt\0 D deleted.txt\0",
    );
    const diff = parseNameStatusZ(
      "R100\0old name.txt\0new name.txt\0D\0deleted.txt\0M\0pnpm-lock.yaml\0",
    );

    expect([...status.changedFiles].sort()).toEqual([
      "deleted.txt",
      "new name.txt",
      "old name.txt",
    ]);
    expect([...status.untrackedFiles]).toEqual(["untracked file.txt"]);
    expect([...status.deletedFiles]).toEqual(["deleted.txt"]);
    expect([...diff.changedFiles].sort()).toEqual([
      "deleted.txt",
      "new name.txt",
      "old name.txt",
      "pnpm-lock.yaml",
    ]);
    expect([...diff.deletedFiles]).toEqual(["deleted.txt"]);
  });

  it("rejects malformed or incomplete Git machine output", () => {
    expect(() => parseStatusPorcelainZ("??")).toThrow(
      "incomplete NUL-delimited",
    );
    expect(() => parseStatusPorcelainZ("R  new.txt\0")).toThrow(
      "rename output is incomplete",
    );
    expect(() => parseNameStatusZ("M\0")).toThrow("malformed name-status");
    expect(() => parseNameStatusZ("R100\0old.txt\0")).toThrow(
      "rename output is incomplete",
    );
  });
});

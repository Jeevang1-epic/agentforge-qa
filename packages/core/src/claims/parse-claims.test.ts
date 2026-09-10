import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { EvidenceModuleError } from "../errors/pipeline-errors.js";
import { parseClaims } from "./parse-claims.js";

const temporaryRoots: string[] = [];

async function createRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "agentforge-claims-"));
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

describe("parseClaims", () => {
  it("returns no claims when no claim file is provided", async () => {
    const parsed = await parseClaims(await createRoot());

    expect(parsed.claims).toEqual([]);
    expect(parsed.summary).toContain("No claim file");
  });

  it("parses deterministic text claims with line numbers and skips code fences", async () => {
    const root = await createRoot();
    await writeFile(
      join(root, "claims.md"),
      [
        "# Delivery claims",
        "- Tests passed",
        "- [x] Generated report.txt",
        "1. Built release bundle",
        "Plain deterministic claim",
        "```sh",
        "rm -rf .",
        "```",
      ].join("\n"),
    );

    const parsed = await parseClaims(root, "claims.md");

    expect(parsed.claims.map(({ text }) => text)).toEqual([
      "Tests passed",
      "Generated report.txt",
      "Built release bundle",
      "Plain deterministic claim",
    ]);
    expect(parsed.claims[0]?.lineStart).toBe(2);
    expect(parsed.claims[2]?.lineStart).toBe(4);
    expect(parsed.claims[3]?.lineStart).toBe(5);
    expect(parsed.claims.some(({ text }) => text.includes("rm -rf"))).toBe(false);
  });

  it("returns zero deterministic claims for an empty file", async () => {
    const root = await createRoot();
    await writeFile(join(root, "claims.txt"), "");

    const parsed = await parseClaims(root, "claims.txt");

    expect(parsed.claims).toEqual([]);
    expect(parsed.summary).toContain("Parsed 0 deterministic claims");
  });

  it("fails closed for excessive claims and unclosed code fences", async () => {
    const excessiveRoot = await createRoot();
    await writeFile(
      join(excessiveRoot, "claims.md"),
      Array.from({ length: 501 }, (_, index) => `- Claim ${index + 1}`).join(
        "\n",
      ),
    );

    await expect(parseClaims(excessiveRoot, "claims.md")).rejects.toMatchObject({
      code: "CLAIM_LIMIT_EXCEEDED",
    });

    const unclosedFenceRoot = await createRoot();
    await writeFile(
      join(unclosedFenceRoot, "claims.md"),
      "- Tests passed\n```sh\nnot a claim",
    );

    await expect(
      parseClaims(unclosedFenceRoot, "claims.md"),
    ).rejects.toMatchObject({
      code: "INVALID_CLAIM_FILE",
    });
  });

  it("rejects unsafe claim paths, oversized files, and executable file types", async () => {
    const root = await createRoot();
    const outside = await createRoot();
    const outsideClaim = join(outside, "claims.md");
    await writeFile(outsideClaim, "- Outside claim");
    await writeFile(join(root, "large.md"), "x".repeat(1_000_001));

    await expect(parseClaims(root, "../claims.md")).rejects.toBeInstanceOf(
      EvidenceModuleError,
    );
    await expect(parseClaims(root, outsideClaim)).rejects.toMatchObject({
      code: "CLAIM_FILE_OUTSIDE_REPO",
    });
    await expect(parseClaims(root, "nested\0claims.md")).rejects.toMatchObject({
      code: "CLAIM_FILE_CONTROL_CHARACTER_REJECTED",
    });
    await expect(parseClaims(root, "large.md")).rejects.toMatchObject({
      code: "INVALID_CLAIM_FILE",
    });
    await expect(parseClaims(root, "claims.js")).rejects.toMatchObject({
      code: "UNSUPPORTED_CLAIM_FILE",
    });
  });

  it("rejects claim symlink escapes where the platform permits them", async () => {
    const root = await createRoot();
    const outside = await createRoot();
    const outsideClaim = join(outside, "claims.md");
    await writeFile(outsideClaim, "- Outside claim");

    try {
      await symlink(outsideClaim, join(root, "linked.md"), "file");
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

    await expect(parseClaims(root, "linked.md")).rejects.toMatchObject({
      code: "CLAIM_FILE_OUTSIDE_REPO",
    });
  });
});

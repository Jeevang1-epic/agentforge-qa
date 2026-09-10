import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

interface PackageManifest {
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly devDependencies?: Readonly<Record<string, string>>;
  readonly exports?: Readonly<Record<string, unknown>>;
  readonly name: string;
}

describe("@agentforge-qa/schemas package metadata", () => {
  it("keeps Zod as its only direct dependency", async () => {
    const manifestUrl = new URL("../package.json", import.meta.url);
    const manifest = JSON.parse(
      await readFile(manifestUrl, "utf8"),
    ) as PackageManifest;

    expect(manifest.name).toBe("@agentforge-qa/schemas");
    expect(Object.keys(manifest.dependencies ?? {})).toEqual(["zod"]);
    expect(Object.keys(manifest.devDependencies ?? {})).toEqual([]);
    expect(manifest.exports?.["."]).toBeDefined();
  });
});

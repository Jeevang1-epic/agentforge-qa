import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

function listProductionSourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      return listProductionSourceFiles(path);
    }

    return entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")
      ? [path]
      : [];
  });
}

describe("@agentforge-qa/core security and package boundaries", () => {
  const allowedNodeImports = new Set([
    "node:child_process",
    "node:fs/promises",
    "node:path",
  ]);
  const sourceFiles = listProductionSourceFiles(
    fileURLToPath(new URL(".", import.meta.url)),
  );
  const productionSources = sourceFiles.map((file) => ({
    file,
    source: readFileSync(file, "utf8"),
  }));
  const productionSource = productionSources
    .map(({ source }) => source)
    .join("\n");

  it("keeps process execution in the runner and filesystem access in evidence modules", () => {
    const childProcessSources = productionSources.filter(({ source }) =>
      source.includes('from "node:child_process"'),
    );
    const fileSystemSources = productionSources.filter(({ source }) =>
      /from "node:fs(?:\/promises)?"/.test(source),
    );

    expect(childProcessSources.map(({ file }) => file)).toHaveLength(1);
    expect(childProcessSources[0]?.file).toMatch(
      /commands[\\/]command-runner\.ts$/,
    );
    expect(childProcessSources[0]?.source.match(/\bspawn\s*\(/g)).toHaveLength(1);
    expect(childProcessSources[0]?.source).toContain("shell: false");
    expect(
      childProcessSources[0]?.source.indexOf("!review.approved"),
    ).toBeLessThan(childProcessSources[0]?.source.indexOf("spawn(") ?? -1);
    expect(childProcessSources[0]?.source).toContain(
      "const review = reviewCommandSafety(stablePlan, stableOptions);",
    );
    expect(childProcessSources[0]?.source).toContain(
      "return executeApprovedCommand(stablePlan, review, stableOptions);",
    );
    expect(fileSystemSources.map(({ file }) => file).sort()).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/artifacts[\\/]check-artifacts\.ts$/),
        expect.stringMatching(/artifacts[\\/]search-artifact-glob\.ts$/),
        expect.stringMatching(/claims[\\/]parse-claims\.ts$/),
        expect.stringMatching(/commands[\\/]command-logs\.ts$/),
        expect.stringMatching(/commands[\\/]command-paths\.ts$/),
        expect.stringMatching(/config[\\/]load-config\.ts$/),
        expect.stringMatching(/detectors[\\/]detect-repo\.ts$/),
        expect.stringMatching(/git[\\/]collect-git-evidence\.ts$/),
      ]),
    );
    expect(fileSystemSources).toHaveLength(8);
  });

  it("does not contain shell execution, exec calls, or unrelated unsafe access", () => {
    const forbiddenPatterns = [
      ["exec call", /\bexec\s*\(/],
      ["execFile call", /\bexecFile\s*\(/],
      ["shell enabled", /\bshell\s*:\s*true\b/],
      ["existsSync call", /\bexistsSync\s*\(/],
      ["stat call", /\bstat(?:Sync)?\s*\(/],
      ["glob call", /\bglob\s*\(/],
    ] as const;

    for (const [name, pattern] of forbiddenPatterns) {
      expect(productionSource, `${name} must not exist in core`).not.toMatch(
        pattern,
      );
    }
  });

  it("imports only schemas, Node built-ins, and relative core modules", () => {
    const moduleSpecifierPattern =
      /(?:from\s+|import\s*\(\s*)["']([^"']+)["']/g;

    for (const { file, source } of productionSources) {
      const moduleSpecifiers = [...source.matchAll(moduleSpecifierPattern)].map(
        (match) => match[1],
      );

      for (const moduleSpecifier of moduleSpecifiers) {
        expect(
          moduleSpecifier === "@agentforge-qa/schemas" ||
            (moduleSpecifier !== undefined &&
              allowedNodeImports.has(moduleSpecifier)) ||
            moduleSpecifier?.startsWith("."),
          `${file} imports forbidden module ${moduleSpecifier}`,
        ).toBe(true);
      }
    }
  });

  it("keeps the safe verdict inside the conservative verdict engine", () => {
    const safeVerdictSources = productionSources.filter(({ source }) =>
      source.includes('"SAFE_TO_CONTINUE"'),
    );

    expect(safeVerdictSources.map(({ file }) => file)).toEqual([
      expect.stringMatching(/verdict[\\/]determine-verdict\.ts$/),
    ]);
    expect(safeVerdictSources[0]?.source).toContain("const hasEvidence");
    expect(safeVerdictSources[0]?.source).toContain("inputs.commands.every");
    expect(safeVerdictSources[0]?.source).toContain("inputs.artifacts.every");
    expect(safeVerdictSources[0]?.source).toContain("inputs.claimVerdicts.every");
    expect(safeVerdictSources[0]?.source).toContain(
      "blocksVerdict === true",
    );
  });

  it("does not expose claim contracts to command execution modules", () => {
    const commandSource = productionSources
      .filter(({ file }) => file.includes(`${join("src", "commands")}`))
      .map(({ source }) => source)
      .join("\n");

    expect(commandSource).not.toMatch(/\bClaim(?:Schema|Verdict)?\b/);
  });

  it("integrates only configured commands through the safe runner boundary", () => {
    const pipelineSource = productionSources
      .filter(({ file }) => file.includes(`${join("src", "pipeline")}`))
      .map(({ source }) => source)
      .join("\n");

    expect(pipelineSource).toContain("runConfiguredCommands");
    expect(pipelineSource).not.toMatch(
      /runApprovedCommand|runCommandPlan|node:child_process|claim\.text/,
    );
  });

  it("keeps raw command output limited to the runner and read-only Git collector", () => {
    const rawOutputSources = productionSources.filter(({ source }) =>
      source.includes("runCommandPlanWithOutput"),
    );

    expect(rawOutputSources.map(({ file }) => file).sort()).toEqual([
      expect.stringMatching(/commands[\\/]command-runner\.ts$/),
      expect.stringMatching(/git[\\/]collect-git-evidence\.ts$/),
    ]);
    expect(
      productionSources.find(({ file }) =>
        file.endsWith(join("commands", "command-runner.ts")),
      )?.source,
    ).toContain("shell: false");
  });

  it("limits Git runtime plans to explicit read-only machine-readable commands", () => {
    const policySource = productionSources.find(({ file }) =>
      file.endsWith(join("commands", "command-policy.ts")),
    )?.source;
    const gitSource = productionSources.find(({ file }) =>
      file.endsWith(join("git", "collect-git-evidence.ts")),
    )?.source;

    expect(policySource).toContain('"status"');
    expect(policySource).toContain('"--porcelain=v1"');
    expect(policySource).toContain('"rev-parse"');
    expect(policySource).toContain('"--show-toplevel"');
    expect(policySource).toContain('"diff"');
    expect(policySource).toContain('"-z"');
    expect(gitSource).toContain("runCommandPlanWithOutput");
    expect(gitSource).not.toMatch(
      /["'](?:commit|push|checkout|reset|clean|pull|fetch|merge|rebase)["']/,
    );
  });

  it("contains no network, paid API, auto-fix, or forbidden git runtime", () => {
    expect(productionSource).not.toMatch(
      /\bfetch\s*\(|node:https|node:http|openai|anthropic|auto-?fix/i,
    );
    expect(productionSource).not.toMatch(
      /["'](?:commit|push|checkout|reset|clean|pull|fetch|merge|rebase)["']/,
    );
  });
});

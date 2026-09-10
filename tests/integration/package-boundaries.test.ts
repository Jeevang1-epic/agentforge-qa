import { readFile, readdir } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import * as ts from "typescript";
import { describe, expect, it } from "vitest";

interface PackageManifest {
  readonly name: string;
  readonly private?: boolean;
  readonly bin?: Readonly<Record<string, string>>;
  readonly exports?: Readonly<
    Record<
      string,
      Readonly<{
        readonly import?: string;
        readonly types?: string;
      }>
    >
  >;
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly devDependencies?: Readonly<Record<string, string>>;
}

const packageDirectories = [
  "schemas",
  "core",
  "reporters",
  "cli",
  "testkit",
] as const;

type PackageDirectory = (typeof packageDirectories)[number];

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));

const workspacePackageNames = new Set([
  "@agentforge-qa/schemas",
  "@agentforge-qa/core",
  "@agentforge-qa/reporters",
  "agentforge-qa",
  "@agentforge-qa/testkit",
]);

const allowedProductionWorkspaceImports = {
  schemas: new Set<string>(),
  core: new Set(["@agentforge-qa/schemas"]),
  reporters: new Set(["@agentforge-qa/schemas"]),
  cli: new Set([
    "@agentforge-qa/schemas",
    "@agentforge-qa/core",
    "@agentforge-qa/reporters",
  ]),
} as const;

async function readManifest(packageDirectory: PackageDirectory): Promise<PackageManifest> {
  const manifestPath = resolve(
    repositoryRoot,
    "packages",
    packageDirectory,
    "package.json",
  );
  const contents = await readFile(manifestPath, "utf8");

  return JSON.parse(contents) as PackageManifest;
}

async function readRootManifest(): Promise<PackageManifest> {
  const contents = await readFile(resolve(repositoryRoot, "package.json"), "utf8");

  return JSON.parse(contents) as PackageManifest;
}

function dependencyNames(manifest: PackageManifest): readonly string[] {
  return [
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.devDependencies ?? {}),
  ];
}

function workspaceDependencyNames(manifest: PackageManifest): readonly string[] {
  return dependencyNames(manifest).filter((name) => workspacePackageNames.has(name));
}

async function findSourceFiles(directory: string): Promise<readonly string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nestedFiles = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = resolve(directory, entry.name);

      if (entry.isDirectory()) {
        return findSourceFiles(entryPath);
      }

      if (entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
        return [entryPath];
      }

      return [];
    }),
  );

  return nestedFiles.flat();
}

function collectModuleSpecifiers(sourcePath: string, sourceText: string): readonly string[] {
  const sourceFile = ts.createSourceFile(
    sourcePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const specifiers: string[] = [];

  function visit(node: ts.Node): void {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text);
    }

    if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      node.moduleReference.expression !== undefined &&
      ts.isStringLiteralLike(node.moduleReference.expression)
    ) {
      specifiers.push(node.moduleReference.expression.text);
    }

    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] !== undefined &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      specifiers.push(node.arguments[0].text);
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);

  return specifiers;
}

function workspacePackageForSpecifier(specifier: string): string | undefined {
  return [...workspacePackageNames].find(
    (packageName) => specifier === packageName || specifier.startsWith(`${packageName}/`),
  );
}

describe("workspace package boundaries", () => {
  it("keeps the workspace root private", async () => {
    const rootManifest = await readRootManifest();

    expect(rootManifest.name).toBe("@agentforge-qa/workspace");
    expect(rootManifest.private).toBe(true);
  });

  it("uses the required package names", async () => {
    const manifests = await Promise.all(packageDirectories.map(readManifest));

    expect(manifests.map(({ name }) => name)).toEqual([
      "@agentforge-qa/schemas",
      "@agentforge-qa/core",
      "@agentforge-qa/reporters",
      "agentforge-qa",
      "@agentforge-qa/testkit",
    ]);
  });

  it("keeps production workspace dependencies inside allowed directions", async () => {
    for (const packageDirectory of [
      "schemas",
      "core",
      "reporters",
      "cli",
    ] as const) {
      const manifest = await readManifest(packageDirectory);
      const allowedDependencies = allowedProductionWorkspaceImports[packageDirectory];

      for (const dependency of workspaceDependencyNames(manifest)) {
        expect(
          allowedDependencies.has(dependency),
          `${manifest.name} must not depend on ${dependency}`,
        ).toBe(true);
      }
    }
  });

  it("keeps testkit out of production package dependencies", async () => {
    const productionDirectories = [
      "schemas",
      "core",
      "reporters",
      "cli",
    ] as const;
    const manifests = await Promise.all(productionDirectories.map(readManifest));

    for (const manifest of manifests) {
      expect(dependencyNames(manifest)).not.toContain("@agentforge-qa/testkit");
    }
  });

  it("keeps production source imports inside package boundaries", async () => {
    const boundaryViolations: string[] = [];

    for (const packageDirectory of [
      "schemas",
      "core",
      "reporters",
      "cli",
    ] as const) {
      const packageRoot = resolve(repositoryRoot, "packages", packageDirectory);
      const sourceFiles = await findSourceFiles(resolve(packageRoot, "src"));
      const allowedImports = allowedProductionWorkspaceImports[packageDirectory];

      for (const sourcePath of sourceFiles) {
        const sourceText = await readFile(sourcePath, "utf8");

        for (const specifier of collectModuleSpecifiers(sourcePath, sourceText)) {
          const workspacePackage = workspacePackageForSpecifier(specifier);

          if (specifier.includes(".test") || specifier.split(/[\\/]/).includes("tests")) {
            boundaryViolations.push(
              `${relative(repositoryRoot, sourcePath)} imports test code via ${specifier}`,
            );
          }

          if (workspacePackage !== undefined && !allowedImports.has(workspacePackage)) {
            boundaryViolations.push(
              `${relative(repositoryRoot, sourcePath)} imports forbidden ${specifier}`,
            );
          }

          if (specifier.startsWith(".")) {
            const targetPath = resolve(dirname(sourcePath), specifier);
            const packageRelativeTarget = relative(packageRoot, targetPath);

            if (
              packageRelativeTarget.startsWith("..") ||
              isAbsolute(packageRelativeTarget)
            ) {
              boundaryViolations.push(
                `${relative(repositoryRoot, sourcePath)} crosses its package boundary via ${specifier}`,
              );
            }
          }
        }
      }
    }

    expect(boundaryViolations).toEqual([]);
  });

  it("wires package exports and the CLI executable to built output", async () => {
    const manifests = await Promise.all(packageDirectories.map(readManifest));
    const cliManifest = manifests.find(({ name }) => name === "agentforge-qa");
    const cliSource = await readFile(
      resolve(repositoryRoot, "packages", "cli", "src", "index.ts"),
      "utf8",
    );

    for (const manifest of manifests) {
      expect(manifest.exports?.["."]).toEqual({
        types: "./dist/index.d.ts",
        import: "./dist/index.js",
      });
    }

    expect(cliManifest?.bin?.["agentforge-qa"]).toBe("./dist/index.js");
    expect(cliSource.startsWith("#!/usr/bin/env node\n")).toBe(true);
  });
});

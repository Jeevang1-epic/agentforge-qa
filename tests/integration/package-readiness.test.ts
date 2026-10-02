import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

interface PackageManifest {
  readonly bin?: Readonly<Record<string, string>>;
  readonly bugs?: unknown;
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly description?: string;
  readonly devDependencies?: Readonly<Record<string, string>>;
  readonly engines?: Readonly<Record<string, string>>;
  readonly exports?: Readonly<
    Record<
      string,
      Readonly<{
        readonly import?: string;
        readonly types?: string;
      }>
    >
  >;
  readonly files?: readonly string[];
  readonly homepage?: unknown;
  readonly keywords?: readonly string[];
  readonly license?: string;
  readonly name: string;
  readonly packageManager?: string;
  readonly peerDependencies?: Readonly<Record<string, string>>;
  readonly pnpm?: Readonly<{
    readonly ignoredBuiltDependencies?: readonly string[];
    readonly overrides?: Readonly<Record<string, string>>;
    readonly patchedDependencies?: Readonly<Record<string, string>>;
  }>;
  readonly private?: boolean;
  readonly publishConfig?: Readonly<Record<string, unknown>>;
  readonly repository?: unknown;
  readonly scripts?: Readonly<Record<string, string>>;
  readonly type?: string;
  readonly version: string;
}

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const repositoryUrl = "git+https://github.com/Jeevang1-epic/agentforge-qa.git";
const issuesUrl = "https://github.com/Jeevang1-epic/agentforge-qa/issues";
const homepageUrl = "https://github.com/Jeevang1-epic/agentforge-qa#readme";
const supportedNodeRange = "^20.19.0 || >=22.12.0";
const packageManifestPaths = [
  "package.json",
  "packages/schemas/package.json",
  "packages/core/package.json",
  "packages/reporters/package.json",
  "packages/cli/package.json",
  "packages/testkit/package.json",
  "examples/node-basic/package.json",
] as const;
const workspacePackagePaths = [
  "package.json",
  "packages/schemas/package.json",
  "packages/core/package.json",
  "packages/reporters/package.json",
  "packages/cli/package.json",
  "packages/testkit/package.json",
] as const;
const runtimePackagePaths = [
  "packages/schemas/package.json",
  "packages/core/package.json",
  "packages/reporters/package.json",
  "packages/cli/package.json",
] as const;
const expectedWorkspacePackageNames = {
  "package.json": "@agentforge-qa/workspace",
  "packages/schemas/package.json": "@agentforge-qa/schemas",
  "packages/core/package.json": "@agentforge-qa/core",
  "packages/reporters/package.json": "@agentforge-qa/reporters",
  "packages/cli/package.json": "agentforge-qa",
  "packages/testkit/package.json": "@agentforge-qa/testkit",
} as const;
const expectedRuntimeDependencies = {
  "packages/schemas/package.json": {
    zod: "^4.4.3",
  },
  "packages/core/package.json": {
    "@agentforge-qa/schemas": "0.3.0",
  },
  "packages/reporters/package.json": {
    "@agentforge-qa/schemas": "0.3.0",
  },
  "packages/cli/package.json": {
    "@agentforge-qa/core": "0.3.0",
    "@agentforge-qa/reporters": "0.3.0",
    "@agentforge-qa/schemas": "0.3.0",
  },
} as const;
const forbiddenLifecycleScripts = [
  "preinstall",
  "install",
  "postinstall",
  "prepare",
  "prepack",
  "postpack",
  "prepublish",
  "prepublishOnly",
  "publish",
  "postpublish",
  "release",
  "deploy",
] as const;
const forbiddenScriptPatterns: readonly (readonly [string, RegExp])[] = [
  ["publish command", /\b(?:npm|pnpm|yarn)\s+publish\b/i],
  ["GitHub release", /\bgh\s+release\b/i],
  ["git push", /\bgit\s+push\b/i],
  ["network download", /\b(?:curl|wget)\b/i],
  ["PowerShell shell-out", /\bpowershell(?:\.exe)?\b/i],
  ["shell command string", /\b(?:bash|sh)\s+-c\b/i],
  ["Node eval", /\bnode\s+-e\b/i],
  ["recursive delete", /\brm\s+-rf\b|\bdel\s+\/s\b/i],
  ["privilege escalation", /\bsudo\b/i],
  ["chmod executable change", /\bchmod\s+\+x\b/i],
  ["auth/token/login", /\b(?:auth|login|token)\b/i],
  ["deployment", /\bdeploy\b/i],
];

async function readManifest(path: string): Promise<PackageManifest> {
  return JSON.parse(
    await readFile(resolve(repositoryRoot, path), "utf8"),
  ) as PackageManifest;
}

async function readManifestEntries(
  paths: readonly string[] = packageManifestPaths,
): Promise<readonly { readonly manifest: PackageManifest; readonly path: string }[]> {
  return Promise.all(
    paths.map(async (path) => ({
      manifest: await readManifest(path),
      path,
    })),
  );
}

function dependencyEntries(
  manifest: PackageManifest,
): readonly (readonly [string, string])[] {
  return [
    ...Object.entries(manifest.dependencies ?? {}),
    ...Object.entries(manifest.peerDependencies ?? {}),
  ];
}

describe("package readiness guardrails", () => {
  it("keeps only the workspace, testkit, and examples private", async () => {
    const manifests = await readManifestEntries();

    expect(
      Object.fromEntries(
        manifests.map(({ manifest, path }) => [path, manifest.private]),
      ),
    ).toEqual({
      "package.json": true,
      "packages/schemas/package.json": undefined,
      "packages/core/package.json": undefined,
      "packages/reporters/package.json": undefined,
      "packages/cli/package.json": undefined,
      "packages/testkit/package.json": true,
      "examples/node-basic/package.json": true,
    });
  });

  it("uses the owned package scope without stale runtime dependencies", async () => {
    const manifests = await readManifestEntries(workspacePackagePaths);

    expect(
      Object.fromEntries(
        manifests.map(({ manifest, path }) => [path, manifest.name]),
      ),
    ).toEqual(expectedWorkspacePackageNames);

    for (const { manifest, path } of await readManifestEntries(runtimePackagePaths)) {
      for (const [dependencyName] of dependencyEntries(manifest)) {
        expect(
          dependencyName,
          `${path} must not depend on the retired @agentforge scope`,
        ).not.toMatch(/^@agentforge\//);
      }
    }
  });

  it("uses the root MIT license across workspace package metadata", async () => {
    const licenseText = await readFile(resolve(repositoryRoot, "LICENSE"), "utf8");

    expect(licenseText).toContain("MIT License");
    expect(licenseText).toContain("Copyright (c) 2026 P. Jeevan Kumar");

    for (const { manifest, path } of await readManifestEntries(workspacePackagePaths)) {
      expect(manifest.license, `${path} must match the root license`).toBe("MIT");
    }
  });

  it("documents truthful metadata for future runtime package publishing", async () => {
    const manifests = await readManifestEntries(runtimePackagePaths);

    for (const { manifest, path } of manifests) {
      const packageDirectory = path.replace("/package.json", "");

      expect(manifest.private, `${path} must be publishable later`).not.toBe(true);
      expect(manifest.version).toBe("0.3.0");
      expect(manifest.description?.length ?? 0).toBeGreaterThan(20);
      expect(manifest.type).toBe("module");
      expect(manifest.license).toBe("MIT");
      expect(manifest.repository).toEqual({
        type: "git",
        url: repositoryUrl,
        directory: packageDirectory,
      });
      expect(manifest.bugs).toEqual({ url: issuesUrl });
      expect(manifest.homepage).toBe(homepageUrl);
      expect(manifest.engines).toEqual({ node: supportedNodeRange });
      expect(manifest.files).toEqual(["dist"]);
      expect(manifest.exports?.["."]).toEqual({
        types: "./dist/index.d.ts",
        import: "./dist/index.js",
      });
      expect(manifest.keywords).toEqual(
        expect.arrayContaining(["agentforge", "qa", "verification", "local-first"]),
      );

      const packageReadme = await readFile(
        resolve(repositoryRoot, packageDirectory, "README.md"),
        "utf8",
      );
      const packageLicense = await readFile(
        resolve(repositoryRoot, packageDirectory, "LICENSE"),
        "utf8",
      );

      expect(packageReadme).toMatch(/^# /);
      expect(packageLicense).toContain("MIT License");
      expect(packageLicense).toContain("Copyright (c) 2026 P. Jeevan Kumar");

      if (manifest.name.startsWith("@agentforge-qa/")) {
        expect(manifest.publishConfig).toEqual({ access: "public" });
      }
    }
  });

  it("keeps scripts free of lifecycle hooks, publish automation, and hidden network behavior", async () => {
    const manifests = await readManifestEntries();

    for (const { manifest, path } of manifests) {
      for (const scriptName of forbiddenLifecycleScripts) {
        expect(
          manifest.scripts?.[scriptName],
          `${path} must not define ${scriptName}`,
        ).toBeUndefined();
      }

      for (const [scriptName, script] of Object.entries(manifest.scripts ?? {})) {
        for (const [label, pattern] of forbiddenScriptPatterns) {
          expect(
            script,
            `${path} script "${scriptName}" must not contain ${label}`,
          ).not.toMatch(pattern);
        }
      }
    }
  });

  it("keeps the CLI package surface limited to built runtime files", async () => {
    const manifest = await readManifest("packages/cli/package.json");

    expect(manifest.name).toBe("agentforge-qa");
    expect(manifest.version).toBe("0.3.0");
    expect(manifest.description).toBe(
      "Local-first CLI for verifying AI coding-agent work.",
    );
    expect(manifest.type).toBe("module");
    expect(manifest.private).toBeUndefined();
    expect(manifest.license).toBe("MIT");
    expect(manifest.engines).toEqual({ node: supportedNodeRange });
    expect(manifest.bin).toEqual({
      "agentforge-qa": "./dist/index.js",
    });
    expect(manifest.exports?.["."]).toEqual({
      types: "./dist/index.d.ts",
      import: "./dist/index.js",
    });
    expect(manifest.files).toEqual(["dist"]);
    expect(manifest.devDependencies ?? {}).toEqual({});
    expect(manifest.peerDependencies ?? {}).toEqual({});
    expect(manifest.dependencies).toEqual({
      "@agentforge-qa/core": "0.3.0",
      "@agentforge-qa/reporters": "0.3.0",
      "@agentforge-qa/schemas": "0.3.0",
    });
  });

  it("uses publishable runtime dependency ranges and local workspace linking", async () => {
    const manifests = await readManifestEntries(workspacePackagePaths);
    const workspaceConfig = await readFile(
      resolve(repositoryRoot, "pnpm-workspace.yaml"),
      "utf8",
    );

    for (const { manifest, path } of manifests) {
      for (const [, version] of dependencyEntries(manifest)) {
        expect(version, `${path} must not leak workspace protocol ranges`).not.toMatch(
          /^workspace:/,
        );
      }
    }

    for (const { manifest, path } of await readManifestEntries(runtimePackagePaths)) {
      expect(manifest.dependencies ?? {}).toEqual(expectedRuntimeDependencies[path]);
    }

    expect(workspaceConfig).toMatch(/^linkWorkspacePackages:\s*true$/m);
  });

  it("keeps tarballs, generated reports, and local secrets out of Git", async () => {
    const gitignore = await readFile(resolve(repositoryRoot, ".gitignore"), "utf8");

    expect(gitignore).toMatch(/^\.env$/m);
    expect(gitignore).toMatch(/^\.env\.\*$/m);
    expect(gitignore).toMatch(/^\*\.log$/m);
    expect(gitignore).toMatch(/^\*\.tgz$/m);
    expect(gitignore).toMatch(/^\.agentforge\/$/m);
  });

  it("pins audit remediation overrides narrowly", async () => {
    const manifest = await readManifest("package.json");

    expect(manifest.pnpm?.ignoredBuiltDependencies).toEqual(["esbuild"]);
    expect(manifest.pnpm?.overrides).toEqual({
      "brace-expansion@<1.1.18": "1.1.18",
      "brace-expansion@>=3.0.0 <5.0.9": "5.0.9",
      esbuild: "0.28.1",
      "js-yaml@>=4.0.0 <4.3.2": "4.3.2",
      "nanoid@<3.3.18": "3.3.18",
      "postcss@<=8.5.22": "8.5.23",
    });
    expect(manifest.pnpm?.patchedDependencies).toBeUndefined();
  });
});

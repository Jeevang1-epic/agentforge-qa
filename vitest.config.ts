import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const workspaceSourceAliases = {
  "@agentforge-qa/schemas": fileURLToPath(
    new URL("./packages/schemas/src/index.ts", import.meta.url),
  ),
  "@agentforge-qa/core": fileURLToPath(
    new URL("./packages/core/src/index.ts", import.meta.url),
  ),
  "@agentforge-qa/reporters": fileURLToPath(
    new URL("./packages/reporters/src/index.ts", import.meta.url),
  ),
  "@agentforge-qa/testkit": fileURLToPath(
    new URL("./packages/testkit/src/index.ts", import.meta.url),
  ),
} as const;

export default defineConfig({
  resolve: {
    alias: workspaceSourceAliases,
  },
  test: {
    clearMocks: true,
    environment: "node",
    passWithNoTests: false,
    restoreMocks: true,
  },
});

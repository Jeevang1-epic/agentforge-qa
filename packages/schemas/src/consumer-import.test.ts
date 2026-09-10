import { describe, expect, it } from "vitest";

interface SchemasConsumerApi {
  readonly NormalizedConfigSchema: {
    safeParse(value: unknown): { readonly success: boolean };
  };
  readonly sampleNormalizedConfig: unknown;
  readonly schemaVersion: string;
}

describe("@agentforge-qa/schemas consumer import", () => {
  it("loads the built public API through the workspace package name", async () => {
    const packageName = "@agentforge-qa/schemas";
    const publicApi = (await import(/* @vite-ignore */ packageName)) as SchemasConsumerApi;

    expect(publicApi.schemaVersion).toBe("0.1.0");
    expect(
      publicApi.NormalizedConfigSchema.safeParse(publicApi.sampleNormalizedConfig)
        .success,
    ).toBe(true);
  });
});

import { describe, expect, it } from "vitest";

import { redactCommandText } from "./command-redaction.js";

describe("redactCommandText", () => {
  it("redacts assignment, GitHub, OpenAI-style, and bearer secrets", () => {
    const redacted = redactCommandText(
      'TOKEN=abc API_KEY="def" SECRET=\'ghi\' Authorization: Bearer auth-value ghp_123456 sk-abcdef',
    );

    expect(redacted).toContain("TOKEN=[REDACTED]");
    expect(redacted).toContain("API_KEY=[REDACTED]");
    expect(redacted).toContain("SECRET=[REDACTED]");
    expect(redacted).toContain("[REDACTED_GITHUB_TOKEN]");
    expect(redacted).toContain("[REDACTED_API_KEY]");
    expect(redacted).toContain("Bearer [REDACTED]");
    expect(redacted).not.toContain("abc");
    expect(redacted).toContain("Authorization: Bearer [REDACTED]");
    expect(redacted).not.toContain("auth-value");
  });

  it("redacts truncated token prefixes", () => {
    expect(redactCommandText("ghp_a sk-z")).toBe(
      "[REDACTED_GITHUB_TOKEN] [REDACTED_API_KEY]",
    );
  });

  it("redacts common environment secret names", () => {
    const redacted = redactCommandText(
      "GITHUB_TOKEN=abc OPENAI_API_KEY=def PASSWORD=ghi DB_PRIVATE_KEY=jkl github_pat_123456",
    );

    expect(redacted).toContain("GITHUB_TOKEN=[REDACTED]");
    expect(redacted).toContain("OPENAI_API_KEY=[REDACTED]");
    expect(redacted).toContain("PASSWORD=[REDACTED]");
    expect(redacted).toContain("DB_PRIVATE_KEY=[REDACTED]");
    expect(redacted).toContain("[REDACTED_GITHUB_TOKEN]");
    expect(redacted).not.toContain("abc");
    expect(redacted).not.toContain("github_pat_123456");
  });
});

import { describe, expect, it } from "vitest";

import {
  placeholderFixtureName,
  TESTKIT_PACKAGE_NAME,
} from "./index.js";

describe("@agentforge-qa/testkit foundation", () => {
  it("exports a test-only placeholder helper", () => {
    expect(TESTKIT_PACKAGE_NAME).toBe("@agentforge-qa/testkit");
    expect(placeholderFixtureName("repo")).toBe("placeholder:repo");
  });
});

import { describe, expect, it } from "vitest";

import * as core from "./index.js";

describe("@agentforge-qa/core public API", () => {
  it("exports only the stable core entry points", () => {
    expect(Object.keys(core).sort()).toEqual([
      "buildDecisionSummary",
      "createEmptyVerificationReport",
      "createToolErrorReport",
      "runVerification",
    ]);

    expect(core.createEmptyVerificationReport).toBeTypeOf("function");
    expect(core.createToolErrorReport).toBeTypeOf("function");
    expect(core.runVerification).toBeTypeOf("function");
  });
});

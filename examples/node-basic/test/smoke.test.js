import assert from "node:assert/strict";

import { formatGreeting } from "../src/index.js";

assert.equal(formatGreeting("developer"), "Hello, developer.");
assert.equal(formatGreeting("  "), "Hello, AgentForge.");

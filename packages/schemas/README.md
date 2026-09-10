# @agentforge-qa/schemas

`@agentforge-qa/schemas` owns the shared data contracts for AgentForge QA.

It uses Zod for runtime validation and exports TypeScript types inferred from
those schemas. The package has no downstream AgentForge dependencies and does
not implement verification logic.

Core, reporters, CLI adapters, and tests should consume these contracts instead
of defining incompatible local shapes.

`VerificationRequest.outputDir` and `VerificationRequest.strict` are reserved
v0.1 contract fields. The current core pipeline accepts them but does not yet
change behavior based on them.

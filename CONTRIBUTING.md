# Contributing

AgentForge QA is a TypeScript pnpm workspace for a local-first verification CLI.
Small, focused changes are easiest to review.

## Setup

```bash
pnpm install
pnpm build
```

## Validation

Run the standard checks before describing work as complete:

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm smoke
pnpm lint
```

## Package Boundaries

- `packages/schemas` owns shared types, validators, enums, and schema constants.
- `packages/core` owns verification orchestration and evidence execution.
- `packages/reporters` renders `VerificationReport` data without changing verdicts.
- `packages/cli` stays a thin terminal adapter.
- `packages/testkit` is private and test-only.

Do not add SaaS, dashboard, API server, VS Code extension, GitHub Action, MCP
server, paid AI API dependency, or npm publishing automation as part of routine
maintenance work.

## Contribution Licensing

By submitting a contribution, you represent that you have the right to submit
it and agree that your contribution will be licensed under the repository's MIT
License.

Contributors retain whatever copyright they legally hold in their original
contributions unless a separate written agreement states otherwise. The project
does not require a separate contributor license agreement.

## Security Expectations

Treat claim text and repository input as untrusted. Prefer command-plus-args
execution, keep filesystem access inside the target repository, redact secrets
from logs, and avoid automatic file edits.

# solo developer

 *Puttala Jeevan Kumar(g1) - Jeevang1-epic*

# Node Basic Example

This is a tiny local Node fixture for trying `agentforge-qa verify`.

It contains:

- `agentforge.config.json` with one optional safe Node smoke command and two
  required artifact checks
- `CLAIMS.md` with deterministic claims that match the configured artifacts
- `src/index.js`, a small dependency-free module
- `test/smoke.test.js`, a local Node assertion script
- `artifacts/summary.txt`, a committed fixture artifact

From the repository root, after `pnpm build`:

```bash
node packages/cli/dist/index.js verify examples/node-basic --format markdown --exit-zero
node packages/cli/dist/index.js verify examples/node-basic --format json --exit-zero
```

To include this fixture's config and claims:

```bash
node packages/cli/dist/index.js verify examples/node-basic --config examples/node-basic/agentforge.config.json --claims examples/node-basic/CLAIMS.md --format markdown --exit-zero
node packages/cli/dist/index.js verify examples/node-basic --config examples/node-basic/agentforge.config.json --claims examples/node-basic/CLAIMS.md --format json --exit-zero
```

The CLI is dry-run by default. In dry-run mode the configured command is skipped,
while artifact checks and claim matching still run. Use `--run` only when you
explicitly want the safe runner to execute the configured Node smoke command.

This fixture has no dependencies, no API keys, and no network requirement.
The report is printed to stdout only; no `.agentforge/report.md` or
`.agentforge/report.json` file is created.

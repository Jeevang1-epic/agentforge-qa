# Local CLI Demo

This demo shows how to run AgentForge QA against the repository's local example
fixtures after building the workspace.

## Setup

From a fresh clone:

```bash
pnpm install
pnpm build
pnpm smoke
```

The smoke command checks help, version, verify help, and a dry-run JSON verify
run. It does not publish packages or write report files.

## Basic Example

`examples/node-basic` is the main runnable fixture. It includes a JSON config,
deterministic claims, a tiny Node source file, a local smoke test, and committed
artifact files.

You can run the built CLI against the fixture with Markdown output:

```bash
node packages/cli/dist/index.js verify examples/node-basic --format markdown --exit-zero
```

For JSON output:

```bash
node packages/cli/dist/index.js verify examples/node-basic --format json --exit-zero
```

Those commands prove the built CLI can render reports for a local example path.
JSON output is written to stdout as parseable JSON.

For a compact terminal decision after running the configured smoke command:

```bash
node packages/cli/dist/index.js verify examples/node-basic --config examples/node-basic/agentforge.config.json --claims examples/node-basic/CLAIMS.md --run --summary-only
```

For minimal structured output:

```bash
node packages/cli/dist/index.js verify examples/node-basic --config examples/node-basic/agentforge.config.json --claims examples/node-basic/CLAIMS.md --run --format json --summary-only
```

The first command prints only the report heading and Decision Summary. The
second prints valid JSON containing `schemaVersion` and `summary`; operational
details remain on stderr.

To include the fixture's configured artifacts and deterministic claims, pass the
example config and claim file explicitly:

```bash
node packages/cli/dist/index.js verify examples/node-basic --config examples/node-basic/agentforge.config.json --claims examples/node-basic/CLAIMS.md --format markdown --exit-zero
node packages/cli/dist/index.js verify examples/node-basic --config examples/node-basic/agentforge.config.json --claims examples/node-basic/CLAIMS.md --format json --exit-zero
```

`verify` is dry-run by default, so configured commands are skipped unless
`--run` is provided. Artifact checks and claim matching still run locally.
Use `--run` only when you intentionally want the safe runner to execute the
configured Node smoke command.

## Blocked Demo Fixture

`examples/demo-blocked` intentionally points at a missing demo-critical artifact.
It is useful for seeing a conservative `DEMO_BLOCKED` report:

```bash
node packages/cli/dist/index.js verify examples/demo-blocked --config examples/demo-blocked/agentforge.config.json --claims examples/demo-blocked/CLAIMS.md --format json --exit-zero
```

## Current Limitations

AgentForge QA currently renders reports to stdout. It does not write
`.agentforge/report.md` or `.agentforge/report.json`, and the `init`, `doctor`,
and `report` commands are not implemented yet.

The examples are local-only and do not require API keys, model downloads,
package registry access, or network services.

## Suggested Repository Presentation

Repository owners can manually configure public GitHub metadata later:

- Description: local-first CLI for verifying AI coding-agent work before shipping
- Topics: `cli`, `typescript`, `ai-agents`, `verification`, `developer-tools`,
  `local-first`, `qa`, `testing`
- Social preview: add only after project branding exists

# Demo Blocked Example

This fixture is intentionally incomplete. Its config points at a missing
demo-critical artifact so `agentforge-qa verify` can show a conservative
`DEMO_BLOCKED` report.

From the repository root, after `pnpm build`:

```bash
node packages/cli/dist/index.js verify examples/demo-blocked --config examples/demo-blocked/agentforge.config.json --claims examples/demo-blocked/CLAIMS.md --format json --exit-zero
```

The command renders a report to stdout. It does not create a report file.

Use this fixture when you want to confirm that missing demo-critical evidence
stays blocked instead of being treated as safe to continue.

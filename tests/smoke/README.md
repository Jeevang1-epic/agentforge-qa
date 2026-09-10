# Smoke Tests

`pnpm smoke` invokes the already-built CLI entry point with `--help`,
`--version`, `verify --help`, and a dry-run `verify --format json --exit-zero`
run. Run `pnpm build` first.

The smoke command exercises local/npx-style invocation through
`packages/cli/dist/index.js`; it does not publish packages or write report files.

For example-oriented checks after a build, run:

```bash
node packages/cli/dist/index.js verify examples/node-basic --format markdown --exit-zero
node packages/cli/dist/index.js verify examples/node-basic --format json --exit-zero
```

Use `docs/demo.md` for the commands that include the example config and claim
file.

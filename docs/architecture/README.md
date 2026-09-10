# Architecture Notes

AgentForge QA v0.1 is organized around this package flow:

```text
CLI adapter -> Core evidence pipeline -> Schemas
                    |
                    +-> Reporters
```

The monorepo foundation, shared schema contracts, safe command runner, and first
core evidence pipeline are implemented. Core loads JSON configuration, detects
the repository, collects read-only Git evidence, checks artifacts, matches
deterministic claims, assesses risk, and returns a schema-valid
`VerificationReport`. Configured commands default to dry-run mode and execute
only when the caller explicitly passes `dryRun: false`.

Reporters render schema-valid `VerificationReport` objects to Markdown or JSON
strings. They are pure renderers: they do not write files, read logs, execute
commands, or change verdicts.

The verdict engine is conservative: missing, skipped, unsafe, incomplete, or
blocking evidence cannot produce `SAFE_TO_CONTINUE`.

The CLI exposes help, version, and `verify [repo]`. The `verify` command maps
terminal options into the existing core request contract, defaults to dry-run
command evidence, renders Markdown or JSON to stdout through reporters, and uses
stderr for usage or operational messages. Filesystem report writing, `init`,
full `doctor`, `report`, and auto-fix behavior are not implemented. Request
fields `outputDir` and `strict` are reserved contracts and do not change core
behavior yet.

# Architecture Notes

AgentForge QA is organized around this package flow:

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

## Changed-Work Scanning

The 0.3.0 development pipeline runs the failure suppression scanner immediately
after Git collection and before risk assessment. Core's internal scanner result
contains completion status, normalized signals, file counts, and a summary.
It is not a new public report field. Separate risk policy maps signals into
`risky_file_change` findings linked to the Git evidence ID, or a blocking
`partial_verification` warning if collection/analysis is incomplete.

The collector reuses the Git status file set. Eligible tracked files use raw
baseline blobs obtained with literal `ls-tree` paths and `cat-file blob`, then
a bounded in-memory Myers line comparison against the working source. This
avoids Git clean filters, textconv, and external diff helpers. Git status also
disables configured clean/smudge/process filters using strictly constrained
empty-command overrides; incomplete filter metadata fails closed.
Deletion anchors also count as changed work, so removing logging from a handler
cannot conceal the resulting empty body. Untracked files use their complete
bounded content. Repositories without a resolvable HEAD scan new source but
report incomplete baseline evidence. Deleted files have no working-tree handler
to inspect. Generated and unsupported files are counted as skipped.

A bounded lexer separates comments, opaque strings/regular expressions, tokens,
and paired delimiters. JS/TS rules recognize catch blocks and direct promise
callbacks. Python rules recognize indentation-delimited except bodies.
The initial rules deliberately focus on direct empty/pass bodies and direct
default or success returns; this is not full language parsing or dataflow.
Template interpolation and complex handler syntax are outside coverage.
Rules have stable IDs: AFQ-FS001 (empty handler), AFQ-FS002 (default return),
AFQ-FS003 (success return), AFQ-FS004 (swallowed promise failure), and AFQ-FS005
(changed comment or commit language).

Only changed comments in the same computed change hunk strengthen a structural signal.
Commit messages are informational because they cannot reliably be attributed
to a specific surviving handler. All structural findings, including default
returns, use warning severity and require `NEEDS_REVIEW`; correlated language
adds context but is not required. Language-only findings use info severity and
score zero. Scanner evidence does not change the schema version 0.1.0.

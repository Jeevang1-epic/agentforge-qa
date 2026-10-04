# AgentForge QA

[![npm version](https://img.shields.io/npm/v/agentforge-qa.svg)](https://www.npmjs.com/package/agentforge-qa)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

Local-first evidence verification for AI coding-agent work.

AgentForge QA checks claims against configured commands, required artifacts, Git
state, and other deterministic local evidence before a developer accepts or
pushes coding-agent changes. It reports what was observed and uses conservative
verdicts; it does not prove that software is bug-free.

## Install

Requirements:

- Node.js `^20.19.0` or `>=22.12.0`

Run the published CLI without adding it to a project:

```bash
npx agentforge-qa --help
```

Install it as a development dependency:

```bash
npm install --save-dev agentforge-qa
```

The current public release is `agentforge-qa@0.3.0`.

Try the published CLI:

```bash
npx --yes agentforge-qa@0.3.0 --version
npx --yes agentforge-qa@0.3.0 verify . --summary-only --exit-zero
```

The verify command reports evidence for the current directory; `--exit-zero`
changes only the process exit code, not the report verdict.

## Failure Suppression Scanner

The `0.3.0` CLI automatically checks changed work for possible silent
failure handling. It examines changed handlers in JavaScript, TypeScript, JSX,
TSX, and Python, plus eligible untracked source files. With `--since <ref>`,
it compares the working tree against that safe reference and checks commit
messages between the reference and HEAD. Without it, tracked changes are
compared with HEAD. Existing unchanged handlers are not scanned for findings.

Deterministic local rules detect empty handlers, swallowed promise errors,
failure-to-default returns, and successful-looking returns after errors.
Changed comments in the same diff hunk can strengthen a structural finding.
Comment or commit language alone is informational and adds no risk score.
Source string literals and identifiers are not language evidence.

Structural failure-suppression findings, including default fallbacks in changed
error paths, require review. Correlated suppression language increases
confidence and context. Language-only findings remain informational and
non-blocking. These findings alone produce at most `NEEDS_REVIEW`; they do not
prove a bug. Independent failed checks or missing artifacts retain their
existing stronger verdicts.

The scanner uses no LLM, API, network access, or execution of scanned code.
It does not modify source files or change Git refs, the index, commits, or
working-tree source. Scanner source and commit-message captures are kept in
memory and are not persisted. Normal Git evidence collection may write
operational logs beneath `.agentforge/logs/git`; verification is not wholly
filesystem-write-free.
It is a bounded heuristic, not a full parser or SAST/security review. False
positives and missed patterns are possible. A finding is evidence for human
review, not proof of a vulnerability or malicious intent. Unsupported languages,
complex callbacks, template interpolation, and indirect control/data flow are
outside structural coverage. Generated trees are excluded; input limits or
unreadable eligible source prevent a safe verdict. Reports contain normalized
rule IDs and locations, without source snippets or complete commit messages.

## Why AgentForge QA

Coding agents can report that work is complete when tests were not run, required
files are missing, repository changes are unreviewed, claims do not match local
evidence, or a required command failed. AgentForge QA turns those conditions
into inspectable evidence and a conservative decision.

## What It Verifies

- **Commands:** Plans configured commands, skips them by default, and can run
  approved command-plus-args configurations when `--run` is provided.
- **Artifacts:** Checks required files, directories, or globs, including
  optional claim keywords and demo-critical artifacts.
- **Claims:** Parses deterministic claims from Markdown or text and links them
  to matching command and artifact evidence.
- **Git evidence:** Reports repository state, changed files, untracked files,
  deleted files, and dependency-file changes.
- **Risks and verdicts:** Scores findings and produces a structured decision
  summary plus a final verdict.

## Decision Summary

The concise Markdown summary appears before the detailed report. A successful
local run currently renders this shape:

```text
## Decision Summary

Verdict: SAFE_TO_CONTINUE
Commands: 1/1 passed
Artifacts: 2/2 found
Claims: 2 verified, 0 contradicted, 0 needs review
Blocking risks: 0
Warning risks: 0
Risk score: 0 - low
Tool errors: 0

Next action: Safe to continue.
```

Use `--summary-only` to print just the report heading and decision summary in
Markdown. With JSON output, it prints `schemaVersion` and the structured
`summary` object. Full JSON reports also include the typed `decisionSummary`
field alongside the complete evidence fields.

## Quick Start

Create a JSON configuration and a Markdown claims file in the repository you
want to verify. Then review the configuration and use dry-run mode first:

```bash
npx agentforge-qa verify . --config ./agentforge.config.json --claims ./CLAIMS.md --summary-only
```

Run configured commands only after reviewing them:

```bash
npx agentforge-qa verify . --config ./agentforge.config.json --claims ./CLAIMS.md --run --summary-only
```

For POSIX shells, the same command can be split across lines:

```bash
npx agentforge-qa verify . \
  --config ./agentforge.config.json \
  --claims ./CLAIMS.md \
  --run \
  --summary-only
```

Use full Markdown or JSON when you need the underlying evidence tables:

```bash
npx agentforge-qa verify . --config ./agentforge.config.json --claims ./CLAIMS.md --run --format markdown
npx agentforge-qa verify . --config ./agentforge.config.json --claims ./CLAIMS.md --run --format json
```

`--run` is never implied by the default dry-run mode.

### Local Repository Demo

After building the repository, run the committed passing fixture with the built
CLI:

```bash
node packages/cli/dist/index.js verify examples/node-basic --config examples/node-basic/agentforge.config.json --claims examples/node-basic/CLAIMS.md --run --summary-only
```

### Minimal Configuration

This is a small valid configuration. Create the referenced `result.txt` file
and use a claim containing the configured keywords.

```json
{
  "schemaVersion": "0.1.0",
  "commands": [
    {
      "id": "node-runtime",
      "label": "Check the Node runtime",
      "command": "node",
      "args": ["--version"],
      "required": true,
      "timeoutMs": 10000,
      "claimKeywords": ["node runtime"]
    }
  ],
  "artifacts": [
    {
      "id": "result",
      "label": "Verification result",
      "path": "result.txt",
      "type": "file",
      "required": true,
      "claimKeywords": ["result artifact"]
    }
  ]
}
```

`schemaVersion` describes the report and configuration contract and currently
remains `0.1.0`; it is independent of the package release version.

### Claims

The deterministic claim parser accepts Markdown or text claims. A simple file
can look like this:

```markdown
# Verification Claims

- The Node runtime is available and the result artifact exists.
```

## Verdicts

| Verdict | Meaning |
| --- | --- |
| `SAFE_TO_CONTINUE` | Required evidence passed and no blocking risk remains. |
| `NEEDS_REVIEW` | Evidence is incomplete, skipped, ambiguous, or requires human review. |
| `UNSAFE_TO_PUSH` | A blocking verification condition was found. |
| `DEMO_BLOCKED` | A required demo-critical artifact is missing. |

`SAFE_TO_CONTINUE` is an evidence result, not an absolute guarantee of
correctness or security.

## Safety Model

- Verification is dry-run by default.
- Configured commands are skipped unless `--run` is provided.
- Repository state and evidence are read locally.
- Execution uses the existing command-plus-args runner with `shell: false`,
  repository-contained working directories, timeouts, bounded output, and
  secret-redacted logs.
- AgentForge QA does not automatically edit source code, commit changes, or
  push changes.
- Report-file writing is not implemented; reports are emitted to stdout and
  operational details go to stderr.

The command runner is a policy boundary, not a sandbox. Configured Node
commands and package scripts can execute repository-controlled code when a
caller opts in with `--run`, so review configuration before verifying an
untrusted repository.

## Output Formats

Use Markdown for a human-readable report:

```bash
npx agentforge-qa verify . --config ./agentforge.config.json --claims ./CLAIMS.md --run --format markdown
```

Use JSON for tooling and integrations:

```bash
npx agentforge-qa verify . --config ./agentforge.config.json --claims ./CLAIMS.md --run --format json
```

Use summary-only output for a compact decision:

```bash
npx agentforge-qa verify . --config ./agentforge.config.json --claims ./CLAIMS.md --run --summary-only
```

## CLI Reference

```text
agentforge-qa --help
agentforge-qa --version
agentforge-qa verify [repo] [options]
```

`verify` supports:

| Option | Purpose |
| --- | --- |
| `--config <path>` | Load a JSON configuration file. |
| `--claims <path>` | Load a Markdown or text claims file. |
| `--since <ref>` | Use a Git base or ref for changed-file evidence. |
| `--format <markdown\|json>` | Select stdout report format. |
| `--run` | Execute configured commands. |
| `--dry-run` | Keep configured commands skipped. |
| `--exit-zero` | Return exit code 0 after producing a report. |
| `--summary-only` | Print only the decision summary. |
| `--verbose` | Print operational details to stderr. |
| `--help`, `-h` | Show help. |

At the top level, `agentforge-qa --version` and `agentforge-qa -v` print the
CLI version.

## How Evidence Becomes a Verdict

```text
Configuration
  -> Commands and artifacts
  -> Claims and Git evidence
  -> Risks
  -> Decision summary
  -> Final verdict
```

## Packages

Most users should start with the CLI package, `agentforge-qa`.

| Package | Role |
| --- | --- |
| `@agentforge-qa/schemas` | Shared Zod contracts, enums, validators, and TypeScript types. |
| `@agentforge-qa/core` | Verification orchestration, evidence checks, risk scoring, and verdicts. |
| `@agentforge-qa/reporters` | Pure Markdown and JSON report rendering. |
| `agentforge-qa` | Thin terminal adapter and executable CLI. |

## Example Report

<details>
<summary>Compact successful report excerpt</summary>

```text
## Decision Summary

Verdict: SAFE_TO_CONTINUE
Commands: 1/1 passed
Artifacts: 2/2 found
Claims: 2 verified, 0 contradicted, 0 needs review
Blocking risks: 0
Warning risks: 0
Risk score: 0 - low
Tool errors: 0

Next action: Safe to continue.
```

A full Markdown report continues with metadata, repository and Git evidence,
command results, artifact results, claims, claim verdicts, risks, errors, and
limitations. Full JSON retains the same validated data as structured fields.

</details>

## Reliability and Validation

The repository includes deterministic unit, integration, end-to-end,
package-boundary, package-readiness, and external-consumer validation. The
`0.3.0` package set passed local npm pack dry-runs as part of release validation.

## Current Scope and Limitations

AgentForge QA is local-first, CLI-based, evidence-oriented, and conservative by
design. It currently has no:

- Cloud dashboard or hosted service
- GitHub Action
- Editor extension
- MCP server
- Automatic code repair
- Report-file writing

Verified evidence is not a guarantee that code is bug-free, secure in every
environment, or suitable for production without human review.

## Repository Links

- [npm package](https://www.npmjs.com/package/agentforge-qa)
- [GitHub repository](https://github.com/Jeevang1-epic/agentforge-qa)
- [Changelog](./CHANGELOG.md)
- [Security policy](./SECURITY.md)
- [Contributing guide](./CONTRIBUTING.md)
- [License](./LICENSE)
- [Issues](https://github.com/Jeevang1-epic/agentforge-qa/issues)

## Contributing and Security

See [`CONTRIBUTING.md`](./CONTRIBUTING.md) for local setup, validation, and
package-boundary guidance. See [`SECURITY.md`](./SECURITY.md) for the reporting
process and the local-first security model.

## Licensing and Brand

AgentForge QA software is released under the [MIT License](./LICENSE).

Copyright © 2026 P. Jeevan Kumar.

The AgentForge QA project name, logo, and visual brand are not licensed for use
in ways that falsely imply affiliation, sponsorship, endorsement, or origin.
See the [brand notice](./BRAND.md) for the concise project guidance.

AgentForge QA turns coding-agent claims into evidence a developer can inspect.

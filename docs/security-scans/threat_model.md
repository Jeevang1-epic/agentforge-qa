# AgentForge QA Repository Threat Model

## Overview

AgentForge QA is a local-first TypeScript CLI and library workspace
for collecting evidence about AI coding-agent work before a developer trusts,
pushes, demos, or ships it. The implemented runtime surface is primarily
`@agentforge-qa/core`, which accepts a verification request, loads JSON
configuration, detects a repository, collects read-only Git evidence, runs
explicitly configured validation commands through a constrained command runner,
checks artifacts, parses deterministic claims, assesses risks, and returns a
schema-valid verification report. The CLI package exposes help, version, and a
`verify` command that calls core and renders reports to stdout. Reporters render
schema-valid reports to Markdown and JSON strings without reading files, writing
files, executing commands, or changing verdicts.

The most important assets are the developer's repository contents, filesystem,
credentials and environment, local Git state, command logs, and the integrity of
the final verification verdict. A false `SAFE_TO_CONTINUE` verdict, execution of
untrusted claim text, repository escape, secret disclosure, or mutating Git
operation would be security-significant.

## Threat Model, Trust Boundaries, and Assumptions

### Actors and trust boundaries

- **Developer/operator:** Chooses the working directory, verification request,
  JSON config, claim file, and whether configured commands may run. The operator
  is trusted to intentionally invoke AgentForge QA, but may run it against an
  untrusted or AI-generated repository.
- **Repository and AI-generated content:** Repository files, package scripts,
  config values, claim text, filenames, symlinks, Git metadata, and command
  output are untrusted inputs. A repository may be malicious and attempt command
  injection, path escape, log injection, resource exhaustion, or false evidence.
- **AgentForge QA runtime:** Must preserve command policy, path containment,
  read-only Git behavior, secret redaction, bounded processing, schema validity,
  and conservative verdict gates.
- **Operating system and tools:** Node.js, Git, package managers, and the local
  filesystem are external trust boundaries. Their output may be malformed,
  truncated, platform-specific, or influenced by repository-controlled data.
- **Report consumer:** A developer or future adapter may act on the report. The
  report must not overstate incomplete, unsafe, skipped, or failed evidence.

### Attacker-controlled inputs

- Repository filenames, directory structure, symlinks, `.git` markers, Git
  status/diff output, and tracked or untracked content.
- JSON configuration fields, command names/arguments, artifact paths/globs, and
  claim keywords.
- Plain-text or Markdown claim files.
- Repository-controlled package scripts invoked by an explicitly configured
  allowed validation command.
- Process stdout/stderr, including secret-like or control-like text.

### Operator-controlled inputs

- Verification `cwd`, optional config path, claim-file path, Git reference,
  dry-run choice, and configured commands/artifacts.
- Local environment variables and installed toolchain.

### Required invariants

- Claim text never becomes executable input.
- Commands use an allowlisted executable plus separate args, with `shell: false`,
  bounded timeout/output, and repository-contained cwd/log paths.
- Product runtime Git operations remain read-only.
- User/config paths and real paths remain inside the detected repository root;
  symlink escapes fail closed where practical.
- JSON is the only executable-free config format.
- Logs redact recognized secrets while machine-readable evidence parsing uses
  bounded in-memory output.
- Missing, malformed, skipped, unsafe, incomplete, or tool-error evidence cannot
  produce `SAFE_TO_CONTINUE`.
- All returned reports validate through `@agentforge-qa/schemas`.

## Attack Surface, Mitigations, and Attacker Stories

### Command execution

The safe command runner in `packages/core/src/commands/` is the highest-impact
runtime surface. Relevant attacks include shell-operator injection, executable
path substitution, dangerous package-manager or Git subcommands, cwd escape,
timeout bypass, output exhaustion, and secret leakage. Existing controls include
command/args separation, an explicit policy, `shell: false`, timeout ceilings,
bounded capture, repository-contained cwd/log resolution, and redacted logs.
Repository-controlled package scripts remain an intentional residual risk:
running an approved package script executes repository code only when the
operator/config explicitly requests it.

### Filesystem, config, claims, and artifacts

Config, claim, artifact, glob, and log paths cross from untrusted repository data
into filesystem operations. Relevant attacks include traversal, outside absolute
paths, Windows drive-prefix escapes, control characters, symlink escapes,
unbounded files/trees, and race conditions. Existing controls include lexical
containment, `realpath` checks, existing-ancestor checks, file-size limits,
bounded deterministic glob traversal, ignored generated directories, and
fail-closed error handling. Local filesystem time-of-check/time-of-use races
cannot be completely eliminated in v0.1.

### Git evidence

Git metadata and filenames are untrusted. Relevant attacks include confusing
quoted-path parsing, worktree root mismatch, malicious filenames, invalid refs,
mutating Git commands, and AgentForge-generated logs polluting evidence.
Existing controls include an exact read-only Git allowlist, worktree/top-level
confirmation, NUL-delimited porcelain/name-status parsing, bounded output, safe
reference validation, malformed-output rejection, and filtering of AgentForge's
own logs.

### Claims, risk, and verdict integrity

Deterministic text matching can produce false associations if boundaries are
weak. A malicious or overconfident claim may attempt to receive a verified
status without complete evidence. Existing controls include token-aware matching,
evidence IDs, contradiction/incomplete states, risk findings, schema validation,
and conservative final-verdict gates. AgentForge QA does not provide LLM or
semantic claim understanding; deterministic matching remains a documented
limitation.

### Lower-relevance or out-of-scope classes

There is no server, authentication system, browser UI, database, multi-tenant
boundary, hosted API, or network client in the current product runtime. Web
classes such as CSRF, XSS, SSRF, tenant isolation, and session fixation are
therefore not applicable unless future features introduce those surfaces.

### Failure suppression scanner (0.3.0 development)

Source contents, changed filenames, diff hunks, and commit messages are
attacker-controlled. The scanner never imports, evaluates, executes, or sends
them to a service. It reuses the reviewed command runner with shell disabled,
fsmonitor disabled, optional locks disabled, and capture-only operation:
scanner baseline source and message bodies are not written to command logs.
Source comparisons use raw blobs and an in-memory line diff. No working-tree
diff is invoked. Git status first reads bounded filter-key metadata and
disables each configured clean/smudge/process driver with empty-command
overrides and required=false. At most 100 simply named filter drivers are
accepted; unknown/malformed metadata fails closed. Committed-tree name-status
diffs explicitly disable external diff and textconv. Git log
uses a fixed format, no signature verification, and a fixed message-count cap.
Only exact metadata/tree/blob/log forms and validated references pass command
policy; tree paths use literal pathspecs after the option separator. Git
processes disable lazy fetching and interactive credential requests.

Limits are 200 eligible files, 256 KiB per file, 2 MiB aggregate source,
5,000,000 bytes aggregate Git source/message capture, 100 commit messages (one
extra is requested to detect overflow), 60,000 tokens per file, 128 delimiter levels,
and 500 findings. Line comparison has a 250,000-step budget; source-byte
limits include baseline and working content. Individual Git commands retain a
10-second timeout and a 5,000,000-byte capture ceiling. Source reads use a fixed maximum buffer after
canonical repository containment and regular-file checks. Binary/NUL, invalid
UTF-8, excessive sizes, unreadable paths, malformed lexical input, truncated
Git output, and limit exhaustion produce blocking partial-verification warnings.
Redirected source paths, including in-repository symlinks, are conservatively
skipped because their diff line locations may refer to different content.
Known generated directories, declaration/minified/generated filenames, and
files explicitly marked @generated in an initial comment are excluded.

Locations are normalized and redacted before risk rendering; source snippets
and raw commit messages are omitted. Reporters retain Markdown escaping.
No new public report fields or risk categories are introduced.

Residual risks include concurrent filesystem changes between path validation
and open, source snapshots changing during Git comparison, disguised generated
content, incomplete language syntax coverage, and heuristic false positives/
negatives. This scanner adds review evidence; it cannot establish developer
intent, prove correctness, or replace comprehensive security analysis.

## Severity Calibration (Critical, High, Medium, Low)

- **Critical:** A default/reachable path from untrusted claim/config/repository
  content to arbitrary shell execution, destructive command execution, or
  mutation/push of the developer's repository without explicit operator intent.
  A broadly reachable secret exfiltration path would also be critical.
- **High:** Repository or symlink escape enabling read/write outside the repo;
  bypass of the command/Git allowlist; or a reproducible false
  `SAFE_TO_CONTINUE` verdict when required evidence is missing, failed, unsafe,
  or incomplete.
- **Medium:** Controlled denial of service through insufficiently bounded local
  input, secret exposure limited to local logs, incorrect Git/artifact evidence
  that conservatively results in `NEEDS_REVIEW`, or a package-boundary violation
  that creates a plausible future security bypass.
- **Low:** Stale documentation, misleading placeholder wording, minor dead code,
  or test weaknesses without a current security-impacting behavior. Findings
  that require a trusted developer to deliberately replace runtime code or
  disable controls are generally low or not applicable.

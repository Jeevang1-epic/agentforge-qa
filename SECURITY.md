# Security Policy

AgentForge QA is an early local-first CLI. It is not a sandbox, hosted security
service, or production guarantee.

## Supported Scope

Security reports for the current `main` branch are welcome when they affect:

- command execution boundaries,
- repository path containment,
- secret redaction,
- report output safety,
- package or dependency integrity.

## Reporting a Vulnerability

Please open a private security advisory or contact the repository owner through
GitHub if private reporting is unavailable. Do not include real secrets,
credentials, customer data, or exploit payloads that are not necessary to
explain the issue.

Useful reports include:

- affected package or command,
- reproduction steps,
- expected and actual behavior,
- impact and any suggested mitigation.

## Local-First Security Model

The CLI reads local repository state and can optionally run configured commands
only when `--run` is passed. Review configuration before running verification on
an untrusted repository. Report-file writing, hosted services, and production
deployment features are not implemented in v0.1.

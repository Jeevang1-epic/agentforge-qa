# @agentforge-qa/reporters

Pure report renderers for AgentForge QA verification reports.

The package validates unknown input with `VerificationReportSchema` and renders
schema-valid reports as:

- deterministic pretty JSON strings,
- readable Markdown strings.

Reporters do not execute commands, read logs, write files, inspect Git, call the
CLI, call the core pipeline, mutate reports, or change verdicts.

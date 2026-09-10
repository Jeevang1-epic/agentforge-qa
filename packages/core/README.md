# @agentforge-qa/core

Core verification orchestration for AgentForge QA.

The package loads configuration, collects deterministic repository evidence,
matches claims to configured commands and artifacts, assesses risks, calculates
the canonical decision summary, and determines the final verdict.

Command execution remains explicit, uses command-plus-args with `shell: false`,
and is skipped by default unless the caller opts in.

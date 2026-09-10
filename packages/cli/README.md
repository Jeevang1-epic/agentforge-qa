# agentforge-qa

Local-first CLI for verifying AI coding-agent work against deterministic local
evidence.

```bash
npx agentforge-qa verify . --summary-only
```

Verification is dry-run by default. Use `--run` only after reviewing the
repository configuration. Reports are emitted to stdout as Markdown or JSON;
operational details remain on stderr.

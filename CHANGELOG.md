# Changelog

## 0.2.0 - Unreleased

- Added one canonical decision summary shared by Markdown, JSON, and future
  integrations.
- Placed the Markdown Decision Summary before the complete detailed evidence
  report.
- Added `--summary-only` for compact Markdown and minimal structured JSON.
- Added the typed `decisionSummary` field to complete JSON reports while
  preserving existing report fields.
- Accepted JSON configuration files with one leading UTF-8 BOM while retaining
  strict malformed-JSON errors.
- Added explicit command `claimKeywords` for deterministic command-to-claim
  evidence links.
- Made failed directly linked required commands contradict related claims.
- Kept claims incomplete when directly linked required commands are skipped.
- Made missing required non-demo artifacts produce `UNSAFE_TO_PUSH`.
- Updated audited development dependencies and narrow security overrides.

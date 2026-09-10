const assignmentSecretPattern =
  /\b([A-Z0-9_]*(?:TOKEN|API_KEY|SECRET|PASSWORD|PASS|PRIVATE_KEY|ACCESS_KEY)[A-Z0-9_]*)=(?:"[^"]*"|'[^']*'|[^\s"'`]+)/gi;
const githubTokenPattern = /\bghp_[A-Za-z0-9_]+\b/g;
const githubFineGrainedTokenPattern = /\bgithub_pat_[A-Za-z0-9_]+\b/g;
const apiKeyPattern = /\bsk-[A-Za-z0-9_-]+\b/g;
const bearerTokenPattern = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;

export function redactCommandText(value: string): string {
  return value
    .replace(
      assignmentSecretPattern,
      (_match, key: string) => `${key}=[REDACTED]`,
    )
    .replace(githubTokenPattern, "[REDACTED_GITHUB_TOKEN]")
    .replace(githubFineGrainedTokenPattern, "[REDACTED_GITHUB_TOKEN]")
    .replace(apiKeyPattern, "[REDACTED_API_KEY]")
    .replace(bearerTokenPattern, "Bearer [REDACTED]");
}

export const DEFAULT_MAX_COMMAND_TIMEOUT_MS = 300_000;
export const DEFAULT_KILL_GRACE_MS = 1_000;
export const MAX_KILL_GRACE_MS = 5_000;

export interface CommandTimeoutReview {
  approved: boolean;
  code: string;
  reason: string;
  timeoutMs?: number;
}

export function reviewCommandTimeout(
  timeoutMs: number,
  maxTimeoutMs = DEFAULT_MAX_COMMAND_TIMEOUT_MS,
): CommandTimeoutReview {
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    return {
      approved: false,
      code: "INVALID_TIMEOUT",
      reason: "Command timeout must be a positive integer.",
    };
  }

  if (!Number.isInteger(maxTimeoutMs) || maxTimeoutMs <= 0) {
    return {
      approved: false,
      code: "INVALID_MAX_TIMEOUT",
      reason: "Maximum command timeout must be a positive integer.",
    };
  }

  const effectiveMaxTimeoutMs = Math.min(
    maxTimeoutMs,
    DEFAULT_MAX_COMMAND_TIMEOUT_MS,
  );

  if (timeoutMs > effectiveMaxTimeoutMs) {
    return {
      approved: false,
      code: "TIMEOUT_EXCEEDS_LIMIT",
      reason: `Command timeout must not exceed ${effectiveMaxTimeoutMs}ms.`,
    };
  }

  return {
    approved: true,
    code: "APPROVED",
    reason: "Command timeout is within the configured limit.",
    timeoutMs,
  };
}

export function resolveKillGraceMs(killGraceMs?: number): number {
  if (!Number.isInteger(killGraceMs) || (killGraceMs ?? -1) < 0) {
    return DEFAULT_KILL_GRACE_MS;
  }

  return Math.min(killGraceMs ?? DEFAULT_KILL_GRACE_MS, MAX_KILL_GRACE_MS);
}

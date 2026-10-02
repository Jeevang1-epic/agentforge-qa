export interface ChangedRange {
  start: number;
  end: number;
}

export type RuleId = "AFQ-FS001" | "AFQ-FS002" | "AFQ-FS003" | "AFQ-FS004" | "AFQ-FS005";

export interface Signal {
  ruleId: RuleId;
  path: string;
  line: number;
  correlated: boolean;
  validationContext: boolean;
}

export interface ScanResult {
  status: "complete" | "partial" | "unavailable";
  signals: Signal[];
  filesScanned: number;
  filesSkipped: number;
  summary: string;
}

export const LIMITS = {
  files: 200,
  fileBytes: 256 * 1024,
  sourceBytes: 2 * 1024 * 1024,
  diffBytes: 5_000_000,
  messages: 100,
  signals: 500,
  tokens: 60_000,
  nesting: 128,
  diffSteps: 250_000,
} as const;

export function suppressionLanguage(text: string): boolean {
  return /\b(?:silent(?:ly)?|swallow(?:ed|ing)?|suppress(?:ed|ion|ing)?|fallback|fail[ -](?:soft|open)|degrad(?:e|ed|ation)|best[ -]effort|ignore (?:failure|error)s?|continue on error|rather than (?:failing|erroring)|gracefully ignore)\b/i.test(text);
}

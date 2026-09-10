import { lstat, readFile } from "node:fs/promises";
import { extname } from "node:path";

import { ClaimSchema, type Claim } from "@agentforge-qa/schemas";

import {
  resolveExistingAncestorInsideRepo,
  resolveExistingPathInsideRepo,
  toRepoRelativePath,
} from "../commands/command-paths.js";
import { createClaimEvidenceId } from "../evidence/evidence-ids.js";
import { EvidenceModuleError } from "../errors/pipeline-errors.js";

const MAX_CLAIM_FILE_BYTES = 1_000_000;
const MAX_CLAIMS = 500;
const supportedClaimExtensions = new Set([".md", ".markdown", ".txt"]);

export interface ParsedClaims {
  claims: Claim[];
  summary: string;
}

function normalizeClaimText(line: string): string {
  if (/^#{1,6}\s+/.test(line.trim())) {
    return "";
  }

  return line
    .trim()
    .replace(/^[-*+]\s+(?:\[[ xX]\]\s*)?/, "")
    .replace(/^\d+[.)]\s+/, "")
    .trim();
}

export async function parseClaims(
  repoRoot: string,
  claimFile?: string,
): Promise<ParsedClaims> {
  if (claimFile === undefined) {
    return {
      claims: [],
      summary: "No claim file was provided.",
    };
  }

  if (!supportedClaimExtensions.has(extname(claimFile).toLowerCase())) {
    throw new EvidenceModuleError(
      "UNSUPPORTED_CLAIM_FILE",
      "Claim files must be plain text or Markdown.",
    );
  }

  const ancestorReview = await resolveExistingAncestorInsideRepo(
    repoRoot,
    claimFile,
    "claim file",
  );

  if (!ancestorReview.approved) {
    throw new EvidenceModuleError(ancestorReview.code, ancestorReview.reason);
  }

  const pathReview = await resolveExistingPathInsideRepo(
    repoRoot,
    claimFile,
    "claim file",
  );

  if (!pathReview.approved || pathReview.path === undefined) {
    throw new EvidenceModuleError(pathReview.code, pathReview.reason);
  }

  const stats = await lstat(pathReview.path);

  if (!stats.isFile() || stats.size > MAX_CLAIM_FILE_BYTES) {
    throw new EvidenceModuleError(
      "INVALID_CLAIM_FILE",
      `Claim file must be a plain file no larger than ${MAX_CLAIM_FILE_BYTES} bytes.`,
    );
  }

  const content = await readFile(pathReview.path, "utf8");

  if (content.includes("\0")) {
    throw new EvidenceModuleError(
      "INVALID_CLAIM_FILE",
      "Claim file must contain plain text.",
    );
  }

  const source = toRepoRelativePath(repoRoot, pathReview.path);
  const claims: Claim[] = [];
  let inCodeFence = false;

  for (const [index, line] of content.split(/\r?\n/).entries()) {
    if (line.trim().startsWith("```")) {
      inCodeFence = !inCodeFence;
      continue;
    }

    const text = inCodeFence ? "" : normalizeClaimText(line);

    if (text.length === 0) {
      continue;
    }

    claims.push(
      ClaimSchema.parse({
        id: createClaimEvidenceId(String(claims.length + 1)),
        text,
        source,
        lineStart: index + 1,
        lineEnd: index + 1,
      }),
    );

    if (claims.length > MAX_CLAIMS) {
      throw new EvidenceModuleError(
        "CLAIM_LIMIT_EXCEEDED",
        `Claim file contains more than the ${MAX_CLAIMS} supported claims.`,
      );
    }
  }

  if (inCodeFence) {
    throw new EvidenceModuleError(
      "INVALID_CLAIM_FILE",
      "Claim file contains an unclosed Markdown code fence.",
    );
  }

  return {
    claims,
    summary: `Parsed ${claims.length} deterministic claims from ${source}.`,
  };
}

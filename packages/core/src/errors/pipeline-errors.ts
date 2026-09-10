import type { PipelineError } from "@agentforge-qa/schemas";

interface ValidationIssue {
  readonly message: string;
  readonly path: readonly PropertyKey[];
}

export class EvidenceModuleError extends Error {
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(
    code: string,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "EvidenceModuleError";
    this.code = code;

    if (details !== undefined) {
      this.details = details;
    }
  }
}

export function createInvalidRequestError(
  issues: readonly ValidationIssue[],
): PipelineError {
  return {
    id: "error:invalid-request",
    code: "INVALID_REQUEST",
    message: "The verification request is invalid.",
    details: {
      issues: issues.map((issue) => ({
        message: issue.message,
        path: issue.path.map(String).join("."),
      })),
    },
  };
}

export function createEvidencePipelineError(error: EvidenceModuleError): PipelineError {
  return {
    id: `error:${error.code.toLowerCase().replaceAll("_", "-")}`,
    code: error.code,
    message: error.message,
    ...(error.details === undefined ? {} : { details: error.details }),
  };
}

export function createInternalPipelineError(error: unknown): PipelineError {
  const causedBy = error instanceof Error ? error.message : String(error);

  return {
    id: "error:core-pipeline",
    code: "CORE_PIPELINE_ERROR",
    message: "The core verification pipeline could not complete.",
    causedBy,
  };
}

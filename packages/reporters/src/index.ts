import {
  VerificationReportSchema,
  type ArtifactResult,
  type Claim,
  type ClaimVerdict,
  type CommandResult,
  type DecisionSummary,
  type PipelineError,
  type RiskFinding,
  type VerificationReport,
} from "@agentforge-qa/schemas";

export type ReportFormat = "json" | "markdown";

export interface RenderReportOptions {
  readonly format: ReportFormat;
  readonly summaryOnly?: boolean;
}

function validateReport(report: unknown): VerificationReport {
  return VerificationReportSchema.parse(report);
}

function renderJsonFromValidatedReport(report: VerificationReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

function renderSummaryJsonFromValidatedReport(report: VerificationReport): string {
  return `${JSON.stringify({
    schemaVersion: report.schemaVersion,
    summary: report.decisionSummary,
  }, null, 2)}\n`;
}

function escapeInlineText(value: unknown): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\|/g, "\\|")
    .replace(/`/g, "\\`")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function normalizeTextLines(value: unknown): readonly string[] {
  return String(value)
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t\f\v]+/g, " ").trim());
}

function escapeParagraph(value: unknown): string {
  const text = normalizeTextLines(value)
    .filter((line) => line.length > 0)
    .join(" ");

  return text.length > 0 ? escapeInlineText(text) : "Not provided";
}

function escapeTableCell(value: unknown): string {
  const lines = normalizeTextLines(value);
  const rendered = lines
    .map((line) => escapeInlineText(line))
    .join(" <br> ")
    .trim();

  return rendered.length > 0 ? rendered : "-";
}

function formatOptional(value: unknown): string {
  return value === undefined || value === null || value === ""
    ? "Not provided"
    : String(value);
}

function formatList(values: readonly string[] | undefined): string {
  return values !== undefined && values.length > 0
    ? values.join(", ")
    : "None";
}

function renderTable(
  headers: readonly string[],
  rows: readonly (readonly unknown[])[],
): string {
  return [
    `| ${headers.map(escapeTableCell).join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map(escapeTableCell).join(" | ")} |`),
  ].join("\n");
}

function renderFieldTable(rows: readonly (readonly [string, unknown])[]): string {
  return renderTable(
    ["Field", "Value"],
    rows.map(([field, value]) => [field, value]),
  );
}

function renderCommands(commands: readonly CommandResult[]): string {
  if (commands.length === 0) {
    return "No command results.";
  }

  return renderTable(
    ["ID", "Plan", "Status", "Exit Code", "Duration", "Logs", "Reason"],
    commands.map((command) => [
      command.id,
      command.planId,
      command.status,
      formatOptional(command.exitCode),
      command.durationMs === undefined
        ? "Not provided"
        : `${command.durationMs}ms`,
      [
        command.stdoutLogPath === undefined
          ? undefined
          : `stdout: ${command.stdoutLogPath}`,
        command.stderrLogPath === undefined
          ? undefined
          : `stderr: ${command.stderrLogPath}`,
      ]
        .filter((value): value is string => value !== undefined)
        .join("; ") || "None",
      formatOptional(command.reason),
    ]),
  );
}

function renderArtifacts(artifacts: readonly ArtifactResult[]): string {
  if (artifacts.length === 0) {
    return "No artifact results.";
  }

  return renderTable(
    [
      "ID",
      "Label",
      "Path",
      "Type",
      "Required",
      "Demo Critical",
      "Status",
      "Matches",
      "Size",
      "Reason",
    ],
    artifacts.map((artifact) => [
      artifact.id,
      artifact.label,
      artifact.path,
      artifact.type,
      artifact.required ? "yes" : "no",
      artifact.demoCritical === undefined
        ? "Not provided"
        : artifact.demoCritical
          ? "yes"
          : "no",
      artifact.status,
      formatList(artifact.matchedPaths),
      artifact.sizeBytes === undefined
        ? "Not provided"
        : `${artifact.sizeBytes} bytes`,
      formatOptional(artifact.reason),
    ]),
  );
}

function renderClaims(
  claims: readonly Claim[],
  claimVerdicts: readonly ClaimVerdict[],
): string {
  const sections: string[] = [];

  if (claims.length === 0) {
    sections.push("No claims.");
  } else {
    sections.push(
      renderTable(
        ["ID", "Source", "Lines", "Category", "Text"],
        claims.map((claim) => [
          claim.id,
          claim.source,
          claim.lineStart === undefined
            ? "Not provided"
            : claim.lineEnd === undefined
              ? String(claim.lineStart)
              : `${claim.lineStart}-${claim.lineEnd}`,
          formatOptional(claim.category),
          claim.text,
        ]),
      ),
    );
  }

  if (claimVerdicts.length === 0) {
    sections.push("No claim verdicts.");
  } else {
    sections.push(
      renderTable(
        [
          "ID",
          "Claim",
          "Status",
          "Matched Evidence",
          "Missing Evidence",
          "Impact",
          "Next Action",
        ],
        claimVerdicts.map((claimVerdict) => [
          claimVerdict.id,
          claimVerdict.claimId,
          claimVerdict.status,
          formatList(claimVerdict.matchedEvidenceIds),
          formatList(claimVerdict.missingEvidence),
          formatOptional(claimVerdict.impact),
          formatOptional(claimVerdict.nextAction),
        ]),
      ),
    );
  }

  return sections.join("\n\n");
}

function renderRisks(risks: readonly RiskFinding[]): string {
  if (risks.length === 0) {
    return "No risks found.";
  }

  return renderTable(
    [
      "ID",
      "Category",
      "Severity",
      "Title",
      "Blocks Verdict",
      "Evidence",
      "Next Action",
    ],
    risks.map((risk) => [
      risk.id,
      risk.category,
      risk.severity,
      risk.title,
      risk.blocksVerdict === undefined
        ? "Not provided"
        : risk.blocksVerdict
          ? "yes"
          : "no",
      formatList(risk.evidenceIds),
      formatOptional(risk.nextAction),
    ]),
  );
}

function formatErrorDetails(error: PipelineError): string {
  return error.details === undefined
    ? "Not provided"
    : JSON.stringify(error.details);
}

function renderErrors(errors: readonly PipelineError[] | undefined): string {
  if (errors === undefined || errors.length === 0) {
    return "No tool errors.";
  }

  return renderTable(
    ["ID", "Code", "Message", "Caused By", "Details"],
    errors.map((error) => [
      error.id,
      error.code,
      error.message,
      formatOptional(error.causedBy),
      formatErrorDetails(error),
    ]),
  );
}

function formatCommandSummary(summary: DecisionSummary): string {
  const { commands } = summary;

  if (commands.total === 0) {
    return summary.toolErrors > 0 ? "not executed" : "none configured";
  }

  return [
    `${commands.passed}/${commands.total} passed`,
    ...(commands.failed === 0 ? [] : [`${commands.failed} failed`]),
    ...(commands.skipped === 0 ? [] : [`${commands.skipped} skipped`]),
  ].join(", ");
}

function formatArtifactSummary(summary: DecisionSummary): string {
  const { artifacts } = summary;

  if (artifacts.total === 0) {
    return summary.toolErrors > 0 ? "not collected" : "none configured";
  }

  return [
    `${artifacts.found}/${artifacts.total} found`,
    ...(artifacts.requiredMissing === 0
      ? []
      : [`${artifacts.requiredMissing} required missing`]),
  ].join(", ");
}

function formatClaimSummary(summary: DecisionSummary): string {
  const { claims } = summary;

  if (claims.total === 0 && summary.toolErrors > 0) {
    return "not evaluated";
  }

  return `${claims.verified} verified, ${claims.contradicted} contradicted, ${claims.reviewRequired} needs review`;
}

function renderDecisionSummary(summary: DecisionSummary): string {
  return [
    "## Decision Summary",
    "",
    `Verdict: ${summary.verdict}`,
    `Commands: ${formatCommandSummary(summary)}`,
    `Artifacts: ${formatArtifactSummary(summary)}`,
    `Claims: ${formatClaimSummary(summary)}`,
    `Blocking risks: ${summary.risks.blocking}`,
    `Warning risks: ${summary.risks.warnings}`,
    `Risk score: ${summary.risks.score} - ${summary.risks.severity}`,
    `Tool errors: ${summary.toolErrors}`,
    "",
    `Next action: ${escapeParagraph(summary.nextAction)}`,
  ].join("\n");
}

function renderMarkdownFromValidatedReport(
  report: VerificationReport,
  summaryOnly = false,
): string {
  const heading = "# AgentForge QA Verification Report";
  const decisionSummary = renderDecisionSummary(report.decisionSummary);

  if (summaryOnly) {
    return `${heading}\n\n${decisionSummary}\n`;
  }

  const sections = [
    heading,
    decisionSummary,
    "## Summary",
    escapeParagraph(report.summary),
    "## Metadata",
    renderFieldTable([
      ["Schema version", report.schemaVersion],
      ["Generated at", report.generatedAt],
      ["Mode", report.mode],
      ["Tool status", report.toolStatus],
      ["Final verdict", formatOptional(report.finalVerdict)],
    ]),
    "## Repository",
    renderFieldTable([
      ["Root", report.repo.root],
      ["Git repository", report.repo.isGitRepo ? "yes" : "no"],
      ["Package manager", formatOptional(report.repo.packageManager)],
      ["Detected frameworks", formatList(report.repo.detectedFrameworks)],
      ["Notes", formatList(report.repo.notes)],
    ]),
    "## Git Evidence",
    report.git === undefined
      ? "No Git evidence collected."
      : renderFieldTable([
          ["Since", formatOptional(report.git.since)],
          ["Summary", report.git.summary],
          ["Changed files", formatList(report.git.changedFiles)],
          ["Untracked files", formatList(report.git.untrackedFiles)],
          ["Deleted files", formatList(report.git.deletedFiles)],
          [
            "Dependency files changed",
            formatList(report.git.dependencyFilesChanged),
          ],
        ]),
    "## Commands",
    renderCommands(report.commands),
    "## Artifacts",
    renderArtifacts(report.artifacts),
    "## Claims",
    renderClaims(report.claims, report.claimVerdicts),
    "## Risks",
    renderRisks(report.risks),
    "## Risk Score",
    renderFieldTable([
      ["Score", report.riskScore.score],
      ["Severity", report.riskScore.severity],
      ["Blocking risks", formatList(report.riskScore.blockingRiskIds)],
      ["Warning risks", formatList(report.riskScore.warningRiskIds)],
    ]),
    "## Errors",
    renderErrors(report.errors),
    "## Limitations",
    "This renderer displays validated report data only. It does not execute commands, read logs, write files, or change verdicts.",
  ];

  return `${sections.join("\n\n")}\n`;
}

export function renderJsonReport(
  report: unknown,
  options: { readonly summaryOnly?: boolean } = {},
): string {
  const validatedReport = validateReport(report);
  return options.summaryOnly === true
    ? renderSummaryJsonFromValidatedReport(validatedReport)
    : renderJsonFromValidatedReport(validatedReport);
}

export function renderMarkdownReport(
  report: unknown,
  options: { readonly summaryOnly?: boolean } = {},
): string {
  return renderMarkdownFromValidatedReport(
    validateReport(report),
    options.summaryOnly === true,
  );
}

export function renderReport(
  report: unknown,
  options: RenderReportOptions,
): string {
  const validatedReport = validateReport(report);

  switch (options.format) {
    case "json":
      return options.summaryOnly === true
        ? renderSummaryJsonFromValidatedReport(validatedReport)
        : renderJsonFromValidatedReport(validatedReport);
    case "markdown":
      return renderMarkdownFromValidatedReport(
        validatedReport,
        options.summaryOnly === true,
      );
    default:
      throw new TypeError(`Unsupported report format: ${String(options.format)}`);
  }
}

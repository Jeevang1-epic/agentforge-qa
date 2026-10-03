import {
  VerificationModeSchema,
  VerificationReportSchema,
  VerificationRequestSchema,
  schemaVersion,
  type FinalVerdict,
  type VerificationMode,
  type VerificationReport,
} from "@agentforge-qa/schemas";

import { checkArtifacts } from "../artifacts/check-artifacts.js";
import { parseClaims } from "../claims/parse-claims.js";
import { planCommands } from "../commands/plan-commands.js";
import { runConfiguredCommands } from "../commands/run-configured-commands.js";
import { loadConfig, type LoadedConfig } from "../config/load-config.js";
import { detectRepo } from "../detectors/detect-repo.js";
import { matchEvidence } from "../evidence/match-evidence.js";
import {
  createEvidencePipelineError,
  createInternalPipelineError,
  createInvalidRequestError,
  EvidenceModuleError,
} from "../errors/pipeline-errors.js";
import { collectGitEvidence } from "../git/collect-git-evidence.js";
import { assessRisks } from "../risk/assess-risks.js";
import { scanFailureSuppression } from "../scanners/failure-suppression/scan.js";
import { calculateRiskScore } from "../risk/calculate-risk-score.js";
import { determineVerdict } from "../verdict/determine-verdict.js";
import { buildDecisionSummary } from "../summary/build-decision-summary.js";
import { createToolErrorReport } from "./create-empty-report.js";

const DEFAULT_OUTPUT_DIR = ".agentforge";

function applyRequestDefaults(request: unknown): unknown {
  if (typeof request !== "object" || request === null || Array.isArray(request)) {
    return request;
  }

  return {
    mode: "local",
    outputDir: DEFAULT_OUTPUT_DIR,
    ...request,
  };
}

function getErrorReportContext(request: unknown): {
  cwd?: string;
  mode?: VerificationMode;
} {
  if (typeof request !== "object" || request === null || Array.isArray(request)) {
    return {};
  }

  const candidate = request as Record<string, unknown>;
  const modeResult = VerificationModeSchema.safeParse(candidate.mode);

  return {
    ...(typeof candidate.cwd === "string" && candidate.cwd.length > 0
      ? { cwd: candidate.cwd }
      : {}),
    ...(modeResult.success ? { mode: modeResult.data } : {}),
  };
}

function createSummary(
  loadedConfig: LoadedConfig,
  claimSummary: string,
  finalVerdict: FinalVerdict,
  commandCount: number,
  artifactCount: number,
  riskCount: number,
): string {
  return [
    `Evidence verification completed with verdict ${finalVerdict}.`,
    loadedConfig.summary,
    claimSummary,
    `Collected ${commandCount} command results, ${artifactCount} artifact results, and ${riskCount} risks.`,
  ].join(" ");
}

export async function runVerification(
  request: unknown,
): Promise<VerificationReport> {
  const requestResult = VerificationRequestSchema.safeParse(
    applyRequestDefaults(request),
  );

  if (!requestResult.success) {
    return createToolErrorReport(
      createInvalidRequestError(requestResult.error.issues),
      getErrorReportContext(request),
    );
  }

  const verifiedRequest = requestResult.data;

  try {
    const repo = await detectRepo(verifiedRequest.cwd);
    const loadedConfig = await loadConfig(repo.root, verifiedRequest.configPath);
    const git = await collectGitEvidence(repo, verifiedRequest.since);
    const failureSuppression = await scanFailureSuppression(repo.root, git, verifiedRequest.since);
    const commandPlans = planCommands(loadedConfig.config.commands, repo.root);
    const commands = await runConfiguredCommands(commandPlans, {
      repoRoot: repo.root,
      dryRun: verifiedRequest.dryRun !== false,
    });
    const artifacts = await checkArtifacts(
      loadedConfig.config.artifacts,
      repo.root,
    );
    const parsedClaims = await parseClaims(repo.root, verifiedRequest.claimFile);
    const claimVerdicts = matchEvidence(
      parsedClaims.claims,
      loadedConfig.config,
      commands,
      artifacts,
    );
    const risks = assessRisks({
      artifactResults: artifacts,
      claimVerdicts,
      commandResults: commands,
      config: loadedConfig.config,
      git,
      failureSuppression,
      repo,
    });
    const riskScore = calculateRiskScore(risks);
    const finalVerdict = determineVerdict({
      artifacts,
      claimVerdicts,
      commands,
      risks,
      toolStatus: "OK",
    });

    const report = {
      schemaVersion,
      generatedAt: new Date().toISOString(),
      toolStatus: "OK",
      finalVerdict,
      mode: verifiedRequest.mode,
      repo,
      git: git.evidence,
      commands,
      artifacts,
      claims: parsedClaims.claims,
      claimVerdicts,
      risks,
      riskScore,
      summary: createSummary(
        loadedConfig,
        parsedClaims.summary,
        finalVerdict,
        commands.length,
        artifacts.length,
        risks.length,
      ),
    };

    return VerificationReportSchema.parse({
      ...report,
      decisionSummary: buildDecisionSummary({
        artifacts,
        claims: parsedClaims.claims,
        claimVerdicts,
        commands,
        config: loadedConfig.config,
        finalVerdict,
        risks,
        riskScore,
      }),
    });
  } catch (error) {
    return createToolErrorReport(
      error instanceof EvidenceModuleError
        ? createEvidencePipelineError(error)
        : createInternalPipelineError(error),
      {
        cwd: verifiedRequest.cwd,
        mode: verifiedRequest.mode,
      },
    );
  }
}

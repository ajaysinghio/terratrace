import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import fg from "fast-glob";
import {
  PythonAnalyzer,
  JavaAnalyzer,
  TerraformAnalyzer,
  TerraformHclAnalyzer,
  RightsizingFileSource,
  SemgrepAnalyzer,
  CompositeAnalyzer,
  MultiLanguageAnalyzer,
  SUPPORTED_LANGUAGES,
  AnthropicProvider,
  AWSCurSource,
  AWSCurS3Source,
  computeIdempotencyKey,
  correlateFindingsWithUsage,
  correlateComputeOptimizerFindings,
  recommendFinding,
  RULE_SERVICE_MAP,
  type CarbonEstimate,
  type CloudBillingSource,
  type CodeAnalyzer,
  type CodeFinding,
  type EnrichedFinding,
  type InfraResource,
  type UsageRecord,
} from "@terratrace/core";
import { sampleUsageRecords } from "./sampleUsage.js";

const DEFAULT_PATTERN = SUPPORTED_LANGUAGES.map((language) => `./sample-repo/${language.glob}`);

function resolveBillingSource(): { label: string; source: CloudBillingSource } | undefined {
  const curFilePath = process.env.TERRATRACE_CUR_FILE;
  if (curFilePath) {
    return { label: `CUR file at ${curFilePath}`, source: new AWSCurSource(curFilePath) };
  }

  const manifestBucket = process.env.TERRATRACE_CUR_S3_BUCKET;
  const manifestKey = process.env.TERRATRACE_CUR_S3_MANIFEST_KEY;
  if (manifestBucket && manifestKey) {
    return {
      label: `CUR manifest at s3://${manifestBucket}/${manifestKey}`,
      source: new AWSCurS3Source({ manifestBucket, manifestKey }),
    };
  }

  return undefined;
}

/**
 * Resolve the GitHub URL that findings should link back to on the dashboard.
 * TERRATRACE_REPO_URL wins if set; otherwise we ask `git remote get-url
 * origin` in the current cwd (the workspace root when invoked via
 * `pnpm scan`) and normalize the SSH/HTTPS shapes to a plain
 * https://github.com/owner/repo. Returns undefined if neither works — the
 * dashboard just omits the link.
 */
function resolveRepoUrl(): string | undefined {
  const explicit = process.env.TERRATRACE_REPO_URL;
  if (explicit) return normalizeRepoUrl(explicit);
  try {
    const remote = execFileSync("git", ["remote", "get-url", "origin"], { encoding: "utf-8" }).trim();
    return normalizeRepoUrl(remote);
  } catch {
    return undefined;
  }
}

function normalizeRepoUrl(input: string): string | undefined {
  const trimmed = input.trim();
  const ssh = trimmed.match(/^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (ssh) return `https://github.com/${ssh[1]}/${ssh[2]}`;
  const https = trimmed.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/);
  if (https) return `https://github.com/${https[1]}/${https[2]}`;
  return undefined;
}

async function buildAnalyzer(): Promise<CodeAnalyzer> {
  const semgrepAvailable = await SemgrepAnalyzer.isAvailable();

  if (!semgrepAvailable) {
    console.error(
      "terratrace: semgrep not found on PATH — running with PythonAnalyzer only " +
        "(Java and Terraform have no detection without Semgrep). Install with " +
        "`pip install semgrep` to enable the declarative rule packs for all languages.",
    );
    return new PythonAnalyzer();
  }

  console.error(
    "terratrace: semgrep detected — composing SemgrepAnalyzer + PythonAnalyzer for Python, " +
      "JavaAnalyzer for Java, TerraformAnalyzer for Terraform.",
  );
  return new MultiLanguageAnalyzer([
    {
      extensions: [".py"],
      analyzer: new CompositeAnalyzer([new SemgrepAnalyzer(), new PythonAnalyzer()], "python"),
    },
    { extensions: [".java"], analyzer: new JavaAnalyzer() },
    { extensions: [".tf"], analyzer: new TerraformAnalyzer() },
  ]);
}

async function loadUsageRecords(): Promise<UsageRecord[]> {
  const resolved = resolveBillingSource();
  if (resolved) {
    try {
      const end = new Date().toISOString().slice(0, 10);
      const start = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const records = await resolved.source.fetchUsage({ start, end });
      if (records.length > 0) return records;
    } catch (error) {
      console.error(`terratrace: failed to fetch usage from ${resolved.label}, falling back to sample billing data.`, error);
    }
  }
  return sampleUsageRecords;
}

async function main(): Promise<void> {
  const pattern = process.argv[2] ?? DEFAULT_PATTERN;
  const projectId = process.argv[3] ?? "sample-repo";
  const projectName = process.argv[4] ?? projectId;

  const files = await fg(pattern);
  const analyzer = await buildAnalyzer();
  const llm = new AnthropicProvider();

  const findingsByFile = new Map<string, CodeFinding[]>();
  const sourceByFile = new Map<string, string>();
  for (const filePath of files) {
    const sourceCode = await readFile(filePath, "utf-8");
    sourceByFile.set(filePath, sourceCode);
    findingsByFile.set(filePath, await analyzer.analyzeFile(filePath, sourceCode));
  }

  const allFindings = Array.from(findingsByFile.values()).flat();
  const usageRecords = await loadUsageRecords();
  const estimateByFindingId = correlateFindingsWithUsage(allFindings, usageRecords);

  // Optional: cross-reference every declared aws_instance/aws_db_instance
  // against a real (or sample) AWS Compute Optimizer export. Only runs when
  // configured — falls back to TerraformAnalyzer's static Semgrep rules
  // alone (already in allFindings above) when it isn't.
  const rightsizingFilePath = process.env.TERRATRACE_RIGHTSIZING_FILE;
  if (rightsizingFilePath) {
    try {
      const hclAnalyzer = new TerraformHclAnalyzer();
      const infraResources: InfraResource[] = [];
      for (const filePath of files) {
        if (!filePath.endsWith(".tf")) continue;
        const sourceCode = sourceByFile.get(filePath);
        if (sourceCode) infraResources.push(...(await hclAnalyzer.parseFile(filePath, sourceCode)));
      }

      const recommendations = await new RightsizingFileSource(rightsizingFilePath).fetchRecommendations();
      const { findings: computeOptimizerFindings, estimates } = correlateComputeOptimizerFindings(
        infraResources,
        recommendations,
      );

      allFindings.push(...computeOptimizerFindings);
      for (const [id, estimate] of estimates) estimateByFindingId.set(id, estimate);

      console.error(
        `terratrace: Compute Optimizer cross-reference found ${computeOptimizerFindings.length} ` +
          `overprovisioned resource(s) across ${infraResources.length} declared aws_instance/aws_db_instance resource(s).`,
      );
    } catch (error) {
      console.error(
        `terratrace: Compute Optimizer cross-reference failed, falling back to static Terraform rules only.`,
        error instanceof Error ? error.message : error,
      );
    }
  }

  // Cost control: an LLM call is attempted (explainFinding, then
  // recommendFinding) per finding with no cap otherwise — a large repo with
  // hundreds of findings has no spend ceiling. Prioritize the highest-
  // severity findings within the budget rather than capping by scan order,
  // so a huge low-severity tail can't crowd out the findings that matter
  // most. Set TERRATRACE_MAX_LLM_FINDINGS to override the default of 50;
  // findings beyond the budget still appear in the output, just without an
  // explanation/suggestedFixDiff.
  const SEVERITY_ORDER: Record<CodeFinding["severity"], number> = { low: 0, medium: 1, high: 2 };
  const maxLlmFindings = Number(process.env.TERRATRACE_MAX_LLM_FINDINGS) || 50;
  const budgetedFindingIds = new Set(
    [...allFindings]
      .sort((a, b) => SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity])
      .slice(0, maxLlmFindings)
      .map((f) => f.id),
  );
  const skippedForBudget = allFindings.length - budgetedFindingIds.size;
  if (skippedForBudget > 0) {
    console.error(
      `terratrace: cost control — ${allFindings.length} finding(s) found, LLM calls capped at ` +
        `${maxLlmFindings} (set TERRATRACE_MAX_LLM_FINDINGS to change); skipping explanation/fix ` +
        `generation for ${skippedForBudget} lower-severity finding(s).`,
    );
  }

  const enrichedFindings: EnrichedFinding[] = [];
  let recommendationsValidated = 0;
  let recommendationsRejected = 0;
  let fixesFromRuleAutofix = 0;
  let fixesFromLlm = 0;

  for (const finding of allFindings) {
    const estimate = estimateByFindingId.get(finding.id);
    const relatedUsage = usageRecords.filter(
      (record) => record.service === RULE_SERVICE_MAP[finding.ruleId],
    );
    const evidence = { codeFinding: finding, carbonEstimate: estimate, relatedUsage };
    const withinLlmBudget = budgetedFindingIds.has(finding.id);

    let explanation: string | undefined;
    if (withinLlmBudget) {
      try {
        explanation = await llm.explainFinding(evidence);
      } catch (error) {
        console.error(
          `terratrace: explainFinding failed for ${finding.filePath}:${finding.startLine} — leaving explanation empty.`,
          error instanceof Error ? error.message : error,
        );
      }
    }

    let suggestedFixDiff: string | undefined;
    const sourceCode = sourceByFile.get(finding.filePath);
    if (withinLlmBudget && sourceCode) {
      try {
        const recommendation = await recommendFinding({
          finding,
          sourceCode,
          analyzer,
          llm,
          evidence,
          maxRetries: 2,
        });
        if (recommendation.validation.ok) {
          suggestedFixDiff = recommendation.fixDiff;
          recommendationsValidated++;
          if (recommendation.fixSource === "rule-autofix") fixesFromRuleAutofix++;
          else fixesFromLlm++;
          console.error(
            `terratrace: validated fix for ${finding.filePath}:${finding.startLine} ` +
              `(key=${recommendation.idempotencyKey}, source=${recommendation.fixSource}, attempts=${recommendation.validation.attempts}).`,
          );
        } else {
          recommendationsRejected++;
          console.error(
            `terratrace: no validated fix for ${finding.filePath}:${finding.startLine} ` +
              `(${recommendation.validation.reason} after ${recommendation.validation.attempts} attempt(s)) — ` +
              `omitting suggestedFixDiff.`,
          );
        }
      } catch (error) {
        recommendationsRejected++;
        console.error(
          `terratrace: recommendFinding threw for ${finding.filePath}:${finding.startLine} — omitting suggestedFixDiff.`,
          error instanceof Error ? error.message : error,
        );
      }
    }

    enrichedFindings.push({
      ...finding,
      estimate,
      explanation,
      suggestedFixDiff,
      idempotencyKey: computeIdempotencyKey(finding),
    });
  }

  const repoUrl = resolveRepoUrl();
  const output = {
    project: {
      id: projectId,
      name: projectName,
      repoUrl,
      scannedAt: new Date().toISOString(),
    },
    findings: enrichedFindings,
  };

  // One file per project under ./scan-output/ so the dashboard can list many
  // scanned repos on its home page and drill into each one individually —
  // run this CLI once per repo (with a distinct projectId) in CI, and sync
  // the resulting scan-output/<projectId>.json files wherever the dashboard
  // reads from.
  const outDir = path.join(process.cwd(), "scan-output");
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, `${projectId}.json`), JSON.stringify(output, null, 2));

  console.log(JSON.stringify(output, null, 2));
  console.error(
    `terratrace: found ${enrichedFindings.length} finding(s) across ${files.length} file(s) ` +
      `for project "${projectId}" (written to scan-output/${projectId}.json).`,
  );
  console.error(
    `terratrace: ${recommendationsValidated} validated fix(es) ` +
      `(${fixesFromRuleAutofix} deterministic rule-autofix, ${fixesFromLlm} LLM-authored), ` +
      `${recommendationsRejected} rejected ` +
      `(rejected = diff didn't apply, didn't clear the finding, or introduced a new one after retries).`,
  );

  const totalKgCO2e = enrichedFindings.reduce((sum, f) => sum + (f.estimate?.kgCO2e ?? 0), 0);
  if (totalKgCO2e > 0) {
    const confidence = overallConfidence(enrichedFindings.map((f) => f.estimate));
    console.error(
      `terratrace: estimated ${totalKgCO2e.toFixed(4)} kgCO2e attributable to these findings ` +
        `(ccf-derived, ${confidence} confidence — see carbonMath.ts before quoting publicly).`,
    );
  }
}

const CONFIDENCE_RANK: Record<CarbonEstimate["confidence"], number> = { low: 0, medium: 1, high: 2 };

/** Worst (most conservative) confidence across findings with an estimate. */
function overallConfidence(estimates: Array<CarbonEstimate | undefined>): CarbonEstimate["confidence"] {
  return estimates.reduce<CarbonEstimate["confidence"]>((worst, estimate) => {
    if (!estimate) return worst;
    return CONFIDENCE_RANK[estimate.confidence] < CONFIDENCE_RANK[worst] ? estimate.confidence : worst;
  }, "high");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

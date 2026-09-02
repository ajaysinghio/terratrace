import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import fg from "fast-glob";
import {
  PythonAnalyzer,
  AnthropicProvider,
  AWSCurSource,
  AWSCurS3Source,
  correlateFindingsWithUsage,
  RULE_SERVICE_MAP,
  type CarbonEstimate,
  type CloudBillingSource,
  type CodeFinding,
  type EnrichedFinding,
  type UsageRecord,
} from "@terratrace/core";
import { sampleUsageRecords } from "./sampleUsage.js";

const DEFAULT_PATTERN = "./sample-repo/**/*.py";

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
  const analyzer = new PythonAnalyzer();
  const llm = new AnthropicProvider();

  const findingsByFile = new Map<string, CodeFinding[]>();
  for (const filePath of files) {
    const sourceCode = await readFile(filePath, "utf-8");
    findingsByFile.set(filePath, await analyzer.analyzeFile(filePath, sourceCode));
  }

  const allFindings = Array.from(findingsByFile.values()).flat();
  const usageRecords = await loadUsageRecords();
  const estimateByFindingId = correlateFindingsWithUsage(allFindings, usageRecords);

  const enrichedFindings: EnrichedFinding[] = [];

  for (const finding of allFindings) {
    const estimate = estimateByFindingId.get(finding.id);
    const relatedUsage = usageRecords.filter(
      (record) => record.service === RULE_SERVICE_MAP[finding.ruleId],
    );

    let explanation: string | undefined;
    try {
      explanation = await llm.explainFinding({
        codeFinding: finding,
        carbonEstimate: estimate,
        relatedUsage,
      });
    } catch (error) {
      console.error(
        `terratrace: explainFinding failed for ${finding.filePath}:${finding.startLine} — leaving explanation empty.`,
        error instanceof Error ? error.message : error,
      );
    }

    enrichedFindings.push({ ...finding, estimate, explanation });
  }

  const output = {
    project: { id: projectId, name: projectName, scannedAt: new Date().toISOString() },
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

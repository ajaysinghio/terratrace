import type { CarbonEstimate, CodeFinding, UsageRecord } from "../types.js";
import { estimateCarbon } from "./carbonMath.js";

// Maps a detection rule to the AWS service it most directly amplifies. Rule
// ids are shared across languages (see rules-semgrep/<language>/*.yaml), so
// one entry here covers a rule's Python and Java implementations alike.
export const RULE_SERVICE_MAP: Record<string, string> = {
  "n-plus-one-query": "AmazonRDS",
  "unbounded-query": "AmazonRDS",
  "chatty-s3-loop": "AmazonS3",
};

/**
 * Correlates each finding with billing usage for the AWS service its rule
 * maps to, and apportions that service's carbon estimate evenly across the
 * findings that hit it — so summing every finding's estimate.kgCO2e doesn't
 * double-count a usage group shared by multiple findings.
 */
export function correlateFindingsWithUsage(
  findings: CodeFinding[],
  usageRecords: UsageRecord[],
): Map<string, CarbonEstimate> {
  const usageByService = new Map<string, UsageRecord[]>();
  for (const record of usageRecords) {
    const list = usageByService.get(record.service) ?? [];
    list.push(record);
    usageByService.set(record.service, list);
  }

  const findingsByService = new Map<string, CodeFinding[]>();
  for (const finding of findings) {
    const service = RULE_SERVICE_MAP[finding.ruleId];
    if (!service) continue;
    const list = findingsByService.get(service) ?? [];
    list.push(finding);
    findingsByService.set(service, list);
  }

  const estimateByFindingId = new Map<string, CarbonEstimate>();
  for (const [service, serviceFindings] of findingsByService) {
    const usage = usageByService.get(service);
    if (!usage || usage.length === 0) continue;

    const groupEstimate = estimateCarbon(usage);
    const perFindingEstimate: CarbonEstimate = {
      ...groupEstimate,
      kgCO2e: groupEstimate.kgCO2e / serviceFindings.length,
    };

    for (const finding of serviceFindings) {
      estimateByFindingId.set(finding.id, perFindingEstimate);
    }
  }

  return estimateByFindingId;
}

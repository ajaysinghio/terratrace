import { createHash } from "node:crypto";
import type { CarbonEstimate, CodeFinding, InfraResource, RightsizingRecommendation, UsageRecord } from "../types.js";
import { estimateCarbon } from "./carbonMath.js";

export const COMPUTE_OPTIMIZER_OVERPROVISIONED_RULE_ID = "compute-optimizer-overprovisioned";

// A resource that's provisioned at all runs the full month, whether or not
// it's actually used — same assumption CCF's own methodology makes for
// steady-state compute.
const HOURS_PER_MONTH = 730;

const SERVICE_FOR_RESOURCE_TYPE: Record<string, string> = {
  aws_instance: "AmazonEC2",
  aws_db_instance: "AmazonRDS",
};

export interface ComputeOptimizerCorrelationResult {
  findings: CodeFinding[];
  /** Keyed by CodeFinding.id — merge into correlateFindingsWithUsage's map before enrichment. */
  estimates: Map<string, CarbonEstimate>;
}

/**
 * Cross-references every declared aws_instance/aws_db_instance resource
 * against a real (or sample) Compute Optimizer recommendation for it,
 * matched by shared tag value — Compute Optimizer keys recommendations by
 * AWS ARN, which doesn't exist until after `terraform apply` and isn't
 * derivable from a .tf file alone without also reading terraform.tfstate,
 * so a shared tag is the honest fallback.
 *
 * Unlike Semgrep's static `oversized-instance-type` rule (a syntactic
 * size-threshold guess that can only ever flag instance types that already
 * look big, and has no equivalent for RDS at all), this only fires on
 * resources Compute Optimizer has actually measured as "Overprovisioned" —
 * including ones that don't look large syntactically. Findings carry their
 * own precise current-vs-recommended carbon delta rather than going through
 * correlateFindingsWithUsage's CUR-apportionment path: that path pools
 * findings evenly across a service's total billed usage, which would dilute
 * a number that's already a precise 1:1 measured comparison. Callers should
 * merge `estimates` directly into their estimateByFindingId map instead.
 */
export function correlateComputeOptimizerFindings(
  resources: InfraResource[],
  recommendations: RightsizingRecommendation[],
  matchTagKey = "Name",
): ComputeOptimizerCorrelationResult {
  const recommendationByTagValue = new Map<string, RightsizingRecommendation>();
  for (const rec of recommendations) {
    const tagValue = rec.tags?.[matchTagKey];
    if (tagValue) recommendationByTagValue.set(tagValue, rec);
  }

  const findings: CodeFinding[] = [];
  const estimates = new Map<string, CarbonEstimate>();

  for (const resource of resources) {
    const service = SERVICE_FOR_RESOURCE_TYPE[resource.resourceType];
    if (!service) continue;

    const tagValue = resource.tags?.[matchTagKey];
    if (!tagValue) continue;
    const recommendation = recommendationByTagValue.get(tagValue);
    if (!recommendation || recommendation.finding !== "Overprovisioned") continue;

    const currentEstimate = estimateCarbon([
      syntheticUsageRecord(service, resource.region, recommendation.currentInstanceType),
    ]);
    const recommendedEstimate = estimateCarbon([
      syntheticUsageRecord(service, resource.region, recommendation.recommendedInstanceType),
    ]);
    const savingsKgCO2e = currentEstimate.kgCO2e - recommendedEstimate.kgCO2e;
    // aws.ts's wattage model varies by instance *family* (m5, t3, ...) and a
    // fixed CPU-utilization constant, not by size within a family — so a
    // same-family downsize (a common real Compute Optimizer recommendation,
    // e.g. "m5.4xlarge -> m5.large") can measure zero difference today even
    // though it's Overprovisioned. Surfacing that as a "finding" with a
    // claimed 0.0000 kgCO2e saving would be actively misleading, so skip it
    // rather than report a number the current model can't actually back up.
    if (savingsKgCO2e <= 0) continue;

    const id = createHash("sha256")
      .update(`${COMPUTE_OPTIMIZER_OVERPROVISIONED_RULE_ID}\0${resource.filePath}\0${resource.resourceAddress}`)
      .digest("hex")
      .slice(0, 16);

    findings.push({
      id,
      ruleId: COMPUTE_OPTIMIZER_OVERPROVISIONED_RULE_ID,
      severity: "medium",
      filePath: resource.filePath,
      startLine: resource.startLine,
      endLine: resource.endLine,
      snippet: `resource "${resource.resourceType}" "${resource.resourceAddress.split(".").slice(1).join(".")}" { ... = "${recommendation.currentInstanceType}" ... }`,
      message:
        `AWS Compute Optimizer measured ${resource.resourceAddress} (${recommendation.currentInstanceType}) as ` +
        `overprovisioned from real utilization data — ${recommendation.recommendedInstanceType} would cover the ` +
        `same workload for an estimated ${savingsKgCO2e.toFixed(4)} kgCO2e/month less.`,
    });

    estimates.set(id, {
      kgCO2e: savingsKgCO2e,
      methodology: "ccf-derived",
      gridIntensityGco2PerKwh: currentEstimate.gridIntensityGco2PerKwh,
      // A measured 1:1 comparison, not an apportioned slice of aggregate
      // usage — the highest-fidelity carbon signal this pipeline produces.
      confidence: "high",
      costUsd: 0,
    });
  }

  return { findings, estimates };
}

function syntheticUsageRecord(service: string, region: string, instanceType: string): UsageRecord {
  const epoch = new Date(0).toISOString();
  return {
    provider: "aws",
    service,
    region,
    resourceId: instanceType,
    usageAmount: HOURS_PER_MONTH,
    usageUnit: "Hrs",
    costUsd: 0,
    periodStart: epoch,
    periodEnd: epoch,
  };
}
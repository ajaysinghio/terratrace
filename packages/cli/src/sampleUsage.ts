import type { UsageRecord } from "@terratrace/core";

// Representative AWS Cost Explorer-shaped usage, used only when no AWS
// credentials are configured (local dev, CI, demo/judging runs). Swap this
// out entirely once AWSCurSource.fetchUsage(...) is pointed at a real
// account — see loadUsageRecords() in index.ts — nothing else in the
// pipeline needs to change.
export const sampleUsageRecords: UsageRecord[] = [
  {
    provider: "aws",
    service: "AmazonRDS",
    region: "us-east-1",
    usageAmount: 742,
    usageUnit: "Hrs",
    costUsd: 214.37,
    periodStart: "2026-07-01",
    periodEnd: "2026-07-31",
  },
  {
    provider: "aws",
    service: "AmazonRDS",
    region: "us-west-2",
    usageAmount: 168,
    usageUnit: "Hrs",
    costUsd: 41.02,
    periodStart: "2026-07-01",
    periodEnd: "2026-07-31",
  },
  // Terraform's rule pack (oversized-instance-type, no-autoscaling-floor ->
  // AmazonEC2; missing-lifecycle-policy -> AmazonS3, see
  // core/src/carbon/correlate.ts's RULE_SERVICE_MAP) had no matching usage
  // records at all, so every Terraform finding silently got no cost/carbon
  // estimate — these two entries are what let Infrastructure-as-Code
  // findings correlate with billing the same way application-code findings
  // already do.
  {
    provider: "aws",
    service: "AmazonEC2",
    region: "us-east-1",
    usageAmount: 730,
    usageUnit: "Hrs",
    costUsd: 612.5,
    periodStart: "2026-07-01",
    periodEnd: "2026-07-31",
  },
  {
    provider: "aws",
    service: "AmazonS3",
    region: "us-east-1",
    usageAmount: 4200,
    usageUnit: "GB-Mo",
    costUsd: 96.6,
    periodStart: "2026-07-01",
    periodEnd: "2026-07-31",
  },
];

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
];

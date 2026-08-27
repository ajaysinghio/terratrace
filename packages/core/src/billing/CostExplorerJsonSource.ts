import { readFile } from "node:fs/promises";
import type { CloudBillingSource } from "./CloudBillingSource.js";
import type { UsageRecord } from "../types.js";

/**
 * The GroupBy dimensions Cost Explorer supports for `Key` extraction. This
 * union is deliberately narrow: it matches the four dimensions worth
 * knowing about for carbon math. Add more as they become useful.
 */
export type GroupByDimension = "SERVICE" | "REGION" | "INSTANCE_TYPE" | "USAGE_TYPE";

export interface CostExplorerJsonSourceOptions {
  filePath: string;
  /**
   * The dimensions the `Keys` array in each Group corresponds to, in the
   * same order they appeared in `--group-by`. Defaults to
   * ["SERVICE", "REGION"] which matches AWSCurSource's default.
   *
   * Cost Explorer allows at most 2 dimensions per call, so you have to
   * pick between per-instance-type accuracy (SERVICE + INSTANCE_TYPE) and
   * per-region grid intensity (SERVICE + REGION). For higher fidelity than
   * either, use CUR instead.
   */
  groupByOrder?: GroupByDimension[];
  /**
   * Filled into `record.region` when REGION isn't in `groupByOrder`.
   * Useful when your workload is single-region and you're prioritising
   * instance-type detail. Defaults to "unknown".
   */
  defaultRegion?: string;
}

/**
 * CloudBillingSource backed by a JSON dump of AWS Cost Explorer's
 * GetCostAndUsage response — the output of:
 *
 *   aws ce get-cost-and-usage \
 *     --time-period Start=2026-07-01,End=2026-08-01 \
 *     --granularity DAILY \
 *     --metrics UsageQuantity UnblendedCost \
 *     --group-by Type=DIMENSION,Key=SERVICE Type=DIMENSION,Key=REGION \
 *     --output json > costs.json
 *
 * Useful for deterministic testing (commit the JSON as a fixture),
 * air-gapped review, or when the person with AWS credentials isn't the
 * person running the pipeline.
 */
export class CostExplorerJsonSource implements CloudBillingSource {
  readonly provider = "aws";

  constructor(private readonly opts: CostExplorerJsonSourceOptions) {}

  async fetchUsage(_params: { start: string; end: string }): Promise<UsageRecord[]> {
    const raw = await readFile(this.opts.filePath, "utf8");
    return parseCostExplorerJson(JSON.parse(raw) as CostExplorerResponse, {
      groupByOrder: this.opts.groupByOrder,
      defaultRegion: this.opts.defaultRegion,
    });
  }
}

interface CostExplorerResponse {
  ResultsByTime?: Array<{
    TimePeriod?: { Start?: string; End?: string };
    Groups?: Array<{
      Keys?: string[];
      Metrics?: {
        UnblendedCost?: { Amount?: string };
        UsageQuantity?: { Amount?: string; Unit?: string };
      };
    }>;
  }>;
}

export function parseCostExplorerJson(
  response: CostExplorerResponse,
  opts: { groupByOrder?: GroupByDimension[]; defaultRegion?: string } = {},
): UsageRecord[] {
  const order = opts.groupByOrder ?? ["SERVICE", "REGION"];
  const defaultRegion = opts.defaultRegion ?? "unknown";
  const records: UsageRecord[] = [];

  for (const result of response.ResultsByTime ?? []) {
    const periodStart = result.TimePeriod?.Start;
    if (!periodStart) continue;
    const periodEnd = result.TimePeriod?.End ?? periodStart;

    for (const group of result.Groups ?? []) {
      const dims = mapKeysToDimensions(group.Keys ?? [], order);
      const costUsd = Number(group.Metrics?.UnblendedCost?.Amount ?? "0");
      const usageAmount = Number(group.Metrics?.UsageQuantity?.Amount ?? "0");
      const usageUnit = group.Metrics?.UsageQuantity?.Unit ?? "Unknown";

      const record: UsageRecord = {
        provider: "aws",
        service: dims.service ?? "unknown",
        region: dims.region ?? defaultRegion,
        usageAmount: Number.isNaN(usageAmount) ? 0 : usageAmount,
        usageUnit,
        costUsd: Number.isNaN(costUsd) ? 0 : costUsd,
        periodStart,
        periodEnd,
      };

      if (dims.instanceType) record.resourceId = dims.instanceType;

      records.push(record);
    }
  }

  return records;
}

interface ExtractedDimensions {
  service?: string;
  region?: string;
  instanceType?: string;
}

function mapKeysToDimensions(keys: string[], order: GroupByDimension[]): ExtractedDimensions {
  const out: ExtractedDimensions = {};
  for (let i = 0; i < order.length && i < keys.length; i++) {
    switch (order[i]) {
      case "SERVICE":
        out.service = keys[i];
        break;
      case "REGION":
        out.region = keys[i];
        break;
      case "INSTANCE_TYPE":
        out.instanceType = keys[i];
        break;
      case "USAGE_TYPE":
        break;
    }
  }
  return out;
}

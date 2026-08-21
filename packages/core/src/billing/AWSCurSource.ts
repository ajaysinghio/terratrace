import {
  CostExplorerClient,
  GetCostAndUsageCommand,
  type GetCostAndUsageCommandOutput,
} from "@aws-sdk/client-cost-explorer";
import type { CloudBillingSource } from "./CloudBillingSource.js";
import type { UsageRecord } from "../types.js";

/**
 * CloudBillingSource backed by AWS Cost Explorer's Cost and Usage Reports
 * API. Pulls daily granularity, grouped by SERVICE and REGION, and maps the
 * response into normalized UsageRecord[].
 */
export class AWSCurSource implements CloudBillingSource {
  readonly provider = "aws";
  private readonly client: CostExplorerClient;

  constructor(region: string = process.env.AWS_REGION ?? "us-east-1") {
    this.client = new CostExplorerClient({ region });
  }

  async fetchUsage(params: { start: string; end: string }): Promise<UsageRecord[]> {
    const command = new GetCostAndUsageCommand({
      TimePeriod: { Start: params.start, End: params.end },
      Granularity: "DAILY",
      Metrics: ["UnblendedCost", "UsageQuantity"],
      GroupBy: [
        { Type: "DIMENSION", Key: "SERVICE" },
        { Type: "DIMENSION", Key: "REGION" },
      ],
    });

    const response: GetCostAndUsageCommandOutput = await this.client.send(command);
    const records: UsageRecord[] = [];

    for (const resultByTime of response.ResultsByTime ?? []) {
      const periodStart = resultByTime.TimePeriod?.Start ?? params.start;
      const periodEnd = resultByTime.TimePeriod?.End ?? params.end;

      for (const group of resultByTime.Groups ?? []) {
        const [service, region] = group.Keys ?? ["unknown", "unknown"];
        const costUsd = Number(group.Metrics?.UnblendedCost?.Amount ?? "0");
        const usageAmount = Number(group.Metrics?.UsageQuantity?.Amount ?? "0");
        const usageUnit = group.Metrics?.UsageQuantity?.Unit ?? "Unknown";

        records.push({
          provider: "aws",
          service: service ?? "unknown",
          region: region ?? "unknown",
          usageAmount,
          usageUnit,
          costUsd,
          periodStart,
          periodEnd,
        });
      }
    }

    return records;
  }
}

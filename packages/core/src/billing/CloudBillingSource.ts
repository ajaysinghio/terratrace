import type { UsageRecord } from "../types.js";

/**
 * Interface for any cloud/infra billing source. Adding a new cloud (GCP,
 * Azure, on-prem metering) means writing one new implementation of this
 * interface — nothing else in the codebase needs to change.
 */
export interface CloudBillingSource {
  readonly provider: string;
  fetchUsage(params: { start: string; end: string }): Promise<UsageRecord[]>;
}

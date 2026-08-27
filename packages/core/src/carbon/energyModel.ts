import type { CloudProvider, UsageRecord } from "../types.js";

/**
 * Per-provider energy-consumption model. Adding a new cloud (or on-prem)
 * means writing one implementation of this interface and registering it in
 * `./coefficients/index.ts` — nothing else in the pipeline needs to change.
 * Grid intensity (kg CO2e per kWh) is applied by the caller after this
 * returns kWh, so an on-prem model can override intensity per data centre
 * without re-implementing service math.
 */
export interface EnergyModel {
  readonly provider: CloudProvider;
  /**
   * kWh consumed by a single billing usage record. Return 0 for services
   * this model does not (yet) recognise — the caller treats 0 as "not
   * covered" rather than "genuinely zero" when computing coverage-based
   * confidence.
   */
  estimateKwh(record: UsageRecord): number;
}

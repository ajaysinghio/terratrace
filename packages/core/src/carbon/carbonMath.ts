import type { CarbonEstimate, UsageRecord } from "../types.js";
import { energyModelFor } from "./coefficients/index.js";
import { gridIntensity, DEFAULT_GRID_INTENSITY_KG_PER_KWH } from "./coefficients/grid.js";

/**
 * SCI-style kgCO2e estimate derived from a set of billing usage records.
 * Dispatches per record.provider to the registered EnergyModel, then
 * multiplies by the region's grid intensity. Confidence is set from the
 * fraction of records the registered models could actually estimate.
 *
 * Adding a new cloud (or on-prem) does not change this function — see
 * `./coefficients/index.ts` for the extension seam.
 */
export function estimateCarbon(records: UsageRecord[]): CarbonEstimate {
  let totalKgCO2e = 0;
  let totalKwh = 0;
  let weightedIntensitySum = 0;
  let coveredCount = 0;
  // Cost is billed, real money regardless of whether an energy model covers
  // the record — unlike kgCO2e, it isn't derived, so it's summed over every
  // record rather than gated behind `model`/`kwh` coverage.
  let totalCostUsd = 0;

  for (const record of records) {
    totalCostUsd += record.costUsd;

    const model = energyModelFor(record.provider);
    if (!model) continue;

    const kwh = model.estimateKwh(record);
    if (kwh <= 0) continue;

    const intensity = gridIntensity(record.provider, record.region);
    totalKgCO2e += kwh * intensity;
    totalKwh += kwh;
    weightedIntensitySum += kwh * intensity;
    coveredCount += 1;
  }

  const averageGridIntensityKgPerKwh = totalKwh > 0
    ? weightedIntensitySum / totalKwh
    : DEFAULT_GRID_INTENSITY_KG_PER_KWH;

  const coverage = records.length > 0 ? coveredCount / records.length : 0;

  return {
    kgCO2e: totalKgCO2e,
    methodology: "ccf-derived",
    gridIntensityGco2PerKwh: averageGridIntensityKgPerKwh * 1000,
    confidence: coverage >= 0.8 ? "medium" : "low",
    costUsd: totalCostUsd,
  };
}

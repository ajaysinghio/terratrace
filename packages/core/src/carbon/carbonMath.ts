import type { CarbonEstimate, UsageRecord } from "../types.js";

/**
 * Grid carbon intensity by AWS region, in kg CO2e per kWh. Seed values are
 * approximate published figures for a handful of regions; anything not
 * listed falls back to DEFAULT_GRID_INTENSITY_KG_PER_KWH.
 */
export const GRID_INTENSITY_KG_PER_KWH: Record<string, number> = {
  "us-east-1": 0.379,
  "us-west-2": 0.136,
  "eu-west-1": 0.316,
};

const DEFAULT_GRID_INTENSITY_KG_PER_KWH = 0.4;

// PLACEHOLDER COEFFICIENT: this treats every unit of `usageAmount` (regardless
// of service or usage unit) as costing a flat 0.01 kWh. That is not a real
// energy model — before quoting these numbers publicly, replace this with
// Cloud Carbon Footprint's published per-service, per-instance-type energy
// coefficients (https://www.cloudcarbonfootprint.org/docs/methodology).
const PLACEHOLDER_KWH_PER_USAGE_UNIT = 0.01;

/**
 * SCI-style kgCO2e estimate derived from a set of billing usage records.
 * Returns confidence: "low" until PLACEHOLDER_KWH_PER_USAGE_UNIT is replaced
 * with real per-service energy coefficients.
 */
export function estimateCarbon(records: UsageRecord[]): CarbonEstimate {
  let totalKgCO2e = 0;
  let weightedIntensitySum = 0;
  let totalKwh = 0;

  for (const record of records) {
    const gridIntensity = GRID_INTENSITY_KG_PER_KWH[record.region] ?? DEFAULT_GRID_INTENSITY_KG_PER_KWH;
    const estimatedKwh = record.usageAmount * PLACEHOLDER_KWH_PER_USAGE_UNIT;

    totalKgCO2e += estimatedKwh * gridIntensity;
    totalKwh += estimatedKwh;
    weightedIntensitySum += estimatedKwh * gridIntensity;
  }

  const averageGridIntensityKgPerKwh = totalKwh > 0 ? weightedIntensitySum / totalKwh : DEFAULT_GRID_INTENSITY_KG_PER_KWH;

  return {
    kgCO2e: totalKgCO2e,
    methodology: "ccf-derived",
    gridIntensityGco2PerKwh: averageGridIntensityKgPerKwh * 1000,
    confidence: "low",
  };
}

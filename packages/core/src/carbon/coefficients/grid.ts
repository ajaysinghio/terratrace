import type { CloudProvider } from "../../types.js";

/**
 * Grid carbon intensity in kg CO2e per kWh, by cloud provider and region.
 * Seed values approximate Cloud Carbon Footprint's published tables (which
 * source from Ember / Our World in Data / regional grid operators). Replace
 * with CCF's canonical numbers before quoting to a client — see:
 * https://www.cloudcarbonfootprint.org/docs/methodology/#regional-grid-emissions-factors
 *
 * The on-prem row is intentionally empty: on-prem grid intensity is a
 * per-deployment value populated at startup from client-specific config
 * (their data-centre location's grid mix), not a static table.
 */
export const GRID_INTENSITY_KG_PER_KWH: Record<CloudProvider, Record<string, number>> = {
  aws: {
    "us-east-1": 0.379,
    "us-east-2": 0.410,
    "us-west-1": 0.238,
    "us-west-2": 0.136,
    "eu-west-1": 0.316,
    "eu-west-2": 0.226,
    "eu-west-3": 0.052,
    "eu-central-1": 0.311,
    "eu-north-1": 0.008,
    "ap-south-1": 0.708,
    "ap-southeast-1": 0.408,
    "ap-southeast-2": 0.790,
    "ap-northeast-1": 0.506,
    "ap-northeast-2": 0.500,
    "ca-central-1": 0.130,
    "sa-east-1": 0.074,
  },
  gcp: {},
  azure: {},
  onprem: {},
};

export const DEFAULT_GRID_INTENSITY_KG_PER_KWH = 0.4;

export function gridIntensity(provider: CloudProvider, region: string): number {
  return GRID_INTENSITY_KG_PER_KWH[provider]?.[region] ?? DEFAULT_GRID_INTENSITY_KG_PER_KWH;
}

/**
 * Register an on-prem region → grid intensity mapping at startup. Callers
 * that instantiate an on-prem energy model should also call this so the
 * caller-side intensity multiplication picks up the right number.
 */
export function registerOnPremGridIntensity(region: string, kgPerKwh: number): void {
  GRID_INTENSITY_KG_PER_KWH.onprem[region] = kgPerKwh;
}

import type { CloudProvider } from "../../types.js";
import type { EnergyModel } from "../energyModel.js";
import { awsEnergyModel } from "./aws.js";

const registry: Partial<Record<CloudProvider, EnergyModel>> = {
  aws: awsEnergyModel,
};

export function energyModelFor(provider: CloudProvider): EnergyModel | undefined {
  return registry[provider];
}

/**
 * Register an EnergyModel for a provider. Used by on-prem callers who
 * construct a model from a hardware profile at startup (there's no static
 * table for on-prem — every deployment has its own hardware inventory).
 */
export function registerEnergyModel(model: EnergyModel): void {
  registry[model.provider] = model;
}

export { gridIntensity, registerOnPremGridIntensity } from "./grid.js";

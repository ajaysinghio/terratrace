// Illustrative, approximate public equivalency factors (rough EPA-style
// rules of thumb), used only to give a human-relatable sense of scale.
// These are NOT tied to the placeholder methodology in carbonMath.ts and
// should never be presented as precise or audit-grade.
const KG_CO2_PER_KM_DRIVEN = 0.251; // average passenger car, ~404 g/mile
const KG_CO2_PER_SMARTPHONE_CHARGE = 0.0082; // ~1 kg CO2 per ~121 charges
const KG_CO2_ABSORBED_PER_TREE_DAY = 0.0575; // ~21 kg CO2/year per mature tree

export interface EnvironmentalEquivalents {
  kmDriven: number;
  smartphoneCharges: number;
  treeDaysToOffset: number;
}

export function computeEquivalents(kgCO2e: number): EnvironmentalEquivalents {
  return {
    kmDriven: kgCO2e / KG_CO2_PER_KM_DRIVEN,
    smartphoneCharges: kgCO2e / KG_CO2_PER_SMARTPHONE_CHARGE,
    treeDaysToOffset: kgCO2e / KG_CO2_ABSORBED_PER_TREE_DAY,
  };
}

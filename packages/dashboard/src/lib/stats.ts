import type { EnrichedFinding, Severity } from "@terratrace/core";

export const SEVERITY_WEIGHT: Record<Severity, number> = {
  low: 1,
  medium: 3,
  high: 6,
};

export const SEVERITY_COLOR: Record<Severity, string> = {
  low: "#3fb950",
  medium: "#d29922",
  high: "#f85149",
};

export interface SeverityCount {
  severity: Severity;
  count: number;
  color: string;
}

export interface FileImpact {
  filePath: string;
  count: number;
  impactScore: number;
  dominantSeverity: Severity;
  bySeverity: Record<Severity, number>;
}

export interface RuleCount {
  ruleId: string;
  count: number;
}

export interface CarbonByFile {
  filePath: string;
  kgCO2e: number;
}

export interface DashboardStats {
  total: number;
  filesAffected: number;
  totalKgCO2e: number | null;
  totalCostUsd: number | null;
  fixedCount: number;
  hasCarbonEstimate: boolean;
  carbonMethodology: string | null;
  carbonConfidence: string | null;
  avgGridIntensityGco2PerKwh: number | null;
  carbonByFile: CarbonByFile[];
  severityCounts: SeverityCount[];
  fileImpacts: FileImpact[];
  ruleCounts: RuleCount[];
}

function dominantSeverityOf(bySeverity: Record<Severity, number>): Severity {
  let winner: Severity = "low";
  let winnerWeight = -1;
  for (const severity of ["low", "medium", "high"] as Severity[]) {
    const weight = bySeverity[severity] * SEVERITY_WEIGHT[severity];
    if (weight > winnerWeight) {
      winnerWeight = weight;
      winner = severity;
    }
  }
  return winner;
}

export function computeStats(findings: EnrichedFinding[]): DashboardStats {
  const severityCounts: Record<Severity, number> = { low: 0, medium: 0, high: 0 };
  const fileMap = new Map<string, Record<Severity, number>>();
  const ruleMap = new Map<string, number>();
  const carbonByFileMap = new Map<string, number>();
  let totalKgCO2e = 0;
  let totalCostUsd = 0;
  let fixedCount = 0;
  let hasCarbonEstimate = false;
  let carbonMethodology: string | null = null;
  let carbonConfidence: string | null = null;
  let weightedIntensitySum = 0;

  for (const finding of findings) {
    severityCounts[finding.severity] += 1;
    ruleMap.set(finding.ruleId, (ruleMap.get(finding.ruleId) ?? 0) + 1);
    if (finding.idempotencyKey) fixedCount += 1;

    if (!fileMap.has(finding.filePath)) {
      fileMap.set(finding.filePath, { low: 0, medium: 0, high: 0 });
    }
    fileMap.get(finding.filePath)![finding.severity] += 1;

    if (finding.estimate) {
      hasCarbonEstimate = true;
      totalKgCO2e += finding.estimate.kgCO2e;
      // ?? 0 guards scan-output written before costUsd existed on the
      // estimate shape — without it, one legacy record's `undefined` turns
      // the whole running sum into NaN (NaN, unlike null/undefined, isn't
      // caught by `??` and silently poisons every += after it).
      totalCostUsd += finding.estimate.costUsd ?? 0;
      carbonByFileMap.set(finding.filePath, (carbonByFileMap.get(finding.filePath) ?? 0) + finding.estimate.kgCO2e);
      weightedIntensitySum += finding.estimate.kgCO2e * finding.estimate.gridIntensityGco2PerKwh;
      carbonMethodology = finding.estimate.methodology;
      carbonConfidence = finding.estimate.confidence;
    }
  }

  const fileImpacts: FileImpact[] = Array.from(fileMap.entries())
    .map(([filePath, bySeverity]) => {
      const count = bySeverity.low + bySeverity.medium + bySeverity.high;
      const impactScore =
        bySeverity.low * SEVERITY_WEIGHT.low +
        bySeverity.medium * SEVERITY_WEIGHT.medium +
        bySeverity.high * SEVERITY_WEIGHT.high;
      return {
        filePath,
        count,
        impactScore,
        dominantSeverity: dominantSeverityOf(bySeverity),
        bySeverity,
      };
    })
    .sort((a, b) => b.impactScore - a.impactScore);

  return {
    total: findings.length,
    filesAffected: fileMap.size,
    totalKgCO2e: hasCarbonEstimate ? totalKgCO2e : null,
    totalCostUsd: hasCarbonEstimate ? totalCostUsd : null,
    fixedCount,
    hasCarbonEstimate,
    carbonMethodology,
    carbonConfidence,
    avgGridIntensityGco2PerKwh: hasCarbonEstimate && totalKgCO2e > 0 ? weightedIntensitySum / totalKgCO2e : null,
    carbonByFile: Array.from(carbonByFileMap.entries())
      .map(([filePath, kgCO2e]) => ({ filePath, kgCO2e }))
      .sort((a, b) => b.kgCO2e - a.kgCO2e),
    severityCounts: (["high", "medium", "low"] as Severity[]).map((severity) => ({
      severity,
      count: severityCounts[severity],
      color: SEVERITY_COLOR[severity],
    })),
    fileImpacts,
    ruleCounts: Array.from(ruleMap.entries())
      .map(([ruleId, count]) => ({ ruleId, count }))
      .sort((a, b) => b.count - a.count),
  };
}


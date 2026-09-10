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

/** One row of the Middle Management "is cost concentrated or spread out"
 * matrix — same three counts/totals as severityCounts, but carrying cost and
 * carbon too so the view can show $/finding, not just occurrence counts. */
export interface CostBySeverity {
  severity: Severity;
  count: number;
  totalCostUsd: number;
  totalKgCO2e: number;
}

/** Findings grouped by their immediate parent directory — a proxy for
 * "which part of the codebase/team owns this," independent of language (a
 * Python and a Java file both under an `orders/` folder land in the same
 * bucket). Used by the Middle Management "impact by domain" chart. */
export interface DomainImpact {
  domain: string;
  count: number;
  kgCO2e: number;
  costUsd: number;
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
  costBySeverity: CostBySeverity[];
  domainImpacts: DomainImpact[];
  severityCounts: SeverityCount[];
  fileImpacts: FileImpact[];
  ruleCounts: RuleCount[];
}

export function domainOf(filePath: string): string {
  const segments = filePath.split("/").filter(Boolean);
  segments.pop(); // drop the filename itself
  return segments[segments.length - 1] ?? "(root)";
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
  const costBySeverityMap: Record<Severity, { count: number; totalCostUsd: number; totalKgCO2e: number }> = {
    low: { count: 0, totalCostUsd: 0, totalKgCO2e: 0 },
    medium: { count: 0, totalCostUsd: 0, totalKgCO2e: 0 },
    high: { count: 0, totalCostUsd: 0, totalKgCO2e: 0 },
  };
  const domainMap = new Map<string, { count: number; kgCO2e: number; costUsd: number }>();
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
    // idempotencyKey is set on every finding (CLI uses it to link even a
    // failed-validation finding to its GitHub advisory Issue), so it can't
    // signal "was this actually fixed" — suggestedFixDiff is only populated
    // when recommendFinding's validation passed, which is the real signal.
    if (finding.suggestedFixDiff) fixedCount += 1;
    costBySeverityMap[finding.severity].count += 1;

    if (!fileMap.has(finding.filePath)) {
      fileMap.set(finding.filePath, { low: 0, medium: 0, high: 0 });
    }
    fileMap.get(finding.filePath)![finding.severity] += 1;

    const domain = domainOf(finding.filePath);
    const domainEntry = domainMap.get(domain) ?? { count: 0, kgCO2e: 0, costUsd: 0 };
    domainEntry.count += 1;

    if (finding.estimate) {
      hasCarbonEstimate = true;
      totalKgCO2e += finding.estimate.kgCO2e;
      // ?? 0 guards scan-output written before costUsd existed on the
      // estimate shape — without it, one legacy record's `undefined` turns
      // the whole running sum into NaN (NaN, unlike null/undefined, isn't
      // caught by `??` and silently poisons every += after it).
      totalCostUsd += finding.estimate.costUsd ?? 0;
      costBySeverityMap[finding.severity].totalKgCO2e += finding.estimate.kgCO2e;
      costBySeverityMap[finding.severity].totalCostUsd += finding.estimate.costUsd ?? 0;
      domainEntry.kgCO2e += finding.estimate.kgCO2e;
      domainEntry.costUsd += finding.estimate.costUsd ?? 0;
      carbonByFileMap.set(finding.filePath, (carbonByFileMap.get(finding.filePath) ?? 0) + finding.estimate.kgCO2e);
      weightedIntensitySum += finding.estimate.kgCO2e * finding.estimate.gridIntensityGco2PerKwh;
      carbonMethodology = finding.estimate.methodology;
      carbonConfidence = finding.estimate.confidence;
    }
    domainMap.set(domain, domainEntry);
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
    costBySeverity: (["high", "medium", "low"] as Severity[]).map((severity) => ({
      severity,
      ...costBySeverityMap[severity],
    })),
    domainImpacts: Array.from(domainMap.entries())
      .map(([domain, v]) => ({ domain, ...v }))
      .sort((a, b) => b.kgCO2e - a.kgCO2e || b.costUsd - a.costUsd),
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


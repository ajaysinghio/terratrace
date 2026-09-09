import { RULE_SERVICE_MAP } from "@terratrace/core/correlate";
import type { EnrichedFinding } from "@terratrace/core";
import { SEVERITY_WEIGHT } from "./stats";

// RULE_SERVICE_MAP comes from the "@terratrace/core/correlate" subpath, not
// the main "@terratrace/core" barrel: the barrel's index.ts re-exports
// PythonAnalyzer, whose module graph reaches tree-sitter's native .node
// binding. Next's bundler (Turbopack) fails outright — for a Server
// Component, not just a "use client" one — if anything on the page's import
// graph resolves to that binding: "asset is not placeable in ESM chunks".
// carbon/correlate.ts's own dependency chain (carbonMath -> coefficients) is
// pure data, so importing it directly sidesteps the analyzer code entirely.
// Don't switch this back to importing RULE_SERVICE_MAP from the barrel.

export interface ServiceImpact {
  service: string;
  count: number;
  kgCO2e: number;
  costUsd: number;
}

export interface Recommendation {
  ruleId: string;
  count: number;
  severity: EnrichedFinding["severity"];
  message: string;
  totalKgCO2e: number;
  totalCostUsd: number;
  filePaths: string[];
}

export interface FixInProgress {
  ruleId: string;
  filePath: string;
  startLine: number;
  idempotencyKey: string;
}

/**
 * Groups findings by the AWS service their rule amplifies (via
 * RULE_SERVICE_MAP), for the Middle Management view's "which service is
 * hurting" chart. Findings whose rule has no service mapping yet are
 * grouped under "Unmapped" rather than silently dropped, so the breakdown's
 * total always matches the finding count.
 */
export function computeServiceBreakdown(findings: EnrichedFinding[]): ServiceImpact[] {
  const byService = new Map<string, { count: number; kgCO2e: number; costUsd: number }>();
  for (const finding of findings) {
    const service = RULE_SERVICE_MAP[finding.ruleId] ?? "Unmapped";
    const entry = byService.get(service) ?? { count: 0, kgCO2e: 0, costUsd: 0 };
    entry.count += 1;
    entry.kgCO2e += finding.estimate?.kgCO2e ?? 0;
    entry.costUsd += finding.estimate?.costUsd ?? 0;
    byService.set(service, entry);
  }
  return Array.from(byService.entries())
    .map(([service, v]) => ({ service, ...v }))
    .sort((a, b) => b.costUsd - a.costUsd || b.kgCO2e - a.kgCO2e || b.count - a.count);
}

/**
 * Deduplicates findings by ruleId into one recommendation per rule — the
 * Middle Management view shouldn't repeat the same fix advice once per
 * occurrence. Sorted by total estimated carbon impact so the highest-value
 * fix leads.
 */
export function computeRecommendations(findings: EnrichedFinding[]): Recommendation[] {
  const byRule = new Map<string, Recommendation>();
  for (const finding of findings) {
    const existing = byRule.get(finding.ruleId);
    if (existing) {
      existing.count += 1;
      existing.totalKgCO2e += finding.estimate?.kgCO2e ?? 0;
      existing.totalCostUsd += finding.estimate?.costUsd ?? 0;
      if (!existing.filePaths.includes(finding.filePath)) existing.filePaths.push(finding.filePath);
      if (SEVERITY_WEIGHT[finding.severity] > SEVERITY_WEIGHT[existing.severity]) existing.severity = finding.severity;
    } else {
      byRule.set(finding.ruleId, {
        ruleId: finding.ruleId,
        count: 1,
        severity: finding.severity,
        message: finding.message,
        totalKgCO2e: finding.estimate?.kgCO2e ?? 0,
        totalCostUsd: finding.estimate?.costUsd ?? 0,
        filePaths: [finding.filePath],
      });
    }
  }
  return Array.from(byRule.values()).sort((a, b) => b.totalCostUsd - a.totalCostUsd || b.totalKgCO2e - a.totalKgCO2e || b.count - a.count);
}

/**
 * Findings that already carry an idempotencyKey are trackable on GitHub (the
 * Action labels its fix PR / advisory Issue with `terratrace:<key>`) — this
 * is the Middle Management view's "fixes in progress" list. It only lists
 * them; resolving each one's actual PR/Issue state needs a live GitHub API
 * call this dashboard doesn't make yet (see the project board for that as a
 * follow-up), so today it's a worklist, not a live status feed.
 */
export function computeFixesInProgress(findings: EnrichedFinding[]): FixInProgress[] {
  return findings
    .filter((f): f is EnrichedFinding & { idempotencyKey: string } => Boolean(f.idempotencyKey))
    .map((f) => ({
      ruleId: f.ruleId,
      filePath: f.filePath,
      startLine: f.startLine,
      idempotencyKey: f.idempotencyKey,
    }));
}

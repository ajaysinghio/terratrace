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
  prUrl: string;
  severity: EnrichedFinding["severity"];
}

/**
 * Groups findings by the AWS service their rule amplifies (via
 * RULE_SERVICE_MAP), for the Middle Management view's "which service is
 * hurting" chart. Findings whose rule has no service mapping yet are
 * grouped under "Unmapped" rather than silently dropped, so the breakdown's
 * total always matches the finding count.
 */
export function computeServiceBreakdown(findings: Pick<EnrichedFinding, "ruleId" | "estimate">[]): ServiceImpact[] {
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
    .sort((a, b) => b.kgCO2e - a.kgCO2e || b.costUsd - a.costUsd || b.count - a.count);
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
  return Array.from(byRule.values()).sort((a, b) => b.totalKgCO2e - a.totalKgCO2e || b.totalCostUsd - a.totalCostUsd || b.count - a.count);
}

/**
 * Findings with an actually-opened PR (prUrl set) — the Middle Management
 * view's "fixes in progress" list. "In progress" means exactly that: a PR
 * is open, not yet merged. idempotencyKey is set on every finding
 * regardless of remediation state, so it can't be the signal here (a past
 * bug: this used to filter on idempotencyKey and listed every finding).
 * Once a rescan confirms the underlying code is gone, the finding moves to
 * remediated_at (see db.ts) and drops out of the active findings this
 * function ever sees at all, so it naturally leaves this list too.
 */
export function computeFixesInProgress(findings: EnrichedFinding[]): FixInProgress[] {
  return findings
    .filter((f): f is EnrichedFinding & { idempotencyKey: string; prUrl: string } => Boolean(f.prUrl))
    .map((f) => ({
      ruleId: f.ruleId,
      filePath: f.filePath,
      startLine: f.startLine,
      idempotencyKey: f.idempotencyKey ?? "",
      prUrl: f.prUrl,
      severity: f.severity,
    }));
}

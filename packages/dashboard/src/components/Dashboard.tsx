"use client";

import type { EnrichedFinding } from "@terratrace/core";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { computeEquivalents } from "../lib/equivalents";
import RemediateButton from "./RemediateButton";
import type { FixInProgress, Recommendation, ServiceImpact } from "../lib/roleStats";
import { computeStats, domainOf, SEVERITY_COLOR, SEVERITY_WEIGHT, type DomainImpact } from "../lib/stats";
import { ROLE_RANK, type Role } from "../lib/role";
import { formatUsd, shortPath } from "../lib/format";
import type { ImpactBarDatum } from "./Charts";

const SEVERITY_LABEL: Record<"high" | "medium" | "low", string> = { high: "High", medium: "Medium", low: "Low" };

const DOMAIN_ICON: Record<string, string> = {
  terraform: "🏗️",
  infra: "🏗️",
  billing: "💳",
  orders: "🧾",
  inventory: "📦",
  storage: "🗄️",
  reports: "📊",
  analytics: "📈",
};
function iconForDomain(domain: string): string {
  return DOMAIN_ICON[domain.toLowerCase()] ?? "📁";
}

function findingLabelUrl(repoUrl: string | undefined, idempotencyKey: string | undefined): string | undefined {
  if (!repoUrl || !idempotencyKey) return undefined;
  const label = `terratrace:${idempotencyKey}`;
  return `${repoUrl}/labels/${encodeURIComponent(label)}`;
}

/** DOM id for a file's row in FileFindingsList — lets the heatmap scroll to
 * and expand the matching row on click instead of the two widgets being
 * disconnected. */
function fileRowId(filePath: string): string {
  return `file-row-${filePath.replace(/[^a-zA-Z0-9]/g, "-")}`;
}

function StatTile({ label, value, accent, href }: { label: string; value: string; accent?: string; href?: string }) {
  const content = (
    <>
      <div className="stat-tile__value" style={accent ? { color: accent } : undefined}>
        {value}
      </div>
      <div className="stat-tile__label">{label}</div>
    </>
  );
  if (href) {
    return (
      <Link href={href} className="stat-tile stat-tile--clickable">
        {content}
      </Link>
    );
  }
  return <div className="stat-tile">{content}</div>;
}

function EnvironmentalImpact({ totalKgCO2e }: { totalKgCO2e: number }) {
  const eq = computeEquivalents(totalKgCO2e);
  return (
    <div className="equiv-grid">
      <div className="equiv-tile">
        <div className="equiv-tile__value">🚗 {eq.kmDriven.toFixed(1)} km</div>
        <div className="equiv-tile__label">equivalent car travel</div>
      </div>
      <div className="equiv-tile">
        <div className="equiv-tile__value">📱 {Math.round(eq.smartphoneCharges)}</div>
        <div className="equiv-tile__label">smartphone charges</div>
      </div>
      <div className="equiv-tile">
        <div className="equiv-tile__value">🌳 {eq.treeDaysToOffset.toFixed(1)}</div>
        <div className="equiv-tile__label">tree-days to offset</div>
      </div>
    </div>
  );
}

const ChartPlaceholder = () => <div className="empty-chart" aria-busy="true" />;

const SeverityDonut = dynamic(() => import("./Charts").then((m) => m.SeverityDonut), { loading: ChartPlaceholder });
const FileHeatmap = dynamic(() => import("./Charts").then((m) => m.FileHeatmap), { loading: ChartPlaceholder });
const CarbonByFileChart = dynamic(() => import("./Charts").then((m) => m.CarbonByFileChart), {
  loading: ChartPlaceholder,
});
export const ImpactBarChart = dynamic(() => import("./Charts").then((m) => m.ImpactBarChart), {
  loading: ChartPlaceholder,
});
export type { ImpactBarDatum };

export function ServiceBreakdownChart({
  data,
  hrefForService,
}: {
  data: ServiceImpact[];
  hrefForService?: (service: string) => string;
}) {
  return (
    <ImpactBarChart
      data={data.map((d) => ({
        label: d.service,
        count: d.count,
        kgCO2e: d.kgCO2e,
        costUsd: d.costUsd,
        href: hrefForService?.(d.service),
      }))}
    />
  );
}

function recoRowId(ruleId: string): string {
  return `reco-${ruleId.replace(/[^a-zA-Z0-9]/g, "-")}`;
}

export function RecommendationsList({
  recommendations,
  focusedRuleId,
}: {
  recommendations: Recommendation[];
  focusedRuleId?: string | null;
}) {
  useEffect(() => {
    if (focusedRuleId) {
      document.getElementById(recoRowId(focusedRuleId))?.scrollIntoView({ block: "start", behavior: "smooth" });
    }
    // Only ever seed from the URL once per navigation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusedRuleId]);

  if (recommendations.length === 0) {
    return <div className="empty-chart">No recommendations yet.</div>;
  }
  return (
    <ul className="reco-list">
      {recommendations.map((r) => (
        <li
          key={r.ruleId}
          id={recoRowId(r.ruleId)}
          className={`reco${r.ruleId === focusedRuleId ? " reco--focused" : ""}`}
          style={{ borderLeftColor: SEVERITY_COLOR[r.severity] }}
        >
          <div className="reco__header">
            <span className="finding__rule">{r.ruleId}</span>
            <span className="reco__count">
              {r.totalKgCO2e > 0 && <>{r.totalKgCO2e.toFixed(3)} kgCO2e · </>}
              {r.count} occurrence{r.count === 1 ? "" : "s"} · {r.filePaths.length} file
              {r.filePaths.length === 1 ? "" : "s"}
              {r.totalCostUsd > 0 && <> · {formatUsd(r.totalCostUsd)}/mo</>}
            </span>
          </div>
          <p className="finding__message">{r.message}</p>
        </li>
      ))}
    </ul>
  );
}

interface FixRuleGroup {
  ruleId: string;
  fixes: FixInProgress[];
  dominantSeverity: FixInProgress["severity"];
}

function groupFixesByRule(fixes: FixInProgress[]): FixRuleGroup[] {
  const byRule = new Map<string, FixRuleGroup>();
  for (const f of fixes) {
    const existing = byRule.get(f.ruleId);
    if (existing) {
      existing.fixes.push(f);
      if (SEVERITY_WEIGHT[f.severity] > SEVERITY_WEIGHT[existing.dominantSeverity]) {
        existing.dominantSeverity = f.severity;
      }
    } else {
      byRule.set(f.ruleId, { ruleId: f.ruleId, fixes: [f], dominantSeverity: f.severity });
    }
  }
  return Array.from(byRule.values()).sort(
    (a, b) =>
      SEVERITY_WEIGHT[b.dominantSeverity] - SEVERITY_WEIGHT[a.dominantSeverity] ||
      b.fixes.length - a.fixes.length ||
      a.ruleId.localeCompare(b.ruleId),
  );
}

export function FixesInProgressList({
  fixes,
  projectId,
  role,
}: {
  fixes: FixInProgress[];
  projectId: string;
  role: Role;
}) {
  const groups = groupFixesByRule(fixes);

  if (groups.length === 0) {
    return <div className="empty-chart">No fixes tracked yet — findings need a validated fix run first.</div>;
  }

  return (
    <div className="file-list">
      {groups.map((g) => {
        const href = `/projects/${projectId}/files?view=${role}&rule=${encodeURIComponent(g.ruleId)}`;
        return (
          <Link key={g.ruleId} href={href} className="file-group__header file-group__header--link">
            <span className="badge" style={{ background: SEVERITY_COLOR[g.dominantSeverity] }}>
              {g.dominantSeverity}
            </span>
            <span className="fix-group__rule" style={{ color: SEVERITY_COLOR[g.dominantSeverity] }}>
              {g.ruleId}
            </span>
            <span className="file-group__meta">
              {g.fixes.length} fix{g.fixes.length === 1 ? "" : "es"}
            </span>
            <span className="file-group__chevron">→</span>
          </Link>
        );
      })}
    </div>
  );
}

/**
 * "How much of this can a manager just merge vs. still needs an engineer's
 * attention" — total findings narrowing down to how many already carry a
 * validated fix diff (suggestedFixDiff, set only when recommendFinding's
 * validation passed). Deliberately not a recharts chart: three plain rows
 * read faster than a chart for a number this simple.
 */
export function RemediationFunnel({ total, validated }: { total: number; validated: number }) {
  if (total === 0) {
    return <div className="empty-chart">No findings to chart.</div>;
  }
  const needsAttention = total - validated;
  const stages = [
    { label: "Total findings", count: total, share: 1, color: "#58a6ff" },
    { label: "Fix ready to merge", count: validated, share: validated / total, color: SEVERITY_COLOR.low },
    {
      label: "Needs engineering review",
      count: needsAttention,
      share: needsAttention / total,
      color: SEVERITY_COLOR.medium,
    },
  ];
  return (
    <div className="funnel">
      {stages.map((s) => (
        <div key={s.label} className="funnel__stage">
          <div className="funnel__track">
            <div className="funnel__fill" style={{ width: `${s.share * 100}%`, background: s.color }} />
          </div>
          <div className="funnel__meta">
            <span className="funnel__label">{s.label}</span>
            <span className="funnel__count">
              {s.count} <span className="funnel__pct">({Math.round(s.share * 100)}%)</span>
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Answers "is our exposure a few expensive findings or a lot of cheap ones"
 * — each severity tier's total $/mo share of the bar plus its average cost
 * per finding, so a manager can tell a handful of high-severity findings
 * apart from a long tail of low-severity ones at a glance.
 */
export function SeverityCostMatrix({ stats }: { stats: ReturnType<typeof computeStats> }) {
  const rows = stats.costBySeverity.filter((r) => r.count > 0);
  const maxCost = Math.max(...rows.map((r) => r.totalCostUsd), 0);
  if (rows.length === 0 || maxCost === 0) {
    return <div className="empty-chart">No cost data to chart yet.</div>;
  }
  return (
    <div className="matrix">
      {rows.map((r) => (
        <div key={r.severity} className="matrix__row">
          <div className="matrix__label">
            <span className="badge" style={{ background: SEVERITY_COLOR[r.severity] }}>
              {SEVERITY_LABEL[r.severity]}
            </span>
            <span className="matrix__count">
              {r.count} finding{r.count === 1 ? "" : "s"}
            </span>
          </div>
          <div className="matrix__track">
            <div
              className="matrix__fill"
              style={{ width: `${(r.totalCostUsd / maxCost) * 100}%`, background: SEVERITY_COLOR[r.severity] }}
            />
          </div>
          <div className="matrix__value">
            {formatUsd(r.totalCostUsd)}/mo
            <span className="matrix__avg"> · {formatUsd(r.totalCostUsd / r.count)}/finding avg</span>
          </div>
        </div>
      ))}
    </div>
  );
}

interface DomainRuleImpact {
  ruleId: string;
  count: number;
  severity: EnrichedFinding["severity"];
  message: string;
  totalKgCO2e: number;
  totalCostUsd: number;
}

// A domain-scoped variant of the same "one row per rule" shape roleStats.ts's
// computeRecommendations produces — that one is computed server-side for the
// WHOLE project's Recommendations prop; this recomputes it client-side, just
// for whichever domain is currently expanded, from the findings already in
// the browser (no server round-trip needed to drill into a domain).
function groupFindingsByRule(findings: EnrichedFinding[]): DomainRuleImpact[] {
  const byRule = new Map<string, DomainRuleImpact>();
  for (const f of findings) {
    const existing = byRule.get(f.ruleId);
    if (existing) {
      existing.count += 1;
      existing.totalKgCO2e += f.estimate?.kgCO2e ?? 0;
      existing.totalCostUsd += f.estimate?.costUsd ?? 0;
      if (SEVERITY_WEIGHT[f.severity] > SEVERITY_WEIGHT[existing.severity]) existing.severity = f.severity;
    } else {
      byRule.set(f.ruleId, {
        ruleId: f.ruleId,
        count: 1,
        severity: f.severity,
        message: f.message,
        totalKgCO2e: f.estimate?.kgCO2e ?? 0,
        totalCostUsd: f.estimate?.costUsd ?? 0,
      });
    }
  }
  return Array.from(byRule.values()).sort((a, b) => b.totalKgCO2e - a.totalKgCO2e || b.totalCostUsd - a.totalCostUsd);
}

/**
 * Domain/service breakdown as clickable icon chips rather than an
 * always-expanded chart+table — a manager scanning this should see "which
 * domains exist and roughly how big they are" at a glance, and only pay the
 * cost of reading a full per-rule breakdown for the one domain they actually
 * click into.
 */
function DomainExplorer({ findings, domainImpacts }: { findings: EnrichedFinding[]; domainImpacts: DomainImpact[] }) {
  const [selected, setSelected] = useState<string | null>(null);

  if (domainImpacts.length === 0) {
    return <div className="empty-chart">No findings to chart.</div>;
  }

  const selectedImpact = domainImpacts.find((d) => d.domain === selected);
  const domainFindings = selectedImpact ? findings.filter((f) => domainOf(f.filePath) === selectedImpact.domain) : [];
  const rules = selectedImpact ? groupFindingsByRule(domainFindings) : [];

  return (
    <div className="domain-explorer">
      <div className="domain-chips">
        {domainImpacts.map((d) => (
          <button
            key={d.domain}
            type="button"
            className={`domain-chip${d.domain === selected ? " domain-chip--active" : ""}`}
            onClick={() => setSelected(d.domain === selected ? null : d.domain)}
          >
            <span className="domain-chip__icon">{iconForDomain(d.domain)}</span>
            <span className="domain-chip__name">{d.domain}</span>
            {d.kgCO2e > 0 && <span className="domain-chip__stat">{d.kgCO2e.toFixed(2)} kg</span>}
          </button>
        ))}
      </div>

      {selectedImpact ? (
        <div className="domain-detail">
          <div className="domain-detail__stats">
            <span>{domainFindings.length} finding(s)</span>
            {selectedImpact.kgCO2e > 0 && <span>{selectedImpact.kgCO2e.toFixed(3)} kgCO2e</span>}
            {selectedImpact.costUsd > 0 && <span>{formatUsd(selectedImpact.costUsd)}/mo</span>}
          </div>
          <ul className="reco-list">
            {rules.map((r) => (
              <li key={r.ruleId} className="reco" style={{ borderLeftColor: SEVERITY_COLOR[r.severity] }}>
                <div className="reco__header">
                  <span className="finding__rule">{r.ruleId}</span>
                  <span className="reco__count">
                    {r.totalKgCO2e > 0 && <>{r.totalKgCO2e.toFixed(3)} kgCO2e · </>}
                    {r.count} occurrence{r.count === 1 ? "" : "s"}
                    {r.totalCostUsd > 0 && <> · {formatUsd(r.totalCostUsd)}/mo</>}
                  </span>
                </div>
                <p className="finding__message">{r.message}</p>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="card__hint domain-explorer__hint">Click a domain above to see its findings and top rules.</p>
      )}
    </div>
  );
}

interface FileGroup {
  filePath: string;
  findings: EnrichedFinding[];
  dominantSeverity: EnrichedFinding["severity"];
  totalKgCO2e: number;
  totalCostUsd: number;
}

function groupFindingsByFile(findings: EnrichedFinding[]): FileGroup[] {
  const byFile = new Map<string, FileGroup>();
  for (const f of findings) {
    const existing = byFile.get(f.filePath);
    if (existing) {
      existing.findings.push(f);
      existing.totalKgCO2e += f.estimate?.kgCO2e ?? 0;
      existing.totalCostUsd += f.estimate?.costUsd ?? 0;
      if (SEVERITY_WEIGHT[f.severity] > SEVERITY_WEIGHT[existing.dominantSeverity]) existing.dominantSeverity = f.severity;
    } else {
      byFile.set(f.filePath, {
        filePath: f.filePath,
        findings: [f],
        dominantSeverity: f.severity,
        totalKgCO2e: f.estimate?.kgCO2e ?? 0,
        totalCostUsd: f.estimate?.costUsd ?? 0,
      });
    }
  }
  const impactOf = (g: FileGroup) => g.findings.reduce((sum, f) => sum + SEVERITY_WEIGHT[f.severity], 0);
  return Array.from(byFile.values()).sort((a, b) => impactOf(b) - impactOf(a));
}

/**
 * The engineer landing view: one compact, clickable row per file instead of
 * every finding pre-expanded with its full snippet/explanation — matches the
 * "GitHub Files changed" mental model engineers already have, and means
 * scanning 20 files costs a glance, not 20 code blocks of scroll.
 */
function FileFindingsList({
  findings,
  repoUrl,
  projectId,
  canRemediate,
  expandedFile,
  onToggleFile,
}: {
  findings: EnrichedFinding[];
  repoUrl?: string;
  projectId: string;
  canRemediate: boolean;
  expandedFile: string | null;
  onToggleFile: (filePath: string) => void;
}) {
  const groups = groupFindingsByFile(findings);
  if (groups.length === 0) {
    return <div className="empty-chart">No findings to show.</div>;
  }
  return (
    <div className="file-list">
      {groups.map((g) => {
        const isOpen = g.filePath === expandedFile;
        return (
          <div key={g.filePath} id={fileRowId(g.filePath)} className="file-group">
            <button type="button" className="file-group__header" onClick={() => onToggleFile(g.filePath)}>
              <span className="badge" style={{ background: SEVERITY_COLOR[g.dominantSeverity] }}>
                {g.dominantSeverity}
              </span>
              <span className="file-group__path">{g.filePath}</span>
              <span className="file-group__meta">
                {g.findings.length} finding{g.findings.length === 1 ? "" : "s"}
                {g.totalKgCO2e > 0 && <> · {g.totalKgCO2e.toFixed(3)} kgCO2e</>}
                {g.totalCostUsd > 0 && <> · {formatUsd(g.totalCostUsd)}/mo</>}
              </span>
              <span className="file-group__chevron">{isOpen ? "▾" : "▸"}</span>
            </button>
            {isOpen && (
              <ul className="findings-list">
                {g.findings.map((finding, i) => (
                  <li
                    key={`${finding.id}:${i}`}
                    className="finding"
                    style={{ borderLeftColor: SEVERITY_COLOR[finding.severity] }}
                  >
                    <div className="finding__header">
                      <span className="badge" style={{ background: SEVERITY_COLOR[finding.severity] }}>
                        {finding.severity}
                      </span>
                      <span className="finding__location">
                        {finding.filePath}:{finding.startLine}-{finding.endLine}
                      </span>
                      <span className="finding__rule">{finding.ruleId}</span>
                    </div>
                    <pre className="finding__snippet">{finding.snippet}</pre>
                    <p className="finding__message">{finding.message}</p>
                    {finding.estimate ? (
                      <p className="finding__message">
                        <strong>Estimated impact:</strong> {finding.estimate.kgCO2e.toFixed(4)} kgCO2e (
                        {finding.estimate.confidence} confidence)
                      </p>
                    ) : (
                      <p className="finding__message finding__message--no-estimate">
                        No billing usage found for this finding&apos;s service yet — recommendation still applies.
                      </p>
                    )}
                    {finding.explanation && (
                      <p className="finding__explanation">
                        <strong>Explanation:</strong> {finding.explanation}
                      </p>
                    )}
                    {finding.prUrl ? (
                      <p className="finding__pr-link">
                        <a href={finding.prUrl} target="_blank" rel="noopener noreferrer">
                          🔵 PR in progress →
                        </a>
                      </p>
                    ) : (
                      (() => {
                        const url = findingLabelUrl(repoUrl, finding.idempotencyKey);
                        return url ? (
                          <p className="finding__pr-link">
                            <a href={url} target="_blank" rel="noopener noreferrer">
                              View PR / advisory Issue on GitHub →
                            </a>
                          </p>
                        ) : null;
                      })()
                    )}
                    {canRemediate && !finding.prUrl && finding.suggestedFixDiff && (
                      <RemediateButton projectId={projectId} findingId={finding.id} label="Create PR for this fix" />
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * The Overview route (/projects/[projectId]) — the landing page every role
 * gets when they click into a project. KPI strip, severity breakdown, and
 * the cost-driver/heatmap charts: the baseline every tier sees, so it earns
 * being one real page instead of a further click away.
 */
export function OverviewSection({
  projectId,
  role,
  stats,
  serviceBreakdown,
  recommendations,
}: {
  projectId: string;
  role: Role;
  stats: ReturnType<typeof computeStats>;
  serviceBreakdown: ServiceImpact[];
  recommendations: Recommendation[];
}) {
  const router = useRouter();
  const rank = ROLE_RANK[role];

  function filesHref(severity?: EnrichedFinding["severity"]): string {
    const params = new URLSearchParams({ view: role });
    if (severity) params.set("severity", severity);
    return `/projects/${projectId}/files?${params.toString()}`;
  }

  function selectFile(filePath: string) {
    router.push(`/projects/${projectId}/files?view=${role}&file=${encodeURIComponent(filePath)}`);
  }

  const highCount = stats.severityCounts.find((s) => s.severity === "high")?.count ?? 0;
  const remediationPct = stats.total > 0 ? Math.round((stats.fixedCount / stats.total) * 100) : 0;

  function serviceHref(service: string): string {
    const params = new URLSearchParams({ view: role, service });
    return `/projects/${projectId}/files?${params.toString()}`;
  }

  return (
    <>
      <section className="exec-hero card">
        <h2 className="exec-hero__title">Eco-Impact Overview</h2>
        <div className="exec-hero__primary">
          <div className="exec-hero__metric">
            <div className="exec-hero__value" style={{ color: "#d29922" }}>
              {stats.totalCostUsd ? `${formatUsd(stats.totalCostUsd)}/mo` : "—"}
            </div>
            <div className="exec-hero__label">estimated cost impact</div>
          </div>
          <div className="exec-hero__divider" aria-hidden />
          <div className="exec-hero__metric">
            <div className="exec-hero__value" style={{ color: "#3fb950" }}>
              {stats.hasCarbonEstimate ? `${stats.totalKgCO2e!.toFixed(3)} kgCO2e` : "—"}
            </div>
            <div className="exec-hero__label">estimated carbon footprint</div>
          </div>
        </div>
        <div className="exec-hero__pills">
          <Link href={filesHref()} className="exec-hero__pill">
            📄 <strong>{stats.filesAffected}</strong> File{stats.filesAffected === 1 ? "" : "s"}
          </Link>
          {stats.hasCarbonEstimate &&
            (() => {
              const eq = computeEquivalents(stats.totalKgCO2e!);
              return (
                <>
                  <span className="exec-hero__pill" title="Equivalent car travel">
                    🚗 <strong>{eq.kmDriven.toFixed(1)}</strong> km
                  </span>
                  <span className="exec-hero__pill" title="Equivalent smartphone charges">
                    ⚡ <strong>{Math.round(eq.smartphoneCharges)}</strong> Charges
                  </span>
                  <span className="exec-hero__pill" title="Tree-days to offset">
                    🌳 <strong>{eq.treeDaysToOffset.toFixed(1)}</strong> Tree-days
                  </span>
                </>
              );
            })()}
          {highCount > 0 && (
            <Link
              href={filesHref("high")}
              className="exec-hero__pill exec-hero__pill--danger"
            >
              🚨 <strong>{highCount}</strong> High Severity ({stats.total} Total)
            </Link>
          )}
        </div>
      </section>

      <section className="chart-grid">
        <div className="card">
          <h2>Severity breakdown</h2>
          <SeverityDonut
            stats={stats}
            onSelectSeverity={(severity) => router.push(filesHref(severity))}
          />
          <div className="legend">
            {stats.severityCounts.map((s) =>
              s.count > 0 ? (
                <Link
                  key={s.severity}
                  href={filesHref(s.severity)}
                  className="legend__item legend__item--clickable"
                >
                  <span className="legend__swatch" style={{ background: s.color }} />
                  {s.severity} ({s.count})
                </Link>
              ) : (
                <span key={s.severity} className="legend__item">
                  <span className="legend__swatch" style={{ background: s.color }} />
                  {s.severity} ({s.count})
                </span>
              ),
            )}
          </div>
        </div>

        <div className="card card--wide">
          <h2>Top carbon drivers by service</h2>
          <p className="card__hint">
            Which AWS service each rule&apos;s findings amplify. Click a bar to open its findings.
          </p>
          <ServiceBreakdownChart data={serviceBreakdown} hrefForService={serviceHref} />
        </div>
      </section>

      <section className="card exec-remediation">
        <div className="exec-remediation__meta">
          <div>
            <strong>Remediation Progress</strong>
          </div>
          <div className="exec-remediation__counter">
            <span className="exec-remediation__count">
              {stats.fixedCount}/{stats.total}
            </span>
          </div>
        </div>
        <div className="exec-remediation__track">
          <div
            className="exec-remediation__fill"
            style={{ width: `${Math.max(remediationPct, 4)}%`, background: remediationPct > 0 ? "#3fb950" : "#58a6ff" }}
          />
        </div>
        <div className="exec-remediation__footer">
          <span className="card__hint" style={{ margin: 0 }}>
            {remediationPct}% of {stats.total} finding{stats.total === 1 ? "" : "s"} validated and ready to merge.
          </span>
          {stats.total > 0 && (
            <Link href={filesHref()} className="button button--primary">
              Review findings →
            </Link>
          )}
        </div>
      </section>

      {rank >= ROLE_RANK.engineer && stats.fileImpacts.length > 0 && (
        <section className="card">
          <h2>Where carbon & cost are concentrated</h2>
          <p className="card__hint">
            Box size = weighted severity impact, color = dominant severity in that file. Click a box to open that
            file&apos;s findings.
          </p>
          <FileHeatmap fileImpacts={stats.fileImpacts} onSelectFile={selectFile} />
        </section>
      )}

      {rank >= ROLE_RANK.manager && (
        <div className="callout">
          {stats.domainImpacts[0] && (
            <Link href={`/projects/${projectId}/domain?view=${role}`} className="callout__item">
              <span className="callout__icon">{iconForDomain(stats.domainImpacts[0].domain)}</span>
              <strong>{stats.domainImpacts[0].domain}</strong> is your biggest domain (
              {stats.domainImpacts[0].kgCO2e.toFixed(2)} kgCO2e)
            </Link>
          )}

          {recommendations[0] && (
            <Link href={`/projects/${projectId}/recommendations?view=${role}`} className="callout__item">
              <span className="callout__icon">💡</span>
              <strong>{recommendations[0].ruleId}</strong> is costing the most
            </Link>
          )}

          <Link href={`/projects/${projectId}/remediation?view=${role}`} className="callout__item">
            <span className="callout__icon">🔻</span>
            {stats.fixedCount} of {stats.total} findings ready to merge
          </Link>

          {rank >= ROLE_RANK.engineer && stats.total - stats.fixedCount > 0 && (
            <Link href={`/projects/${projectId}/files?view=${role}`} className="callout__item">
              <span className="callout__icon">📄</span>
              {stats.total - stats.fixedCount} finding(s) need an engineer
            </Link>
          )}
        </div>
      )}
    </>
  );
}

/** The /projects/[projectId]/domain route (manager+). */
export function DomainSection({
  findings,
  domainImpacts,
}: {
  findings: EnrichedFinding[];
  domainImpacts: DomainImpact[];
}) {
  return (
    <section className="card">
      <h2>Impact by domain</h2>
      <p className="card__hint">Click a domain to see its findings and top rules — nothing else drills in by default.</p>
      <DomainExplorer findings={findings} domainImpacts={domainImpacts} />
    </section>
  );
}

/** The /projects/[projectId]/remediation route (manager+). */
export function RemediationSection({ stats }: { stats: ReturnType<typeof computeStats> }) {
  return (
    <section className="chart-grid">
      <div className="card">
        <h2>Remediation funnel</h2>
        <p className="card__hint">How much of this is already a mergeable fix vs. still needs an engineer.</p>
        <RemediationFunnel total={stats.total} validated={stats.fixedCount} />
      </div>

      <div className="card card--wide">
        <h2>Is impact concentrated or spread out?</h2>
        <p className="card__hint">Cost share by severity — a few expensive findings vs. many cheap ones.</p>
        <SeverityCostMatrix stats={stats} />
      </div>
    </section>
  );
}

/** The /projects/[projectId]/recommendations route (manager+). */
export function RecommendationsSection({
  stats,
  recommendations,
  focusedRuleId,
}: {
  stats: ReturnType<typeof computeStats>;
  recommendations: Recommendation[];
  focusedRuleId?: string | null;
}) {
  return (
    <section className="chart-grid">
      <div className="card">
        <h2>Recommendations</h2>
        <p className="card__hint">One entry per rule, highest carbon impact first.</p>
        <RecommendationsList recommendations={recommendations} focusedRuleId={focusedRuleId} />
      </div>

      {stats.hasCarbonEstimate && (
        <div className="card card--wide">
          <h2>Carbon emissions by file</h2>
          <p className="card__hint">
            {stats.carbonMethodology === "ccf-derived" ? "CCF-derived" : stats.carbonMethodology} estimate,{" "}
            <strong style={{ color: stats.carbonConfidence === "low" ? "#d29922" : undefined }}>
              {stats.carbonConfidence} confidence
            </strong>{" "}
            — placeholder energy coefficients, not audit-grade (see carbonMath.ts).
            {stats.avgGridIntensityGco2PerKwh && (
              <> Avg. grid intensity used: {stats.avgGridIntensityGco2PerKwh.toFixed(0)} gCO2/kWh.</>
            )}
          </p>
          <CarbonByFileChart stats={stats} />
        </div>
      )}
    </section>
  );
}

/** The /projects/[projectId]/fixes route (manager+). */
export function FixesSection({
  projectId,
  role,
  fixesInProgress,
}: {
  projectId: string;
  role: Role;
  fixesInProgress: FixInProgress[];
}) {
  return (
    <section className="card">
      <h2>Fixes in progress</h2>
      <p className="card__hint">Grouped by rule. Click a rule to see its recommendation and the files it affects.</p>
      <FixesInProgressList fixes={fixesInProgress} projectId={projectId} role={role} />
    </section>
  );
}

/**
 * The /projects/[projectId]/files route (engineer+). `initialExpandedFile`
 * seeds from the Overview heatmap's ?file= link so clicking a heatmap box
 * lands here with that file already open, instead of a bare file list.
 */
export function FilesSection({
  findings,
  repoUrl,
  projectId,
  canRemediate,
  initialExpandedFile,
  severityFilter,
  fileFilter,
  serviceFilter,
  ruleFilter,
}: {
  findings: EnrichedFinding[];
  repoUrl?: string;
  projectId: string;
  /** Manager/Engineer only — remediation writes real PRs, not something every role should trigger. */
  canRemediate: boolean;
  initialExpandedFile: string | null;
  severityFilter?: EnrichedFinding["severity"] | null;
  fileFilter?: string | null;
  serviceFilter?: string | null;
  ruleFilter?: string | null;
}) {
  const [expandedFile, setExpandedFile] = useState<string | null>(initialExpandedFile);
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (initialExpandedFile) {
      document.getElementById(fileRowId(initialExpandedFile))?.scrollIntoView({ block: "start" });
    }
    // Only ever seed from the URL once, on the page's first render — an
    // in-page toggle afterwards shouldn't get overridden if this effect
    // somehow re-ran.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hasFilter = Boolean(severityFilter || fileFilter || serviceFilter || ruleFilter);
  const clearFiltersHref = useMemo(() => {
    const next = new URLSearchParams(searchParams);
    next.delete("severity");
    next.delete("file");
    next.delete("service");
    next.delete("rule");
    const qs = next.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  }, [pathname, searchParams]);

  return (
    <section className="card">
      <div className="files-heading">
        <h2>Findings by file</h2>
        {severityFilter && (
          <span className="files-heading__filter">
            <span className="badge" style={{ background: SEVERITY_COLOR[severityFilter] }}>
              {SEVERITY_LABEL[severityFilter]}
            </span>
            only
          </span>
        )}
        {fileFilter && <span className="files-heading__filter">file: {fileFilter}</span>}
        {serviceFilter && <span className="files-heading__filter">service: {serviceFilter}</span>}
        {ruleFilter && <span className="files-heading__filter">rule: {ruleFilter}</span>}
      </div>
      <p className="card__hint">
        Click a file to expand its findings.
        {hasFilter && (
          <>
            {" "}
            <Link href={clearFiltersHref} scroll={false} replace className="files-heading__clear">
              Show all files
            </Link>
          </>
        )}
      </p>
      <FileFindingsList
        findings={findings}
        repoUrl={repoUrl}
        projectId={projectId}
        canRemediate={canRemediate}
        expandedFile={expandedFile}
        onToggleFile={(filePath) => setExpandedFile(expandedFile === filePath ? null : filePath)}
      />
    </section>
  );
}

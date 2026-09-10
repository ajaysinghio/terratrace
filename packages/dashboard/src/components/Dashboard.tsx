"use client";

import type { EnrichedFinding } from "@terratrace/core";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  Treemap,
  XAxis,
  YAxis,
} from "recharts";
import { computeEquivalents } from "../lib/equivalents";
import type { FixInProgress, Recommendation, ServiceImpact } from "../lib/roleStats";
import { computeStats, domainOf, SEVERITY_COLOR, SEVERITY_WEIGHT, type DomainImpact, type FileImpact } from "../lib/stats";
import { ROLE_RANK, type Role } from "../lib/role";

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

function shortPath(filePath: string): string {
  return filePath.split("/").pop() ?? filePath;
}

/** DOM id for a file's row in FileFindingsList — lets the heatmap scroll to
 * and expand the matching row on click instead of the two widgets being
 * disconnected. */
function fileRowId(filePath: string): string {
  return `file-row-${filePath.replace(/[^a-zA-Z0-9]/g, "-")}`;
}

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
function formatUsd(value: number): string {
  return usd.format(value);
}

function StatTile({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="stat-tile">
      <div className="stat-tile__value" style={accent ? { color: accent } : undefined}>
        {value}
      </div>
      <div className="stat-tile__label">{label}</div>
    </div>
  );
}

function SeverityDonut({ stats }: { stats: ReturnType<typeof computeStats> }) {
  const data = stats.severityCounts.filter((s) => s.count > 0);

  if (data.length === 0) {
    return <div className="empty-chart">No findings to chart.</div>;
  }

  return (
    <ResponsiveContainer width="100%" height={220}>
      <PieChart>
        <Pie
          data={data}
          dataKey="count"
          nameKey="severity"
          innerRadius={55}
          outerRadius={85}
          paddingAngle={3}
        >
          {data.map((entry) => (
            <Cell key={entry.severity} fill={entry.color} stroke="none" />
          ))}
        </Pie>
        <Tooltip
          contentStyle={{ background: "var(--bg-card)", border: "1px solid #30363d", borderRadius: 8 }}
          formatter={(value, name) => [`${value} finding(s)`, String(name)]}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}

interface TreemapContentProps {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  name?: string;
  fill?: string;
  count?: number;
  onSelect?: (filePath: string) => void;
}

function HeatmapCell({ x = 0, y = 0, width = 0, height = 0, name = "", fill = "var(--border)", count, onSelect }: TreemapContentProps) {
  const showLabel = width > 70 && height > 34;
  return (
    <g onClick={onSelect ? () => onSelect(name) : undefined} style={{ cursor: onSelect ? "pointer" : undefined }}>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        style={{ fill, stroke: "#0d1117", strokeWidth: 2 }}
      />
      {showLabel && (
        <>
          <text x={x + 8} y={y + 20} fill="#0d1117" fontSize={12} fontWeight={600}>
            {shortPath(name)}
          </text>
          <text x={x + 8} y={y + 36} fill="#0d1117" fontSize={11} opacity={0.85}>
            {count} finding{count === 1 ? "" : "s"}
          </text>
        </>
      )}
    </g>
  );
}

function FileHeatmap({ fileImpacts, onSelectFile }: { fileImpacts: FileImpact[]; onSelectFile?: (filePath: string) => void }) {
  if (fileImpacts.length === 0) {
    return <div className="empty-chart">No files to chart.</div>;
  }

  const data = fileImpacts.map((f) => ({
    name: f.filePath,
    size: Math.max(f.impactScore, 1),
    fill: SEVERITY_COLOR[f.dominantSeverity],
    count: f.count,
  }));

  return (
    <ResponsiveContainer width="100%" height={240}>
      <Treemap
        data={data}
        dataKey="size"
        stroke="#0d1117"
        content={<HeatmapCell onSelect={onSelectFile} />}
        isAnimationActive={false}
      />
    </ResponsiveContainer>
  );
}

function CarbonByFileChart({ stats }: { stats: ReturnType<typeof computeStats> }) {
  if (stats.carbonByFile.length === 0) {
    return (
      <div className="empty-chart">
        No carbon estimates yet — findings aren&apos;t correlated with any billing usage.
      </div>
    );
  }

  const data = stats.carbonByFile.map((f) => ({ ...f, label: shortPath(f.filePath) }));

  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} layout="vertical" margin={{ left: 8, right: 16 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
        <XAxis type="number" stroke="var(--text-muted)" fontSize={12} unit=" kg" />
        <YAxis type="category" dataKey="label" stroke="var(--text-muted)" fontSize={12} width={140} />
        <Tooltip
          contentStyle={{ background: "var(--bg-card)", border: "1px solid #30363d", borderRadius: 8 }}
          formatter={(value) => [`${Number(value).toFixed(4)} kgCO2e`, "Estimated emissions"]}
        />
        <Bar dataKey="kgCO2e" fill="#3fb950" radius={[0, 4, 4, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
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

export interface ImpactBarDatum {
  label: string;
  count: number;
  kgCO2e: number;
  costUsd: number;
  /** When set, the bar is clickable and navigates here — used to drill from
   * an org-wide chart into a single project's report. Omit for buckets with
   * no destination page (e.g. an AWS service isn't a page in this app). */
  href?: string;
}

/**
 * Bars are ranked worst-to-first by the caller (highest cost/impact first),
 * so tercile position doubles as a severity signal: top third of bars = red
 * (biggest exposure), middle = amber, bottom = green (smallest exposure).
 * Flat blue read as "informational, nothing to worry about" — the wrong
 * signal for a chart whose entire point is "here's where the risk is."
 */
function colorForRank(index: number, total: number): string {
  if (total <= 1) return SEVERITY_COLOR.high;
  const position = index / (total - 1);
  if (position < 1 / 3) return SEVERITY_COLOR.high;
  if (position < 2 / 3) return SEVERITY_COLOR.medium;
  return SEVERITY_COLOR.low;
}

/** Generic "impact by X" horizontal bar chart — used for both per-service
 * (ServiceBreakdownChart below) and per-project breakdowns, since the shape
 * of "one bar per bucket, ranked by carbon impact" is identical either way.
 * kgCO2e is the primary metric (this app is carbon-focused first, cost is
 * supporting context) — cost only takes over as the bar's value when a
 * bucket has cost data but literally no carbon estimate at all. */
export function ImpactBarChart({ data, labelWidth = 110 }: { data: ImpactBarDatum[]; labelWidth?: number }) {
  const router = useRouter();
  if (data.length === 0) {
    return <div className="empty-chart">No findings to chart.</div>;
  }
  const hasCarbon = data.some((d) => d.kgCO2e > 0);
  const hasCost = data.some((d) => d.costUsd > 0);
  const metric = hasCarbon ? "kgCO2e" : hasCost ? "costUsd" : "count";
  const clickable = data.some((d) => d.href);
  return (
    <ResponsiveContainer width="100%" height={Math.max(220, data.length * 64) + 24}>
      <BarChart data={data} layout="vertical" margin={{ left: 8, right: 24, bottom: 20 }} barCategoryGap="28%">
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
        <XAxis
          type="number"
          stroke="var(--text-muted)"
          fontSize={13}
          tickFormatter={
            metric === "kgCO2e"
              ? (value) => `${Number(value).toFixed(2)} kg`
              : metric === "costUsd"
                ? (value) => formatUsd(Number(value))
                : undefined
          }
          label={{
            value: metric === "kgCO2e" ? "kgCO2e" : metric === "costUsd" ? "Est. monthly cost" : "Findings",
            position: "insideBottom",
            offset: -14,
            fill: "var(--text-muted)",
            fontSize: 12,
          }}
        />
        <YAxis type="category" dataKey="label" stroke="var(--text-muted)" fontSize={13} width={labelWidth} />
        <Tooltip
          contentStyle={{ background: "var(--bg-card)", border: "1px solid #30363d", borderRadius: 8 }}
          formatter={(value, name, item) => {
            const d = item.payload as ImpactBarDatum;
            if (name === "kgCO2e") {
              return [
                `${(value as number).toFixed(3)} kgCO2e${d.costUsd > 0 ? ` · ${formatUsd(d.costUsd)}/mo` : ""}`,
                "Carbon impact",
              ];
            }
            if (name === "costUsd") return [formatUsd(value as number), "Est. monthly cost"];
            return [`${d.count} finding(s)`, "Findings"];
          }}
        />
        <Bar
          dataKey={metric}
          radius={[0, 6, 6, 0]}
          maxBarSize={36}
          cursor={clickable ? "pointer" : undefined}
          onClick={(entry) => {
            const d = (entry as unknown as { payload: ImpactBarDatum }).payload;
            if (d.href) router.push(d.href);
          }}
        >
          {data.map((d, i) => (
            <Cell key={d.label} fill={colorForRank(i, data.length)} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function ServiceBreakdownChart({ data }: { data: ServiceImpact[] }) {
  return (
    <ImpactBarChart
      data={data.map((d) => ({ label: d.service, count: d.count, kgCO2e: d.kgCO2e, costUsd: d.costUsd }))}
    />
  );
}

export function RecommendationsList({ recommendations }: { recommendations: Recommendation[] }) {
  if (recommendations.length === 0) {
    return <div className="empty-chart">No recommendations yet.</div>;
  }
  return (
    <ul className="reco-list">
      {recommendations.map((r) => (
        <li key={r.ruleId} className="reco" style={{ borderLeftColor: SEVERITY_COLOR[r.severity] }}>
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

export function FixesInProgressList({ fixes, repoUrl }: { fixes: FixInProgress[]; repoUrl?: string }) {
  if (fixes.length === 0) {
    return <div className="empty-chart">No fixes tracked yet — findings need a validated fix run first.</div>;
  }
  return (
    <ul className="fix-list">
      {fixes.map((f) => {
        const url = findingLabelUrl(repoUrl, f.idempotencyKey);
        return (
          <li key={f.idempotencyKey} className="fix">
            <span className="finding__location">
              {shortPath(f.filePath)}:{f.startLine}
            </span>
            <span className="finding__rule">{f.ruleId}</span>
            {url ? (
              <a href={url} target="_blank" rel="noopener noreferrer">
                View on GitHub →
              </a>
            ) : (
              <span className="fix__no-link">no repo URL to link to</span>
            )}
          </li>
        );
      })}
    </ul>
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
  expandedFile,
  onToggleFile,
}: {
  findings: EnrichedFinding[];
  repoUrl?: string;
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
                    {finding.estimate && (
                      <p className="finding__message">
                        <strong>Estimated impact:</strong> {finding.estimate.kgCO2e.toFixed(4)} kgCO2e (
                        {finding.estimate.confidence} confidence)
                      </p>
                    )}
                    {finding.explanation && (
                      <p className="finding__explanation">
                        <strong>Explanation:</strong> {finding.explanation}
                      </p>
                    )}
                    {(() => {
                      const url = findingLabelUrl(repoUrl, finding.idempotencyKey);
                      return url ? (
                        <p className="finding__pr-link">
                          <a href={url} target="_blank" rel="noopener noreferrer">
                            View PR / advisory Issue on GitHub →
                          </a>
                        </p>
                      ) : null;
                    })()}
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

  function selectFile(filePath: string) {
    router.push(`/projects/${projectId}/files?view=${role}&file=${encodeURIComponent(filePath)}`);
  }

  return (
    <>
      <section className="stat-grid">
        <StatTile label="Total findings" value={String(stats.total)} />
        <StatTile
          label="Est. carbon impact"
          value={stats.hasCarbonEstimate ? `${stats.totalKgCO2e!.toFixed(3)} kgCO2e` : "—"}
          accent={stats.hasCarbonEstimate ? "#3fb950" : undefined}
        />
        <StatTile
          label="Est. cost impact"
          value={stats.totalCostUsd ? `${formatUsd(stats.totalCostUsd)}/mo` : "—"}
          accent={stats.totalCostUsd ? "#d29922" : undefined}
        />
        <StatTile
          label="High severity"
          value={String(stats.severityCounts.find((s) => s.severity === "high")?.count ?? 0)}
          accent={SEVERITY_COLOR.high}
        />
        <StatTile
          label="Remediation progress"
          value={stats.total > 0 ? `${Math.round((stats.fixedCount / stats.total) * 100)}%` : "—"}
          accent="#58a6ff"
        />
        <StatTile label="Files affected" value={String(stats.filesAffected)} />
      </section>

      <section className="chart-grid">
        <div className="card">
          <h2>Severity breakdown</h2>
          <SeverityDonut stats={stats} />
          <div className="legend">
            {stats.severityCounts.map((s) => (
              <span key={s.severity} className="legend__item">
                <span className="legend__swatch" style={{ background: s.color }} />
                {s.severity} ({s.count})
              </span>
            ))}
          </div>
        </div>

        {stats.hasCarbonEstimate && (
          <div className="card">
            <h2>Environmental impact, in context</h2>
            <p className="card__hint">Illustrative equivalents, not scientifically tied to the estimate above.</p>
            <EnvironmentalImpact totalKgCO2e={stats.totalKgCO2e!} />
          </div>
        )}
      </section>

      {/* Carbon-ranked first since that's this app's core focus (cost rides
          alongside as supporting context, not the lead metric). */}
      <section className="chart-grid">
        <div className="card">
          <h2>Top carbon drivers by service</h2>
          <p className="card__hint">Which AWS service each rule's findings amplify.</p>
          <ServiceBreakdownChart data={serviceBreakdown} />
        </div>

        <div className="card card--wide">
          <h2>Where carbon & cost are concentrated</h2>
          <p className="card__hint">
            Box size = weighted severity impact, color = dominant severity in that file.
            {rank >= ROLE_RANK.engineer && " Click a box to open that file's findings."}
          </p>
          <FileHeatmap
            fileImpacts={stats.fileImpacts}
            onSelectFile={rank >= ROLE_RANK.engineer ? selectFile : undefined}
          />
        </div>
      </section>

      {/* What makes Manager's and Engineer's landing actually different from
          Executive's, not just "the same page plus a fuller side nav" — a
          one-line callout pointing at the single most useful next click for
          that role, rather than a whole extra block of cards. */}
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
}: {
  stats: ReturnType<typeof computeStats>;
  recommendations: Recommendation[];
}) {
  return (
    <section className="chart-grid">
      <div className="card">
        <h2>Recommendations</h2>
        <p className="card__hint">One entry per rule, highest carbon impact first.</p>
        <RecommendationsList recommendations={recommendations} />
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
export function FixesSection({ fixesInProgress, repoUrl }: { fixesInProgress: FixInProgress[]; repoUrl?: string }) {
  return (
    <section className="chart-grid">
      <div className="card card--wide">
        <h2>Fixes in progress</h2>
        <p className="card__hint">
          Findings with a validated fix run — follow the link for the PR/advisory Issue's live status on GitHub.
        </p>
        <FixesInProgressList fixes={fixesInProgress} repoUrl={repoUrl} />
      </div>
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
  initialExpandedFile,
}: {
  findings: EnrichedFinding[];
  repoUrl?: string;
  initialExpandedFile: string | null;
}) {
  const [expandedFile, setExpandedFile] = useState<string | null>(initialExpandedFile);

  useEffect(() => {
    if (initialExpandedFile) {
      document.getElementById(fileRowId(initialExpandedFile))?.scrollIntoView({ block: "start" });
    }
    // Only ever seed from the URL once, on the page's first render — an
    // in-page toggle afterwards shouldn't get overridden if this effect
    // somehow re-ran.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <section className="card">
      <h2>Findings by file</h2>
      <p className="card__hint">Click a file to expand its findings.</p>
      <FileFindingsList
        findings={findings}
        repoUrl={repoUrl}
        expandedFile={expandedFile}
        onToggleFile={(filePath) => setExpandedFile(expandedFile === filePath ? null : filePath)}
      />
    </section>
  );
}

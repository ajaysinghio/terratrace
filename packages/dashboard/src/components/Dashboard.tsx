"use client";

import type { EnrichedFinding } from "@terratrace/core";
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
import { computeStats, SEVERITY_COLOR, type FileImpact } from "../lib/stats";

interface DashboardProps {
  findings: EnrichedFinding[];
  /** GitHub URL for the scanned repo. When set, each finding renders a link
   * to the label search page — where the GitHub Action's PR or advisory
   * Issue for that finding appears (they carry the matching label). */
  repoUrl?: string;
}

function findingLabelUrl(repoUrl: string | undefined, idempotencyKey: string | undefined): string | undefined {
  if (!repoUrl || !idempotencyKey) return undefined;
  const label = `terratrace:${idempotencyKey}`;
  return `${repoUrl}/labels/${encodeURIComponent(label)}`;
}

function shortPath(filePath: string): string {
  return filePath.split("/").pop() ?? filePath;
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
          contentStyle={{ background: "#161b22", border: "1px solid #30363d", borderRadius: 8 }}
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
}

function HeatmapCell({ x = 0, y = 0, width = 0, height = 0, name = "", fill = "#30363d", count }: TreemapContentProps) {
  const showLabel = width > 70 && height > 34;
  return (
    <g>
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

function FileHeatmap({ fileImpacts }: { fileImpacts: FileImpact[] }) {
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
        content={<HeatmapCell />}
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
        <CartesianGrid strokeDasharray="3 3" stroke="#30363d" horizontal={false} />
        <XAxis type="number" stroke="#8b949e" fontSize={12} unit=" kg" />
        <YAxis type="category" dataKey="label" stroke="#8b949e" fontSize={12} width={140} />
        <Tooltip
          contentStyle={{ background: "#161b22", border: "1px solid #30363d", borderRadius: 8 }}
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

export default function Dashboard({ findings, repoUrl }: DashboardProps) {
  const stats = computeStats(findings);

  return (
    <>
      <section className="stat-grid">
        <StatTile label="Total findings" value={String(stats.total)} />
        <StatTile
          label="High severity"
          value={String(stats.severityCounts.find((s) => s.severity === "high")?.count ?? 0)}
          accent={SEVERITY_COLOR.high}
        />
        <StatTile label="Files affected" value={String(stats.filesAffected)} />
        <StatTile
          label="Est. carbon impact"
          value={stats.hasCarbonEstimate ? `${stats.totalKgCO2e!.toFixed(3)} kgCO2e` : "—"}
          accent={stats.hasCarbonEstimate ? "#3fb950" : undefined}
        />
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

        <div className="card card--wide">
          <h2>Impact heatmap by file</h2>
          <p className="card__hint">
            Box size = weighted severity impact, color = dominant severity in that file.
          </p>
          <FileHeatmap fileImpacts={stats.fileImpacts} />
        </div>
      </section>

      {stats.hasCarbonEstimate && (
        <section className="chart-grid">
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

          <div className="card">
            <h2>Environmental impact, in context</h2>
            <p className="card__hint">Illustrative equivalents, not scientifically tied to the estimate above.</p>
            <EnvironmentalImpact totalKgCO2e={stats.totalKgCO2e!} />
          </div>
        </section>
      )}

      <section className="card">
        <h2>Findings</h2>
        <ul className="findings-list">
          {findings.map((finding, i) => (
            <li key={`${finding.id}:${finding.filePath}:${finding.startLine}:${i}`} className="finding" style={{ borderLeftColor: SEVERITY_COLOR[finding.severity] }}>
              <div className="finding__header">
                <span
                  className="badge"
                  style={{ background: SEVERITY_COLOR[finding.severity] }}
                >
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
      </section>
    </>
  );
}

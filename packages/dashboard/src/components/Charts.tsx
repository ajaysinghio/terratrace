"use client";

// Every recharts import in the dashboard lives in this file so Dashboard.tsx
// can load it with next/dynamic — pages that render no chart (e.g. the
// files list) never download recharts.

import { useRouter } from "next/navigation";
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
import { formatUsd, shortPath } from "../lib/format";
import { SEVERITY_COLOR, type computeStats, type FileImpact } from "../lib/stats";

export function SeverityDonut({
  stats,
  onSelectSeverity,
}: {
  stats: ReturnType<typeof computeStats>;
  onSelectSeverity?: (severity: "high" | "medium" | "low") => void;
}) {
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
          cursor={onSelectSeverity ? "pointer" : undefined}
          onClick={
            onSelectSeverity
              ? (entry) => {
                  const s = (entry as unknown as { payload: { severity: "high" | "medium" | "low" } }).payload
                    ?.severity;
                  if (s) onSelectSeverity(s);
                }
              : undefined
          }
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

export function FileHeatmap({ fileImpacts, onSelectFile }: { fileImpacts: FileImpact[]; onSelectFile?: (filePath: string) => void }) {
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

export function CarbonByFileChart({ stats }: { stats: ReturnType<typeof computeStats> }) {
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

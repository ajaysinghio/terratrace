import Link from "next/link";
import { RecommendationsList, ServiceBreakdownChart } from "../components/Dashboard";
import RoleTabs from "../components/RoleTabs";
import { ROLE_RANK, parseRole } from "../lib/role";
import { loadAllProjects } from "../lib/projects";
import { computeRecommendations, computeServiceBreakdown } from "../lib/roleStats";
import { computeStats, SEVERITY_COLOR } from "../lib/stats";

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

// Without this, Next.js sees no dynamic API used and statically prerenders
// this page once at `next build` time — freezing the project list to
// whatever scan-output/ contained at build time instead of what's actually
// on disk when a request comes in.
export const dynamic = "force-dynamic";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const { view } = await searchParams;
  const role = parseRole(view, "executive");
  const projects = await loadAllProjects();
  const summaries = projects
    .map((p) => ({ project: p.project, stats: computeStats(p.findings) }))
    .sort((a, b) => b.stats.total - a.stats.total);
  // Org-wide findings across every scanned project — the Middle Management
  // view's "which service is hurting" chart isn't scoped to one repo, since
  // a manager oversees the whole estate, not a single project.
  const allFindings = projects.flatMap((p) => p.findings);

  if (summaries.length === 0) {
    return (
      <main className="empty-state">
        <h1>🌱 TerraTrace</h1>
        <p>
          No scanned projects found yet. Run the CLI against a repo first:{" "}
          <code>pnpm --filter @terratrace/cli start &quot;./sample-repo/**/*.py&quot; sample-repo</code>
        </p>
        <p>Each run writes one file to <code>scan-output/&lt;project-id&gt;.json</code>.</p>
      </main>
    );
  }

  const orgTotals = summaries.reduce(
    (acc, s) => {
      acc.findings += s.stats.total;
      acc.high += s.stats.severityCounts.find((sc) => sc.severity === "high")?.count ?? 0;
      acc.kgCO2e += s.stats.totalKgCO2e ?? 0;
      acc.costUsd += s.stats.totalCostUsd ?? 0;
      acc.fixed += s.stats.fixedCount;
      return acc;
    },
    { findings: 0, high: 0, kgCO2e: 0, costUsd: 0, fixed: 0 },
  );

  return (
    <div className="dashboard">
      <header className="dashboard__header">
        <h1>🌱 TerraTrace</h1>
        <p>
          {summaries.length} project(s) scanned · {orgTotals.findings} finding(s) total · {orgTotals.high} high
          severity
          {orgTotals.costUsd > 0 && (
            <>
              {" "}
              · <strong>{usd.format(orgTotals.costUsd)}/mo</strong> at risk
            </>
          )}{" "}
          · {orgTotals.kgCO2e > 0 ? `${orgTotals.kgCO2e.toFixed(2)} kgCO2e estimated` : "no carbon estimate yet"}
          {orgTotals.findings > 0 &&
            ` · ${Math.round((orgTotals.fixed / orgTotals.findings) * 100)}% remediation progress`}
        </p>
        <RoleTabs active={role} />
      </header>

      {ROLE_RANK[role] >= ROLE_RANK.manager && (
        <section className="chart-grid">
          <div className="card">
            <h2>Impact by service, org-wide</h2>
            <p className="card__hint">Across every scanned project — which AWS service is hurting the most.</p>
            <ServiceBreakdownChart data={computeServiceBreakdown(allFindings)} />
          </div>
          <div className="card card--wide">
            <h2>Recommendations, org-wide</h2>
            <p className="card__hint">One entry per rule, highest carbon impact first, across all projects.</p>
            <RecommendationsList recommendations={computeRecommendations(allFindings)} />
          </div>
        </section>
      )}

      <section className="project-grid">
        {summaries.map(({ project, stats }) => {
          const high = stats.severityCounts.find((s) => s.severity === "high")?.count ?? 0;
          const medium = stats.severityCounts.find((s) => s.severity === "medium")?.count ?? 0;
          const low = stats.severityCounts.find((s) => s.severity === "low")?.count ?? 0;
          const total = Math.max(stats.total, 1);

          return (
            <Link key={project.id} href={`/projects/${project.id}`} className="project-card">
              <div className="project-card__header">
                <h2>{project.name}</h2>
                <span className="project-card__count">{stats.total} finding(s)</span>
              </div>
              <div className="project-card__bar">
                {high > 0 && (
                  <span style={{ width: `${(high / total) * 100}%`, background: SEVERITY_COLOR.high }} />
                )}
                {medium > 0 && (
                  <span style={{ width: `${(medium / total) * 100}%`, background: SEVERITY_COLOR.medium }} />
                )}
                {low > 0 && <span style={{ width: `${(low / total) * 100}%`, background: SEVERITY_COLOR.low }} />}
              </div>
              <div className="project-card__stats">
                <span>{stats.filesAffected} file(s) affected</span>
                <span>{stats.hasCarbonEstimate ? `${stats.totalKgCO2e!.toFixed(3)} kgCO2e` : "no carbon data"}</span>
              </div>
            </Link>
          );
        })}
      </section>
    </div>
  );
}

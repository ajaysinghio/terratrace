import Link from "next/link";
import { loadProjectSummaries } from "../lib/projects";
import { SEVERITY_COLOR } from "../lib/stats";

export default async function HomePage() {
  const summaries = await loadProjectSummaries();

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
      return acc;
    },
    { findings: 0, high: 0, kgCO2e: 0 },
  );

  return (
    <div className="dashboard">
      <header className="dashboard__header">
        <h1>🌱 TerraTrace</h1>
        <p>
          {summaries.length} project(s) scanned · {orgTotals.findings} finding(s) total · {orgTotals.high} high
          severity · {orgTotals.kgCO2e > 0 ? `${orgTotals.kgCO2e.toFixed(2)} kgCO2e estimated` : "no carbon estimate yet"}
        </p>
      </header>

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

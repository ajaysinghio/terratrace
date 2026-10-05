import Link from "next/link";
import { cookies } from "next/headers";
import { ImpactBarChart, ServiceBreakdownChart } from "../../components/Dashboard";
import AccountMenu from "../../components/AccountMenu";
import AddRepoForm from "../../components/AddRepoForm";
import GlobalBillingUpload from "../../components/GlobalBillingUpload";
import RemoveProjectButton from "../../components/RemoveProjectButton";
import ScanButton from "../../components/ScanButton";
import { isDbConfigured } from "../../lib/db";
import { getInProgressScanProjectIds, isGithubActionsConfigured } from "../../lib/githubActions";
import { ROLE_RANK, parseRole } from "../../lib/role";
import { loadAllProjectsSlim } from "../../lib/projects";
import { computeServiceBreakdown } from "../../lib/roleStats";
import { computeStats, SEVERITY_COLOR } from "../../lib/stats";
import { COOKIE_NAME, verifySessionCookieValue } from "../../lib/session";

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
  const rank = ROLE_RANK[role];
  const session = process.env.GITHUB_OAUTH_CLIENT_ID
    ? verifySessionCookieValue((await cookies()).get(COOKIE_NAME)?.value)
    : null;
  const [projects, inProgressScanIds] = await Promise.all([
    loadAllProjectsSlim(),
    isGithubActionsConfigured() ? getInProgressScanProjectIds() : Promise.resolve(new Set<string>()),
  ]);
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
          severity ·{" "}
          {orgTotals.kgCO2e > 0 ? (
            <strong>{orgTotals.kgCO2e.toFixed(2)} kgCO2e</strong>
          ) : (
            "no carbon estimate yet"
          )}
          {orgTotals.costUsd > 0 && (
            <>
              {" "}
              · <strong>{usd.format(orgTotals.costUsd)}/mo</strong> at risk
            </>
          )}
          {orgTotals.findings > 0 &&
            ` · ${Math.round((orgTotals.fixed / orgTotals.findings) * 100)}% remediation progress`}
        </p>
      </header>
      <AccountMenu role={role} login={session?.login} />

      {isDbConfigured() && <GlobalBillingUpload />}

      {/* Executive baseline: two org-wide "where is the exposure" charts —
          by project and by service. A CEO opening this page sees these
          first, with no repo-browsing grid forced on them — but a bar here
          is still clickable, so drilling into the one project driving the
          exposure is one click, landing on that project's report at the
          same role (still executive-level detail, not a dump into
          engineer-only content). */}
      <section className="chart-grid">
        <div className="card">
          <h2>Impact by project, org-wide</h2>
          <p className="card__hint">Ranked by estimated carbon impact — click a project to see its report.</p>
          <ImpactBarChart
            labelWidth={130}
            data={[...summaries]
              .sort((a, b) => (b.stats.totalKgCO2e ?? 0) - (a.stats.totalKgCO2e ?? 0))
              .map(({ project, stats }) => ({
                label: project.name,
                count: stats.total,
                kgCO2e: stats.totalKgCO2e ?? 0,
                costUsd: stats.totalCostUsd ?? 0,
                href: `/projects/${project.id}?view=${role}`,
              }))}
          />
        </div>
        <div className="card card--wide">
          <h2>Impact by service, org-wide</h2>
          <p className="card__hint">Across every scanned project — which AWS service is hurting the most.</p>
          <ServiceBreakdownChart data={computeServiceBreakdown(allFindings)} />
        </div>
      </section>

      {rank >= ROLE_RANK.manager && (
        <>
          <div className="dashboard-toolbar">
            <Link href={`/pipeline?view=${role}`} className="button">
              📈 Pipeline status
            </Link>
            {isDbConfigured() && <AddRepoForm />}
          </div>

          {rank >= ROLE_RANK.engineer &&
            (() => {
              const neediest = [...summaries].sort(
                (a, b) => b.stats.total - b.stats.fixedCount - (a.stats.total - a.stats.fixedCount),
              )[0];
              const needsAttention = neediest.stats.total - neediest.stats.fixedCount;
              return (
                needsAttention > 0 && (
                  <div className="callout">
                    <Link href={`/projects/${neediest.project.id}/files?view=${role}`} className="callout__item">
                      <span className="callout__icon">📄</span>
                      <strong>{neediest.project.name}</strong> needs an engineer most ({needsAttention} finding
                      {needsAttention === 1 ? "" : "s"})
                    </Link>
                  </div>
                )
              );
            })()}

          <section className="project-grid">
            {summaries.map(({ project, stats }) => {
              const pending = !project.scannedAt;
              const high = stats.severityCounts.find((s) => s.severity === "high")?.count ?? 0;
              const medium = stats.severityCounts.find((s) => s.severity === "medium")?.count ?? 0;
              const low = stats.severityCounts.find((s) => s.severity === "low")?.count ?? 0;
              const total = Math.max(stats.total, 1);
              const href = `/projects/${project.id}?view=${role}`;

              return (
                <Link key={project.id} href={href} className="project-card">
                  {isDbConfigured() && (
                    <div className="project-card__actions">
                      {!pending && (
                        <ScanButton
                          projectId={project.id}
                          label="Rescan"
                          variant="icon"
                          stopPropagation
                          alreadyRunning={inProgressScanIds.has(project.id)}
                        />
                      )}
                      <RemoveProjectButton projectId={project.id} projectName={project.name} />
                    </div>
                  )}
                  <div className="project-card__header">
                    <h2>{project.name}</h2>
                    <span className="project-card__count">
                      {pending ? "not yet scanned" : `${stats.total} finding(s)`}
                    </span>
                  </div>
                  {pending ? (
                    isDbConfigured() && (
                      <div className="project-card__pending-action">
                        <ScanButton
                          projectId={project.id}
                          label="▶ Scan now"
                          stopPropagation
                          alreadyRunning={inProgressScanIds.has(project.id)}
                        />
                      </div>
                    )
                  ) : (
                    <>
                      <div className="project-card__bar">
                        {high > 0 && (
                          <span style={{ width: `${(high / total) * 100}%`, background: SEVERITY_COLOR.high }} />
                        )}
                        {medium > 0 && (
                          <span style={{ width: `${(medium / total) * 100}%`, background: SEVERITY_COLOR.medium }} />
                        )}
                        {low > 0 && (
                          <span style={{ width: `${(low / total) * 100}%`, background: SEVERITY_COLOR.low }} />
                        )}
                      </div>
                      <div className="project-card__stats">
                        <span>{stats.filesAffected} file(s) affected</span>
                        <span>
                          {stats.hasCarbonEstimate ? `${stats.totalKgCO2e!.toFixed(3)} kgCO2e` : "no carbon data"}
                        </span>
                      </div>
                    </>
                  )}
                </Link>
              );
            })}
          </section>
        </>
      )}
    </div>
  );
}

import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import BillingProvenanceBadge from "../../../components/BillingProvenanceBadge";
import { OverviewSection } from "../../../components/Dashboard";
import ProjectShell from "../../../components/ProjectShell";
import { dbGetLatestBillingUpload, isDbConfigured } from "../../../lib/db";
import { parseRole } from "../../../lib/role";
import { loadProject } from "../../../lib/projects";
import { computeRecommendations, computeServiceBreakdown } from "../../../lib/roleStats";
import { computeStats } from "../../../lib/stats";
import { COOKIE_NAME, verifySessionCookieValue } from "../../../lib/session";

// Forces per-request reads of scan-output/ rather than a build-time
// snapshot — see the note on the org-wide dashboard page for why.
export const dynamic = "force-dynamic";

export default async function ProjectOverviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ view?: string }>;
}) {
  const { projectId } = await params;
  const { view } = await searchParams;
  const role = parseRole(view, "engineer");
  const session = process.env.GITHUB_OAUTH_CLIENT_ID
    ? verifySessionCookieValue((await cookies()).get(COOKIE_NAME)?.value)
    : null;
  const data = await loadProject(projectId);

  if (!data) {
    notFound();
  }

  const latestUpload = isDbConfigured() ? await dbGetLatestBillingUpload(projectId) : null;
  const hasEstimates = data.findings.some((f) => f.estimate);

  return (
    <ProjectShell
      projectId={projectId}
      projectName={data.project.name}
      repoUrl={data.project.repoUrl}
      scannedAt={data.project.scannedAt}
      role={role}
      login={session?.login}
    >
      {isDbConfigured() && <BillingProvenanceBadge latestUpload={latestUpload} hasEstimates={hasEstimates} />}
      <OverviewSection
        projectId={projectId}
        role={role}
        stats={computeStats(data.findings)}
        serviceBreakdown={computeServiceBreakdown(data.findings)}
        recommendations={computeRecommendations(data.findings)}
      />
    </ProjectShell>
  );
}

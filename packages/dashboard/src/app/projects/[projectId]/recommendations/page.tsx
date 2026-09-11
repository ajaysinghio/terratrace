import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { RecommendationsSection } from "../../../../components/Dashboard";
import ProjectShell from "../../../../components/ProjectShell";
import { parseRole, ROLE_RANK } from "../../../../lib/role";
import { loadProject } from "../../../../lib/projects";
import { computeRecommendations } from "../../../../lib/roleStats";
import { computeStats } from "../../../../lib/stats";
import { COOKIE_NAME, verifySessionCookieValue } from "../../../../lib/session";

export const dynamic = "force-dynamic";

export default async function ProjectRecommendationsPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ view?: string; rule?: string }>;
}) {
  const { projectId } = await params;
  const { view, rule } = await searchParams;
  const role = parseRole(view, "engineer");
  if (ROLE_RANK[role] < ROLE_RANK.manager) {
    redirect(`/projects/${projectId}?view=${role}`);
  }
  const session = process.env.GITHUB_OAUTH_CLIENT_ID
    ? verifySessionCookieValue((await cookies()).get(COOKIE_NAME)?.value)
    : null;
  const data = await loadProject(projectId);

  if (!data) {
    notFound();
  }

  return (
    <ProjectShell
      projectId={projectId}
      projectName={data.project.name}
      repoUrl={data.project.repoUrl}
      scannedAt={data.project.scannedAt}
      role={role}
      login={session?.login}
    >
      <RecommendationsSection
        stats={computeStats(data.findings)}
        recommendations={computeRecommendations(data.findings)}
        focusedRuleId={rule ?? null}
      />
    </ProjectShell>
  );
}

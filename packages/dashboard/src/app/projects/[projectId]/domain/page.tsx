import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { DomainSection } from "../../../../components/Dashboard";
import ProjectShell from "../../../../components/ProjectShell";
import { parseRole, ROLE_RANK } from "../../../../lib/role";
import { loadProject } from "../../../../lib/projects";
import { computeStats } from "../../../../lib/stats";
import { COOKIE_NAME, verifySessionCookieValue } from "../../../../lib/session";

export const dynamic = "force-dynamic";

export default async function ProjectDomainPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ view?: string }>;
}) {
  const { projectId } = await params;
  const { view } = await searchParams;
  const role = parseRole(view, "engineer");
  // Executive doesn't get this page — bounce to the Overview they do have,
  // rather than 404ing someone who just followed a stale/typed link.
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
      <DomainSection findings={data.findings} domainImpacts={computeStats(data.findings).domainImpacts} />
    </ProjectShell>
  );
}

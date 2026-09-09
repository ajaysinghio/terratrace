import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import Dashboard from "../../../components/Dashboard";
import AccountMenu from "../../../components/AccountMenu";
import { parseRole } from "../../../lib/role";
import { loadProject } from "../../../lib/projects";
import { computeFixesInProgress, computeRecommendations, computeServiceBreakdown } from "../../../lib/roleStats";
import { COOKIE_NAME, verifySessionCookieValue } from "../../../lib/session";

// See the note on the dashboard page (../../dashboard/page.tsx) — force
// per-request reads of scan-output/ rather than a build-time snapshot.
export const dynamic = "force-dynamic";

export default async function ProjectPage({
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

  return (
    <div className="dashboard">
      <header className="dashboard__header">
        <Link href="/dashboard" className="back-link">
          ← All projects
        </Link>
        <h1>{data.project.name}</h1>
        <p>
          {data.project.repoUrl ?? data.project.id}
          {data.project.scannedAt && ` · scanned ${new Date(data.project.scannedAt).toLocaleString()}`}
        </p>
      </header>
      <AccountMenu role={role} login={session?.login} />
      <Dashboard
        findings={data.findings}
        repoUrl={data.project.repoUrl}
        role={role}
        serviceBreakdown={computeServiceBreakdown(data.findings)}
        recommendations={computeRecommendations(data.findings)}
        fixesInProgress={computeFixesInProgress(data.findings)}
      />
    </div>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";
import Dashboard from "../../../components/Dashboard";
import RoleTabs from "../../../components/RoleTabs";
import { parseRole } from "../../../lib/role";
import { loadProject } from "../../../lib/projects";
import { computeFixesInProgress, computeRecommendations, computeServiceBreakdown } from "../../../lib/roleStats";

// See the note on the home page (../../page.tsx) — force per-request reads
// of scan-output/ rather than a build-time snapshot.
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
  const data = await loadProject(projectId);

  if (!data) {
    notFound();
  }

  return (
    <div className="dashboard">
      <header className="dashboard__header">
        <Link href="/" className="back-link">
          ← All projects
        </Link>
        <h1>{data.project.name}</h1>
        <p>
          {data.project.repoUrl ?? data.project.id}
          {data.project.scannedAt && ` · scanned ${new Date(data.project.scannedAt).toLocaleString()}`}
        </p>
        <RoleTabs active={role} />
        {process.env.GITHUB_OAUTH_CLIENT_ID && (
          <a href="/api/auth/logout" className="back-link">
            Sign out
          </a>
        )}
      </header>
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

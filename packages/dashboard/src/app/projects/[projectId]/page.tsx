import Link from "next/link";
import { notFound } from "next/navigation";
import Dashboard from "../../../components/Dashboard";
import { loadProject } from "../../../lib/projects";

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
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
      </header>
      <Dashboard findings={data.findings} repoUrl={data.project.repoUrl} />
    </div>
  );
}

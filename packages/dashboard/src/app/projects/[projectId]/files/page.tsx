import type { Severity } from "@terratrace/core";
import { RULE_SERVICE_MAP } from "@terratrace/core";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { FilesSection } from "../../../../components/Dashboard";
import ProjectShell from "../../../../components/ProjectShell";
import { parseRole } from "../../../../lib/role";
import { loadProject } from "../../../../lib/projects";
import { COOKIE_NAME, verifySessionCookieValue } from "../../../../lib/session";
import { SEVERITY_WEIGHT } from "../../../../lib/stats";

export const dynamic = "force-dynamic";

function parseSeverity(value: string | undefined): Severity | null {
  return value !== undefined && Object.prototype.hasOwnProperty.call(SEVERITY_WEIGHT, value)
    ? (value as Severity)
    : null;
}

export default async function ProjectFilesPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ view?: string; file?: string; severity?: string; service?: string; rule?: string }>;
}) {
  const { projectId } = await params;
  const { view, file, severity, service, rule } = await searchParams;
  const role = parseRole(view, "engineer");
  const session = process.env.GITHUB_OAUTH_CLIENT_ID
    ? verifySessionCookieValue((await cookies()).get(COOKIE_NAME)?.value)
    : null;
  const data = await loadProject(projectId);

  if (!data) {
    notFound();
  }

  const severityFilter = parseSeverity(severity);
  const fileFilter = file && data.findings.some((f) => f.filePath === file) ? file : null;
  const serviceFilter =
    service && Object.values(RULE_SERVICE_MAP).includes(service) ? service : null;
  const ruleFilter = rule && data.findings.some((f) => f.ruleId === rule) ? rule : null;
  const findings = data.findings.filter(
    (f) =>
      (!severityFilter || f.severity === severityFilter) &&
      (!fileFilter || f.filePath === fileFilter) &&
      (!serviceFilter || RULE_SERVICE_MAP[f.ruleId] === serviceFilter) &&
      (!ruleFilter || f.ruleId === ruleFilter),
  );

  return (
    <ProjectShell
      projectId={projectId}
      projectName={data.project.name}
      repoUrl={data.project.repoUrl}
      scannedAt={data.project.scannedAt}
      role={role}
      login={session?.login}
    >
      <FilesSection
        findings={findings}
        repoUrl={data.project.repoUrl}
        initialExpandedFile={fileFilter}
        severityFilter={severityFilter}
        fileFilter={fileFilter}
        serviceFilter={serviceFilter}
        ruleFilter={ruleFilter}
      />
    </ProjectShell>
  );
}

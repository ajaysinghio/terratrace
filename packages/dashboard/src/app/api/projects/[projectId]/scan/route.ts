import { NextResponse } from "next/server";
import { isDbConfigured } from "../../../../../lib/db";
import { loadProject } from "../../../../../lib/projects";
import { manualScanSteps, parseGithubRepoUrl, SCANNER_REPO, triggerScanWorkflow } from "../../../../../lib/scanTrigger";

export const dynamic = "force-dynamic";

/**
 * Triggers (or re-triggers) a scan for an already-registered project — the
 * explicit second step after "Add repo", and what the "Rescan" button on an
 * already-scanned project card calls too. Same scan-repo.yml dispatch
 * either way; nothing here distinguishes first scan from a rescan.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  if (!isDbConfigured()) {
    return NextResponse.json({ error: "DATABASE_URL is not configured." }, { status: 501 });
  }

  const { projectId } = await params;
  const project = await loadProject(projectId);
  if (!project) {
    return NextResponse.json({ error: `Unknown project "${projectId}".` }, { status: 404 });
  }
  if (!project.project.repoUrl) {
    return NextResponse.json({ error: `Project "${projectId}" has no repo URL on record.` }, { status: 400 });
  }

  const parsed = parseGithubRepoUrl(project.project.repoUrl);
  if (!parsed) {
    return NextResponse.json(
      { error: `"${project.project.repoUrl}" doesn't look like a GitHub repo URL.` },
      { status: 400 }
    );
  }

  const dispatched = await triggerScanWorkflow({
    repoOwner: parsed.owner,
    repoName: parsed.repo,
    projectId,
    projectName: project.project.name,
  });

  return NextResponse.json({
    projectId,
    dispatched,
    scannerActionsUrl: `https://github.com/${SCANNER_REPO}/actions`,
    steps: manualScanSteps({
      repoUrl: parsed.url,
      repoName: parsed.repo,
      projectId,
      projectName: project.project.name,
    }),
  });
}

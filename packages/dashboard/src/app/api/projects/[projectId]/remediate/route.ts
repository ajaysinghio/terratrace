import { NextResponse } from "next/server";
import { dbGetRemediationCandidates, isDbConfigured } from "../../../../../lib/db";
import { loadProject } from "../../../../../lib/projects";
import { parseGithubRepoUrl, SCANNER_REPO, triggerRemediateWorkflow } from "../../../../../lib/scanTrigger";

export const dynamic = "force-dynamic";

/**
 * Triggers remediate-repo.yml — opening real PRs against the target repo.
 * Deliberately a separate endpoint/workflow from scanning (see that
 * workflow's header comment): only ever called by an explicit "Raise PRs"
 * or "Create PR" click, never automatically. Body: {} for every ready
 * finding in the project, or { findingId } for just one.
 */
export async function POST(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  if (!isDbConfigured()) {
    return NextResponse.json({ error: "DATABASE_URL is not configured." }, { status: 501 });
  }

  const { projectId } = await params;
  const body = await request.json().catch(() => ({}));
  const findingId = typeof body?.findingId === "string" ? body.findingId : undefined;

  const project = await loadProject(projectId);
  if (!project) {
    return NextResponse.json({ error: `Unknown project "${projectId}".` }, { status: 404 });
  }
  if (!project.project.repoUrl) {
    return NextResponse.json({ error: `Project "${projectId}" has no repo URL on record.` }, { status: 400 });
  }
  const parsed = parseGithubRepoUrl(project.project.repoUrl);
  if (!parsed) {
    return NextResponse.json({ error: `"${project.project.repoUrl}" doesn't look like a GitHub repo URL.` }, { status: 400 });
  }

  const candidates = await dbGetRemediationCandidates(projectId, findingId);
  if (candidates.length === 0) {
    return NextResponse.json(
      { error: findingId ? "This finding isn't ready to remediate (no validated fix, or a PR already exists)." : "No findings are ready to remediate right now." },
      { status: 400 }
    );
  }

  const dispatched = await triggerRemediateWorkflow({
    repoOwner: parsed.owner,
    repoName: parsed.repo,
    projectId,
    findingId,
  });

  return NextResponse.json({
    candidateCount: candidates.length,
    dispatched,
    scannerActionsUrl: `https://github.com/${SCANNER_REPO}/actions`,
  });
}

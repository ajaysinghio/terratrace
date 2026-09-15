import { NextResponse } from "next/server";
import { dbProjectExists, dbRegisterProject, isDbConfigured } from "../../../lib/db";

export const dynamic = "force-dynamic";

function parseGithubRepoUrl(input: string): { owner: string; repo: string; url: string } | null {
  const trimmed = input.trim();
  const match = trimmed.match(/^https?:\/\/github\.com\/([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/);
  if (!match) return null;
  const [, owner, repo] = match;
  return { owner, repo, url: `https://github.com/${owner}/${repo}` };
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const SCANNER_REPO = process.env.GITHUB_SCANNER_REPO ?? "ajaysinghio/terratrace";

/**
 * Fires .github/workflows/scan-repo.yml in the terratrace repo via GitHub's
 * workflow_dispatch API — the actual scan runs there (checked-out target
 * repo, semgrep, ANTHROPIC_API_KEY, DATABASE_URL all centralized in that one
 * workflow; see its header comment). Returns true if the dispatch call
 * succeeded, false if it's not configured or GitHub rejected it — callers
 * fall back to manual instructions either way, so a dispatch failure here
 * should never block registering the project.
 */
async function triggerScanWorkflow(params: {
  repoOwner: string;
  repoName: string;
  projectId: string;
  projectName: string;
}): Promise<boolean> {
  const token = process.env.GITHUB_DISPATCH_TOKEN;
  if (!token) return false;

  try {
    const response = await fetch(
      `https://api.github.com/repos/${SCANNER_REPO}/actions/workflows/scan-repo.yml/dispatches`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        body: JSON.stringify({
          ref: "main",
          inputs: {
            repo_owner: params.repoOwner,
            repo_name: params.repoName,
            project_id: params.projectId,
            project_name: params.projectName,
          },
        }),
      }
    );
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Registers a repo to scan — the "Add repo" flow. Deliberately doesn't scan
 * anything itself: CodeAnalyzer needs the repo checked out somewhere with
 * tree-sitter/semgrep available, which this serverless route doesn't have
 * (see README's Vercel notes). Instead it reserves the project row and
 * tries to auto-trigger the central scan-repo.yml workflow (see
 * triggerScanWorkflow above); if that's not configured yet, it falls back
 * to handing back the equivalent manual commands.
 */
export async function POST(request: Request) {
  if (!isDbConfigured()) {
    return NextResponse.json(
      { error: "DATABASE_URL is not configured — adding a repo requires the findings DB (see db/schema.sql)." },
      { status: 501 }
    );
  }

  const body = await request.json().catch(() => null);
  const repoUrlInput = typeof body?.repoUrl === "string" ? body.repoUrl : null;
  if (!repoUrlInput) {
    return NextResponse.json({ error: "Missing \"repoUrl\"." }, { status: 400 });
  }

  const parsed = parseGithubRepoUrl(repoUrlInput);
  if (!parsed) {
    return NextResponse.json(
      { error: `"${repoUrlInput}" doesn't look like a GitHub repo URL (expected https://github.com/<owner>/<repo>).` },
      { status: 400 }
    );
  }

  const projectName = typeof body?.name === "string" && body.name.trim() ? body.name.trim() : parsed.repo;
  const projectId = slugify(parsed.repo);

  if (await dbProjectExists(projectId)) {
    return NextResponse.json({ error: `A project named "${projectId}" already exists.` }, { status: 409 });
  }

  await dbRegisterProject({ id: projectId, name: projectName, repoUrl: parsed.url });

  const dispatched = await triggerScanWorkflow({
    repoOwner: parsed.owner,
    repoName: parsed.repo,
    projectId,
    projectName,
  });

  return NextResponse.json({
    projectId,
    projectName,
    repoUrl: parsed.url,
    dispatched,
    scannerActionsUrl: `https://github.com/${SCANNER_REPO}/actions`,
    // Only shown by the UI when dispatched is false (GITHUB_DISPATCH_TOKEN
    // not configured yet) — fast-glob and git-remote detection both resolve
    // relative to process.cwd(), so the scan has to actually run with the
    // target repo as cwd; `pnpm --filter` can't do that since it needs to
    // run inside the terratrace workspace, hence pointing node at the built
    // CLI directly.
    steps: [
      `git clone ${parsed.url}.git && cd ${parsed.repo}`,
      `node <path-to-terratrace>/packages/cli/dist/index.js "**/*.{py,java,tf}" ${projectId} "${projectName}"`,
      // The CLI writes ./scan-output/<id>.json relative to its cwd (the repo
      // just cloned above, not terratrace) — copy it over before importing.
      `cp scan-output/${projectId}.json <path-to-terratrace>/scan-output/`,
      `cd <path-to-terratrace> && node packages/dashboard/scripts/import-scan-output.mjs ${projectId}.json`,
    ],
  });
}

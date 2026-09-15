import { NextResponse } from "next/server";
import { dbProjectExists, dbRegisterProject, isDbConfigured } from "../../../lib/db";
import { parseGithubRepoUrl } from "../../../lib/scanTrigger";

export const dynamic = "force-dynamic";

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Registers a repo to track — the "Add repo" flow. Deliberately just
 * registers: scanning is a separate, explicit action (POST
 * /api/projects/[projectId]/scan, same endpoint a "Rescan" button calls
 * later) so a repo can sit registered without a scan queued the moment
 * it's added — no surprise CI run, no surprise LLM spend, just because
 * someone typed a URL in.
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

  return NextResponse.json({ projectId, projectName, repoUrl: parsed.url });
}

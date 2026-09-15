import { NextResponse } from "next/server";
import { dbDeleteProject, dbProjectExists, isDbConfigured } from "../../../../lib/db";

export const dynamic = "force-dynamic";

/**
 * Removes a project from the dashboard — DB rows only (findings,
 * billing_uploads cascade). Never touches the target repo itself; this is
 * purely "stop tracking it here," not an undo of anything that happened on
 * GitHub.
 */
export async function DELETE(_request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;

  if (!isDbConfigured()) {
    return NextResponse.json({ error: "DATABASE_URL is not configured." }, { status: 501 });
  }

  if (!(await dbProjectExists(projectId))) {
    return NextResponse.json({ error: `Unknown project "${projectId}".` }, { status: 404 });
  }

  await dbDeleteProject(projectId);
  return NextResponse.json({ removed: projectId });
}

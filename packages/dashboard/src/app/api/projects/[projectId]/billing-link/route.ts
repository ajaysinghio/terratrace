import { NextResponse } from "next/server";
import { dbProjectExists, dbSetBillingLinked, isDbConfigured } from "../../../../../lib/db";

export const dynamic = "force-dynamic";

/**
 * Toggles whether a project is linked to the AWS account a CUR upload
 * represents — see projects.billing_linked's schema comment and
 * api/billing/route.ts. Off by default for every project.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  if (!isDbConfigured()) {
    return NextResponse.json({ error: "DATABASE_URL is not configured." }, { status: 501 });
  }

  const { projectId } = await params;
  if (!(await dbProjectExists(projectId))) {
    return NextResponse.json({ error: `Unknown project "${projectId}".` }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));
  if (typeof body?.linked !== "boolean") {
    return NextResponse.json({ error: "Missing boolean \"linked\"." }, { status: 400 });
  }

  await dbSetBillingLinked(projectId, body.linked);
  return NextResponse.json({ projectId, linked: body.linked });
}

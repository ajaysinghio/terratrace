import { NextResponse } from "next/server";
// Subpath imports, not the package root — the root re-exports PythonAnalyzer
// (native tree-sitter bindings), which Turbopack can't place in an API
// route's ESM bundle. See core's package.json "./correlate"/"./billing" exports.
import { parseCurCsv } from "@terratrace/core/billing";
import { correlateFindingsWithUsage } from "@terratrace/core/correlate";
import { dbApplyEstimates, dbRecordBillingUpload, isDbConfigured } from "../../../lib/db";
import { loadAllProjects } from "../../../lib/projects";

export const dynamic = "force-dynamic";

/**
 * One CUR file for the whole AWS account, correlated against every scanned
 * project at once — matches how AWS actually issues a CUR (per payer
 * account, not per repo/service; see README's billing notes). Real-world
 * caveat this doesn't solve yet: without resource-tag filtering, a service
 * (e.g. "AmazonEC2") shared by two projects gets that service's full usage
 * attributed to *both*, which double-counts cost/carbon across projects if
 * they're summed org-wide. Fine for a single-account demo; a production
 * version needs to split usage by resourceTags before calling
 * correlateFindingsWithUsage per project.
 */
export async function POST(request: Request) {
  if (!isDbConfigured()) {
    return NextResponse.json(
      { error: "DATABASE_URL is not configured — CUR upload requires the findings DB (see db/schema.sql)." },
      { status: 501 }
    );
  }

  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing \"file\" field — expected a CUR CSV upload." }, { status: 400 });
  }

  const csv = await file.text();
  let usageRecords;
  try {
    usageRecords = parseCurCsv(csv);
  } catch (err) {
    return NextResponse.json(
      { error: `Couldn't parse "${file.name}" as a CUR CSV: ${err instanceof Error ? err.message : String(err)}` },
      { status: 400 }
    );
  }

  if (usageRecords.length === 0) {
    return NextResponse.json(
      { error: `No usable rows found in "${file.name}" — check it has the CUR 1.0 CSV columns (see README).` },
      { status: 400 }
    );
  }

  const projects = await loadAllProjects();
  const perProject = [];

  for (const { project, findings } of projects) {
    const estimateByFindingId = correlateFindingsWithUsage(findings, usageRecords);
    const upload = await dbRecordBillingUpload(project.id, {
      sourceType: "cur_upload",
      filename: file.name,
      recordCount: usageRecords.length,
    });
    await dbApplyEstimates(project.id, estimateByFindingId, upload.id);

    const totalCostUsd = [...estimateByFindingId.values()].reduce((sum, e) => sum + e.costUsd, 0);
    const totalKgCO2e = [...estimateByFindingId.values()].reduce((sum, e) => sum + e.kgCO2e, 0);
    perProject.push({
      projectId: project.id,
      projectName: project.name,
      findingsUpdated: estimateByFindingId.size,
      totalFindings: findings.length,
      totalCostUsd,
      totalKgCO2e,
    });
  }

  return NextResponse.json({
    filename: file.name,
    recordCount: usageRecords.length,
    projects: perProject,
    findingsUpdated: perProject.reduce((sum, p) => sum + p.findingsUpdated, 0),
    totalCostUsd: perProject.reduce((sum, p) => sum + p.totalCostUsd, 0),
    totalKgCO2e: perProject.reduce((sum, p) => sum + p.totalKgCO2e, 0),
  });
}

import { neon } from "@neondatabase/serverless";
import type { CarbonEstimate, EnrichedFinding, Severity } from "@terratrace/core";
import type { ProjectData, ProjectMeta } from "./projects";

export type BillingSourceType = "cur_upload" | "sample";

export interface BillingUpload {
  id: string;
  projectId: string;
  sourceType: BillingSourceType;
  filename: string | null;
  recordCount: number;
  uploadedAt: string;
}

export function isDbConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

function sql() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set — call isDbConfigured() before using db.ts helpers.");
  }
  return neon(url);
}

interface ProjectRow {
  id: string;
  name: string;
  repo_url: string | null;
  scanned_at: string | null;
}

interface FindingRow {
  id: string;
  rule_id: string;
  severity: Severity;
  file_path: string;
  start_line: number;
  end_line: number;
  snippet: string;
  message: string;
  explanation: string | null;
  suggested_fix_diff: string | null;
  idempotency_key: string | null;
  autofix: EnrichedFinding["autofix"] | null;
  estimate_kg_co2e: number | null;
  estimate_methodology: CarbonEstimate["methodology"] | null;
  estimate_grid_intensity_gco2_per_kwh: number | null;
  estimate_confidence: CarbonEstimate["confidence"] | null;
  estimate_cost_usd: number | null;
  billing_upload_id: string | null;
}

function toProjectMeta(row: ProjectRow): ProjectMeta {
  return {
    id: row.id,
    name: row.name,
    repoUrl: row.repo_url ?? undefined,
    scannedAt: row.scanned_at ?? undefined,
  };
}

function toEnrichedFinding(row: FindingRow): EnrichedFinding {
  const estimate: CarbonEstimate | undefined =
    row.estimate_kg_co2e !== null &&
    row.estimate_methodology !== null &&
    row.estimate_grid_intensity_gco2_per_kwh !== null &&
    row.estimate_confidence !== null &&
    row.estimate_cost_usd !== null
      ? {
          kgCO2e: row.estimate_kg_co2e,
          methodology: row.estimate_methodology,
          gridIntensityGco2PerKwh: row.estimate_grid_intensity_gco2_per_kwh,
          confidence: row.estimate_confidence,
          costUsd: row.estimate_cost_usd,
        }
      : undefined;

  return {
    id: row.id,
    ruleId: row.rule_id,
    severity: row.severity,
    filePath: row.file_path,
    startLine: row.start_line,
    endLine: row.end_line,
    snippet: row.snippet,
    message: row.message,
    autofix: row.autofix ?? undefined,
    estimate,
    explanation: row.explanation ?? undefined,
    suggestedFixDiff: row.suggested_fix_diff ?? undefined,
    idempotencyKey: row.idempotency_key ?? undefined,
  };
}

export async function dbLoadAllProjects(): Promise<ProjectData[]> {
  const db = sql();
  const projectRows = (await db`select id, name, repo_url, scanned_at from projects`) as ProjectRow[];

  return Promise.all(
    projectRows.map(async (projectRow) => {
      const findingRows = (await db`
        select id, rule_id, severity, file_path, start_line, end_line, snippet, message,
               explanation, suggested_fix_diff, idempotency_key, autofix,
               estimate_kg_co2e, estimate_methodology, estimate_grid_intensity_gco2_per_kwh,
               estimate_confidence, estimate_cost_usd, billing_upload_id
        from findings
        where project_id = ${projectRow.id}
      `) as FindingRow[];

      return {
        project: toProjectMeta(projectRow),
        findings: findingRows.map(toEnrichedFinding),
      };
    })
  );
}

export async function dbLoadProject(projectId: string): Promise<ProjectData | null> {
  const db = sql();
  const projectRows = (await db`
    select id, name, repo_url, scanned_at from projects where id = ${projectId}
  `) as ProjectRow[];
  const projectRow = projectRows[0];
  if (!projectRow) return null;

  const findingRows = (await db`
    select id, rule_id, severity, file_path, start_line, end_line, snippet, message,
           explanation, suggested_fix_diff, idempotency_key, autofix,
           estimate_kg_co2e, estimate_methodology, estimate_grid_intensity_gco2_per_kwh,
           estimate_confidence, estimate_cost_usd, billing_upload_id
    from findings
    where project_id = ${projectId}
  `) as FindingRow[];

  return {
    project: toProjectMeta(projectRow),
    findings: findingRows.map(toEnrichedFinding),
  };
}

export async function dbProjectExists(projectId: string): Promise<boolean> {
  const db = sql();
  const rows = (await db`select 1 from projects where id = ${projectId}`) as unknown[];
  return rows.length > 0;
}

/**
 * Registers a repo for scanning without any findings yet — the "Add repo"
 * flow's write side. `scanned_at` stays null, which is exactly what
 * ProjectShell/the home page grid use to render a "not yet scanned" state
 * instead of a findings count. The actual scan (CodeAnalyzer + LLMProvider)
 * still has to run somewhere with the repo checked out — see the CLI
 * command the dashboard shows after registering — this just reserves the
 * project id/name/repoUrl ahead of that.
 */
export async function dbRegisterProject(project: ProjectMeta): Promise<void> {
  const db = sql();
  await db`
    insert into projects (id, name, repo_url, scanned_at)
    values (${project.id}, ${project.name}, ${project.repoUrl ?? null}, null)
  `;
}

/**
 * Upserts a project and its findings in one call — the write side of the
 * scan → dashboard handoff (CLI/GitHub Action output landing in the DB
 * instead of scan-output/<project-id>.json). Always resets
 * billing_upload_id to null: a fresh scan's own estimate is never tied to a
 * dashboard-tracked CUR upload, and leaving a stale pointer from a previous
 * upload would make BillingProvenanceBadge wrongly claim "real CUR data"
 * for numbers this rescan just overwrote.
 */
export async function dbUpsertProject(data: ProjectData): Promise<void> {
  const db = sql();
  const { project, findings } = data;

  await db`
    insert into projects (id, name, repo_url, scanned_at)
    values (${project.id}, ${project.name}, ${project.repoUrl ?? null}, ${project.scannedAt ?? null})
    on conflict (id) do update set
      name = excluded.name,
      repo_url = excluded.repo_url,
      scanned_at = excluded.scanned_at
  `;

  for (const finding of findings) {
    const estimate = finding.estimate;
    await db`
      insert into findings (
        id, project_id, rule_id, severity, file_path, start_line, end_line, snippet, message,
        explanation, suggested_fix_diff, idempotency_key, autofix,
        estimate_kg_co2e, estimate_methodology, estimate_grid_intensity_gco2_per_kwh,
        estimate_confidence, estimate_cost_usd, billing_upload_id
      )
      values (
        ${finding.id}, ${project.id}, ${finding.ruleId}, ${finding.severity}, ${finding.filePath},
        ${finding.startLine}, ${finding.endLine}, ${finding.snippet}, ${finding.message},
        ${finding.explanation ?? null}, ${finding.suggestedFixDiff ?? null}, ${finding.idempotencyKey ?? null},
        ${finding.autofix ? JSON.stringify(finding.autofix) : null},
        ${estimate?.kgCO2e ?? null}, ${estimate?.methodology ?? null}, ${estimate?.gridIntensityGco2PerKwh ?? null},
        ${estimate?.confidence ?? null}, ${estimate?.costUsd ?? null}, null
      )
      on conflict (project_id, id) do update set
        rule_id = excluded.rule_id,
        severity = excluded.severity,
        file_path = excluded.file_path,
        start_line = excluded.start_line,
        end_line = excluded.end_line,
        snippet = excluded.snippet,
        message = excluded.message,
        explanation = excluded.explanation,
        suggested_fix_diff = excluded.suggested_fix_diff,
        idempotency_key = excluded.idempotency_key,
        autofix = excluded.autofix,
        estimate_kg_co2e = excluded.estimate_kg_co2e,
        estimate_methodology = excluded.estimate_methodology,
        estimate_grid_intensity_gco2_per_kwh = excluded.estimate_grid_intensity_gco2_per_kwh,
        estimate_confidence = excluded.estimate_confidence,
        estimate_cost_usd = excluded.estimate_cost_usd,
        billing_upload_id = excluded.billing_upload_id
    `;
  }
}

/**
 * Records that a CUR file was uploaded for a project — the provenance row
 * the dashboard can point to so a viewer can tell real billing data from
 * the bundled sample fallback, instead of an unlabeled dollar figure.
 */
export async function dbRecordBillingUpload(
  projectId: string,
  params: { sourceType: BillingSourceType; filename: string | null; recordCount: number }
): Promise<BillingUpload> {
  const db = sql();
  const rows = (await db`
    insert into billing_uploads (project_id, source_type, filename, record_count)
    values (${projectId}, ${params.sourceType}, ${params.filename}, ${params.recordCount})
    returning id, project_id, source_type, filename, record_count, uploaded_at
  `) as Array<{
    id: string;
    project_id: string;
    source_type: BillingSourceType;
    filename: string | null;
    record_count: number;
    uploaded_at: string;
  }>;
  const row = rows[0];
  return {
    id: row.id,
    projectId: row.project_id,
    sourceType: row.source_type,
    filename: row.filename,
    recordCount: row.record_count,
    uploadedAt: row.uploaded_at,
  };
}

/**
 * Applies freshly correlated estimates (from correlateFindingsWithUsage) onto
 * a project's stored findings, and tags each updated finding with the
 * upload that produced its number. First clears every existing estimate for
 * the project — an uploaded CUR file is the new source of truth for billing
 * correlation, so a finding whose service has no usage in it should show as
 * "not correlated" rather than keep displaying a stale number from a
 * previous upload (or from the CLI's original scan, which may have used the
 * bundled sample data rather than anything real).
 */
export async function dbApplyEstimates(
  projectId: string,
  estimateByFindingId: Map<string, CarbonEstimate>,
  billingUploadId: string
): Promise<void> {
  const db = sql();
  await db`
    update findings
    set
      estimate_kg_co2e = null,
      estimate_methodology = null,
      estimate_grid_intensity_gco2_per_kwh = null,
      estimate_confidence = null,
      estimate_cost_usd = null,
      billing_upload_id = null
    where project_id = ${projectId}
  `;
  for (const [findingId, estimate] of estimateByFindingId) {
    await db`
      update findings
      set
        estimate_kg_co2e = ${estimate.kgCO2e},
        estimate_methodology = ${estimate.methodology},
        estimate_grid_intensity_gco2_per_kwh = ${estimate.gridIntensityGco2PerKwh},
        estimate_confidence = ${estimate.confidence},
        estimate_cost_usd = ${estimate.costUsd},
        billing_upload_id = ${billingUploadId}
      where project_id = ${projectId} and id = ${findingId}
    `;
  }
}

/**
 * Latest upload whose correlation is still live — i.e. at least one current
 * finding's billing_upload_id still points to it. billing_uploads is a
 * history table; a row surviving there after a rescan reset every
 * finding's billing_upload_id to null (see dbUpsertProject) would make this
 * wrongly report "real CUR data" for numbers the rescan already overwrote.
 */
export async function dbGetLatestBillingUpload(projectId: string): Promise<BillingUpload | null> {
  const db = sql();
  const rows = (await db`
    select bu.id, bu.project_id, bu.source_type, bu.filename, bu.record_count, bu.uploaded_at
    from billing_uploads bu
    where bu.project_id = ${projectId}
      and exists (select 1 from findings f where f.billing_upload_id = bu.id)
    order by bu.uploaded_at desc
    limit 1
  `) as Array<{
    id: string;
    project_id: string;
    source_type: BillingSourceType;
    filename: string | null;
    record_count: number;
    uploaded_at: string;
  }>;
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    projectId: row.project_id,
    sourceType: row.source_type,
    filename: row.filename,
    recordCount: row.record_count,
    uploadedAt: row.uploaded_at,
  };
}

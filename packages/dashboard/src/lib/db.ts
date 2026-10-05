import type { CarbonEstimate, EnrichedFinding, Severity } from "@terratrace/core";
import type { ProjectData, ProjectMeta } from "./projects";
import { createSql } from "./sql";
import type { StatsFinding } from "./stats";

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
  return createSql(url);
}

interface ProjectRow {
  id: string;
  name: string;
  repo_url: string | null;
  scanned_at: string | null;
  billing_linked: boolean;
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
  pr_url: string | null;
}

function toProjectMeta(row: ProjectRow): ProjectMeta {
  return {
    id: row.id,
    name: row.name,
    repoUrl: row.repo_url ?? undefined,
    scannedAt: row.scanned_at ?? undefined,
    billingLinked: row.billing_linked,
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
    prUrl: row.pr_url ?? undefined,
  };
}

export async function dbLoadAllProjects(): Promise<ProjectData[]> {
  const db = sql();
  const projectRows = (await db`select id, name, repo_url, scanned_at, billing_linked from projects`) as ProjectRow[];

  return Promise.all(
    projectRows.map(async (projectRow) => {
      const findingRows = (await db`
        select id, rule_id, severity, file_path, start_line, end_line, snippet, message,
               explanation, suggested_fix_diff, idempotency_key, autofix,
               estimate_kg_co2e, estimate_methodology, estimate_grid_intensity_gco2_per_kwh,
               estimate_confidence, estimate_cost_usd, billing_upload_id, pr_url
        from findings
        where project_id = ${projectRow.id} and remediated_at is null
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
  // Independent of the project row, so fire both together — a missing
  // project just discards the (empty) findings result.
  const [projectRows, findingRows] = (await Promise.all([
    db`select id, name, repo_url, scanned_at, billing_linked from projects where id = ${projectId}`,
    db`
      select id, rule_id, severity, file_path, start_line, end_line, snippet, message,
             explanation, suggested_fix_diff, idempotency_key, autofix,
             estimate_kg_co2e, estimate_methodology, estimate_grid_intensity_gco2_per_kwh,
             estimate_confidence, estimate_cost_usd, billing_upload_id, pr_url
      from findings
      where project_id = ${projectId} and remediated_at is null
    `,
  ])) as [ProjectRow[], FindingRow[]];
  const projectRow = projectRows[0];
  if (!projectRow) return null;

  return {
    project: toProjectMeta(projectRow),
    findings: findingRows.map(toEnrichedFinding),
  };
}

export interface SlimProjectData {
  project: ProjectMeta;
  findings: StatsFinding[];
}

/**
 * Home-page loader: only the columns computeStats/computeServiceBreakdown
 * read (no snippet/explanation/diff/autofix payloads), fetched in two
 * queries total regardless of project count instead of one per project.
 * suggested_fix_diff is reduced to a boolean in SQL since stats only need
 * "was a validated fix produced".
 */
export async function dbLoadAllProjectsSlim(): Promise<SlimProjectData[]> {
  const db = sql();
  const [projectRows, findingRows] = (await Promise.all([
    db`select id, name, repo_url, scanned_at, billing_linked from projects`,
    db`
      select project_id, rule_id, severity, file_path,
             (suggested_fix_diff is not null) as has_fix,
             estimate_kg_co2e, estimate_methodology, estimate_grid_intensity_gco2_per_kwh,
             estimate_confidence, estimate_cost_usd
      from findings
      where remediated_at is null
    `,
  ])) as [
    ProjectRow[],
    Array<
      Pick<
        FindingRow,
        | "rule_id"
        | "severity"
        | "file_path"
        | "estimate_kg_co2e"
        | "estimate_methodology"
        | "estimate_grid_intensity_gco2_per_kwh"
        | "estimate_confidence"
        | "estimate_cost_usd"
      > & { project_id: string; has_fix: boolean }
    >,
  ];

  const byProject = new Map<string, StatsFinding[]>();
  for (const row of findingRows) {
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
    const list = byProject.get(row.project_id) ?? [];
    list.push({
      ruleId: row.rule_id,
      severity: row.severity,
      filePath: row.file_path,
      estimate,
      suggestedFixDiff: row.has_fix ? "1" : undefined,
    });
    byProject.set(row.project_id, list);
  }

  return projectRows.map((projectRow) => ({
    project: toProjectMeta(projectRow),
    findings: byProject.get(projectRow.id) ?? [],
  }));
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

/** Removes a project and (via cascade) its findings/billing_uploads — only ever touches TerraTrace's own DB rows, never the target repo itself. */
export async function dbDeleteProject(projectId: string): Promise<void> {
  const db = sql();
  await db`delete from projects where id = ${projectId}`;
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

  // Reconcile against the previous scan before upserting the new one: a
  // finding that was active before but is absent from this fresh scan
  // either got fixed (if it had an open PR, that's the merge — mark
  // remediated_at rather than deleting, so remediation counts survive) or
  // just disappeared with no PR behind it (stale, delete outright — never
  // tracked as in-progress). Findings still present just get upserted
  // below, unchanged in this step.
  const currentIds = findings.map((f) => f.id);
  await db`
    update findings
    set remediated_at = now()
    where project_id = ${project.id}
      and remediated_at is null
      and pr_url is not null
      and id != all(${currentIds})
  `;
  await db`
    delete from findings
    where project_id = ${project.id}
      and remediated_at is null
      and pr_url is null
      and id != all(${currentIds})
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
  const clear = db`
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
  if (estimateByFindingId.size === 0) {
    await clear;
    return;
  }

  const ids: string[] = [];
  const kg: number[] = [];
  const methodology: string[] = [];
  const intensity: number[] = [];
  const confidence: string[] = [];
  const cost: number[] = [];
  for (const [findingId, estimate] of estimateByFindingId) {
    ids.push(findingId);
    kg.push(estimate.kgCO2e);
    methodology.push(estimate.methodology);
    intensity.push(estimate.gridIntensityGco2PerKwh);
    confidence.push(estimate.confidence);
    cost.push(estimate.costUsd);
  }

  // One round trip (and one transaction, so a failure can't leave estimates
  // cleared but not re-applied) instead of an UPDATE per finding.
  await db.transaction([
    clear,
    db`
      update findings f
      set
        estimate_kg_co2e = e.kg,
        estimate_methodology = e.methodology,
        estimate_grid_intensity_gco2_per_kwh = e.intensity,
        estimate_confidence = e.confidence,
        estimate_cost_usd = e.cost,
        billing_upload_id = ${billingUploadId}
      from unnest(
        ${ids}::text[], ${kg}::float8[], ${methodology}::text[],
        ${intensity}::float8[], ${confidence}::text[], ${cost}::float8[]
      ) as e(id, kg, methodology, intensity, confidence, cost)
      where f.project_id = ${projectId} and f.id = e.id
    `,
  ]);
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

export interface BillingUploadHistoryEntry extends BillingUpload {
  projectName: string;
  /** How many of this project's findings still carry this upload's estimate — 0 means a later upload or rescan has since superseded it. */
  findingsStillLinked: number;
}

/** Org-wide upload history for the Pipeline page — every upload ever made, newest first, regardless of whether it's still the live correlation for its project (see dbGetLatestBillingUpload for that narrower "still live" query). */
export async function dbListBillingUploads(limit = 50): Promise<BillingUploadHistoryEntry[]> {
  const db = sql();
  const rows = (await db`
    select
      bu.id, bu.project_id, bu.source_type, bu.filename, bu.record_count, bu.uploaded_at,
      p.name as project_name,
      (select count(*) from findings f where f.billing_upload_id = bu.id) as findings_still_linked
    from billing_uploads bu
    join projects p on p.id = bu.project_id
    order by bu.uploaded_at desc
    limit ${limit}
  `) as Array<{
    id: string;
    project_id: string;
    source_type: BillingSourceType;
    filename: string | null;
    record_count: number;
    uploaded_at: string;
    project_name: string;
    findings_still_linked: number;
  }>;
  return rows.map((row) => ({
    id: row.id,
    projectId: row.project_id,
    sourceType: row.source_type,
    filename: row.filename,
    recordCount: row.record_count,
    uploadedAt: row.uploaded_at,
    projectName: row.project_name,
    findingsStillLinked: Number(row.findings_still_linked),
  }));
}

export interface RemediationCandidate {
  id: string;
  ruleId: string;
  filePath: string;
  message: string;
  suggestedFixDiff: string;
  idempotencyKey: string | null;
}

/**
 * Findings ready to have a PR raised: a validated fix diff, no PR opened
 * for them yet, and still active (not already remediated by an earlier
 * one). Pass findingId to scope to a single finding (the per-finding
 * "Create PR" button) — omit it for the bulk "Raise PRs for fixes" action.
 */
export async function dbGetRemediationCandidates(
  projectId: string,
  findingId?: string
): Promise<RemediationCandidate[]> {
  const db = sql();
  const rows = (findingId
    ? await db`
        select id, rule_id, file_path, message, suggested_fix_diff, idempotency_key
        from findings
        where project_id = ${projectId} and id = ${findingId}
          and suggested_fix_diff is not null and pr_url is null and remediated_at is null
      `
    : await db`
        select id, rule_id, file_path, message, suggested_fix_diff, idempotency_key
        from findings
        where project_id = ${projectId}
          and suggested_fix_diff is not null and pr_url is null and remediated_at is null
      `) as Array<{
    id: string;
    rule_id: string;
    file_path: string;
    message: string;
    suggested_fix_diff: string;
    idempotency_key: string | null;
  }>;
  return rows.map((row) => ({
    id: row.id,
    ruleId: row.rule_id,
    filePath: row.file_path,
    message: row.message,
    suggestedFixDiff: row.suggested_fix_diff,
    idempotencyKey: row.idempotency_key,
  }));
}

/** Records that remediate-repo.yml successfully opened a PR for a finding — "in progress", not "fixed" (see schema.sql's remediated_at comment). */
export async function dbMarkFindingPrOpened(projectId: string, findingId: string, prUrl: string): Promise<void> {
  const db = sql();
  await db`
    update findings set pr_url = ${prUrl}, pr_opened_at = now()
    where project_id = ${projectId} and id = ${findingId}
  `;
}

export interface RemediationCounts {
  /** Active findings with a validated fix ready but no PR raised yet. */
  readyCount: number;
  /** Active findings with an open PR, not yet merged/detected as fixed. */
  inProgressCount: number;
  /** Findings a later rescan confirmed as actually fixed (merged PR removed the code). */
  remediatedCount: number;
}

export async function dbGetRemediationCounts(projectId: string): Promise<RemediationCounts> {
  const db = sql();
  const rows = (await db`
    select
      count(*) filter (where remediated_at is null and suggested_fix_diff is not null and pr_url is null) as ready_count,
      count(*) filter (where remediated_at is null and pr_url is not null) as in_progress_count,
      count(*) filter (where remediated_at is not null) as remediated_count
    from findings
    where project_id = ${projectId}
  `) as Array<{ ready_count: number; in_progress_count: number; remediated_count: number }>;
  const row = rows[0];
  return {
    readyCount: Number(row?.ready_count ?? 0),
    inProgressCount: Number(row?.in_progress_count ?? 0),
    remediatedCount: Number(row?.remediated_count ?? 0),
  };
}

/**
 * Toggles whether a project's billing actually runs through the AWS
 * account a CUR upload represents — see projects.billing_linked's schema
 * comment. Off by default for every project; a global CUR upload only
 * ever touches projects where this is true.
 */
export async function dbSetBillingLinked(projectId: string, linked: boolean): Promise<void> {
  const db = sql();
  await db`update projects set billing_linked = ${linked} where id = ${projectId}`;
}

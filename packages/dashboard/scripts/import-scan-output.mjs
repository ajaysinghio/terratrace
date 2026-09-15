// Pushes scan-output/<project-id>.json file(s) into the DB configured via
// DATABASE_URL, so the dashboard has something to read from the DB path in
// src/lib/projects.ts.
//
// Run with: node --env-file=.env scripts/import-scan-output.mjs [file]
//
// With no argument, imports every .json file in scan-output/ (local dev
// convenience). With a filename argument, imports only that one file — used
// by the central "scan a registered repo" GitHub Actions workflow
// (.github/workflows/scan-repo.yml), which must NOT reimport every other
// committed scan-output/*.json on each run: those files' `estimate` fields
// are null (a fresh CLI scan has no billing correlation yet), and
// reimporting them would silently wipe out other projects' already-uploaded
// CUR correlation (see dbApplyEstimates's "clear then apply" comment in
// db.ts for why an estimate reset is meant to happen only for the project
// actually being written to).
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const SCAN_OUTPUT_DIR = path.join(dirname, "..", "..", "..", "scan-output");

async function readProjectFile(filePath) {
  try {
    const raw = await readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    if (!parsed.project || !Array.isArray(parsed.findings)) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function upsertProject(sql, { project, findings }) {
  await sql`
    insert into projects (id, name, repo_url, scanned_at)
    values (${project.id}, ${project.name}, ${project.repoUrl ?? null}, ${project.scannedAt ?? null})
    on conflict (id) do update set
      name = excluded.name,
      repo_url = excluded.repo_url,
      scanned_at = excluded.scanned_at
  `;

  // Reconcile against the previous scan before upserting the new one: a
  // finding active before but absent from this fresh scan either got fixed
  // (if it had an open PR, that's the merge — mark remediated_at rather
  // than deleting, so remediation counts survive) or just disappeared with
  // no PR behind it (stale, delete outright — never tracked as in-progress).
  const currentIds = findings.map((f) => f.id);
  await sql`
    update findings
    set remediated_at = now()
    where project_id = ${project.id}
      and remediated_at is null
      and pr_url is not null
      and id != all(${currentIds})
  `;
  await sql`
    delete from findings
    where project_id = ${project.id}
      and remediated_at is null
      and pr_url is null
      and id != all(${currentIds})
  `;

  for (const finding of findings) {
    const estimate = finding.estimate;
    // billing_upload_id is always reset to null here — a fresh scan's own
    // estimate (CLI's sample-data fallback, since no CUR is wired into the
    // scan step) is never tied to a dashboard-tracked upload. Leaving a
    // stale pointer from a previous CUR upload would make
    // BillingProvenanceBadge wrongly claim "real CUR data" for numbers a
    // rescan just overwrote.
    await sql`
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

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL is not set.");
    process.exit(1);
  }

  const singleFileArg = process.argv[2];
  let jsonFiles;
  if (singleFileArg) {
    jsonFiles = [path.basename(singleFileArg)];
  } else {
    let entries;
    try {
      entries = await readdir(SCAN_OUTPUT_DIR);
    } catch {
      console.error(`No scan-output directory found at ${SCAN_OUTPUT_DIR}.`);
      process.exit(1);
    }
    jsonFiles = entries.filter((entry) => entry.endsWith(".json"));
    if (jsonFiles.length === 0) {
      console.error(`No .json files found in ${SCAN_OUTPUT_DIR}.`);
      process.exit(1);
    }
  }

  const sql = neon(databaseUrl);

  for (const file of jsonFiles) {
    const data = await readProjectFile(path.join(SCAN_OUTPUT_DIR, file));
    if (!data) {
      console.warn(`Skipping ${file}: not a valid { project, findings } shape.`);
      continue;
    }
    await upsertProject(sql, data);
    console.log(`Imported ${data.project.id} (${data.findings.length} findings) from ${file}.`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

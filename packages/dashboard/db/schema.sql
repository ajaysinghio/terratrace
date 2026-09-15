-- TerraTrace dashboard findings store.
--
-- Replaces the flat scan-output/<project-id>.json file read (see
-- src/lib/projects.ts) with a real database so uploaded CUR files can
-- re-correlate cost/carbon onto findings that were scanned separately
-- (by the CLI or GitHub Action) without needing that repo checked out.
--
-- Apply with: pnpm --filter @terratrace/dashboard run db:init

create table if not exists projects (
  id text primary key,
  name text not null,
  repo_url text,
  scanned_at timestamptz
);

create table if not exists billing_uploads (
  id uuid primary key default gen_random_uuid(),
  project_id text not null references projects (id) on delete cascade,
  -- 'cur_upload' = a CUR CSV uploaded through the dashboard;
  -- 'sample' = the bundled sample-data/aws-cur-sample.csv fallback,
  -- recorded so the UI can say plainly that numbers aren't from real
  -- billing data yet.
  source_type text not null check (source_type in ('cur_upload', 'sample')),
  filename text,
  record_count integer not null default 0,
  uploaded_at timestamptz not null default now()
);

create table if not exists findings (
  -- Composite key: a finding's own id is only unique within its project.
  id text not null,
  project_id text not null references projects (id) on delete cascade,
  rule_id text not null,
  severity text not null check (severity in ('low', 'medium', 'high')),
  file_path text not null,
  start_line integer not null,
  end_line integer not null,
  snippet text not null,
  message text not null,
  explanation text,
  suggested_fix_diff text,
  idempotency_key text,
  autofix jsonb,
  -- CarbonEstimate fields, nullable until a billing source has been
  -- correlated against this finding at least once.
  estimate_kg_co2e double precision,
  estimate_methodology text check (estimate_methodology in ('sci', 'ccf-derived')),
  estimate_grid_intensity_gco2_per_kwh double precision,
  estimate_confidence text check (estimate_confidence in ('low', 'medium', 'high')),
  estimate_cost_usd double precision,
  -- Which upload last produced this finding's estimate, if any — this is
  -- the provenance link the dashboard uses to show "real CUR" vs "sample
  -- data" vs "not yet correlated" for the numbers on screen.
  billing_upload_id uuid references billing_uploads (id) on delete set null,
  primary key (project_id, id)
);

create index if not exists findings_project_id_idx on findings (project_id);
create index if not exists findings_billing_upload_id_idx on findings (billing_upload_id);
create index if not exists billing_uploads_project_id_idx on billing_uploads (project_id);

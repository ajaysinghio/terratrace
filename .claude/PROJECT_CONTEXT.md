# TerraTrace — resumable project context

Working notes for picking this project back up in a fresh session, alongside
`CLAUDE.md` (architecture rules) and `CONTRIBUTING.md` (setup/secrets). This
file is history + "what's actually built," not rules — update it as things
change instead of letting it drift stale.

## What's live today

- **Dashboard** (`packages/dashboard`, Next.js App Router) deployed on Vercel.
  Public landing page with corner sign-in (GitHub OAuth), role-based views
  (`?view=executive|manager|engineer`, `ROLE_RANK` gating), light/dark theming.
- **Findings store**: Neon Postgres, not flat JSON files. Schema in
  `packages/dashboard/db/schema.sql`. Access layer: `packages/dashboard/src/lib/db.ts`.
- **Scanning is centralized and read-only.** `.github/workflows/scan-repo.yml`
  is a `workflow_dispatch` pipeline that can scan *any* registered repo
  (including third-party OSS repos) with zero setup on the target repo. It
  has an explicit "DO NOT ADD PR/COMMIT/PUSH STEPS HERE" guarantee — never
  break that invariant. Results land via `packages/dashboard/scripts/import-scan-output.mjs`.
- **Remediation is a fully separate, explicitly-triggered pipeline.**
  `.github/workflows/remediate-repo.yml` + `packages/dashboard/scripts/remediate.mjs`
  open real GitHub PRs (bulk or per-finding) via the Octokit Contents/Git Data
  API — no local checkout needed for the target repo. A PR = "in progress,"
  never "remediated." True remediation is only detected on a later rescan
  when the finding no longer reappears (implying the PR merged).
- **AWS CUR billing** is org/account-wide: one CUR CSV upload re-correlates
  every project, but only those **opted in** via `projects.billing_linked`
  (`BillingLinkToggle` component, default off). This exists specifically to
  stop OSS repos with no real relationship to the demo AWS account from
  getting bogus cost/carbon numbers.
- **Compute Optimizer cross-reference** (`317ac82`) — rightsizing findings
  are now backed by real AWS Compute Optimizer data, not guessed.
- **AI engineering maturity additions** in `@terratrace/core`:
  - Rule-specific fix guidance: `packages/core/src/llm/ruleSkills.ts`.
  - Prompt-injection guardrail + `<untrusted_evidence>` delimiters in
    `AnthropicProvider.ts`.
  - Diff-target validation (`diffTargetsWrongFile`) rejecting fixes that
    touch the wrong file in `recommendFinding.ts`.
  - LLM call budget cap: `TERRATRACE_MAX_LLM_FINDINGS` in `packages/cli/src/index.ts`.
  - A real eval test against a planted N+1 finding:
    `packages/core/src/recommend/__evals__/recommendFinding.eval.test.ts`.
- **Demo repos**: two real independent GitHub repos owned by the user —
  `orders-service` and `infra` — plus registered third-party OSS repos
  (`spring-petclinic`, `unicorn-store-spring`) to prove the centralized
  scan pipeline works on repos with zero TerraTrace awareness.

## Known, accepted limitations (not bugs — don't "fix" without asking)

- Cost correlation matches by AWS service only, not resource tags — two
  linked projects sharing a service could double-count.
- `packages/github-action/dist`'s committed bundle only has darwin-arm64
  tree-sitter prebuilds. Doesn't affect `scan-repo.yml`/`remediate-repo.yml`
  (they build from source in CI) — only the less-used direct
  `uses: .../github-action@main` consumption path.

## Next up (chosen 2026-10-05, awaiting go-ahead to start)

- **"Ask TerraTrace"** — grounded Q&A box on each project drill-down page.
  `POST /api/projects/[projectId]/ask` checks session + role, loads that
  project's findings from Neon, builds `EvidenceBundle[]`, and calls
  `LLMProvider.answerQuery()` via `@terratrace/core` only (already
  implemented in `AnthropicProvider.ts`; nothing in the dashboard calls it
  yet). New `AskBox.tsx` on the project page; any links it renders must
  carry `?view=${role}`. Reuse the `<untrusted_evidence>` delimiters and
  prompt-injection guard, add a per-request cost cap, and refuse to answer
  from outside the evidence. Tests: unit test of bundle-building (no API
  call) plus one eval in the style of `recommendFinding.eval.test.ts`
  against the planted N+1 finding.
  - Open questions before starting: `ANTHROPIC_API_KEY` available locally
    for the eval (else stub provider from `cli/src/harness.ts`); which roles
    may ask (default manager and above); local DB vs fixture findings for
    testing.

## Performance pass (2026-10-05, uncommitted)

- Done: parallel queries on the project page and in `dbLoadProject`; slim
  home-page loader (`dbLoadAllProjectsSlim`, 2 queries total, no
  snippets/diffs; `computeStats` now takes `StatsFinding`); GitHub in-progress
  scan call runs alongside the DB load with a 3s timeout; `dbApplyEstimates`
  is one `unnest` UPDATE in a transaction; CUR upload handles projects
  concurrently.
- **Decision: no response/data caching** (`unstable_cache`, `revalidateTag`,
  `use cache`) — the app is fully data-driven and staleness after a scan,
  upload or PR would be a correctness problem. Keep `force-dynamic`.
- Also done: all recharts code moved to `components/Charts.tsx` and loaded via
  `next/dynamic` from `Dashboard.tsx` (own ~400KB chunk; `lib/format.ts` holds
  the shared `formatUsd`/`shortPath`). Keep new recharts usage in `Charts.tsx`.
- Not done: Vercel/Neon region check,
  Neon cold-start mitigation, batching `scripts/import-scan-output.mjs`
  (CI-only path).

## Offline demo / DR copy (2026-10-05, uncommitted)

- `docker-compose.yml` (postgres:18 to match Neon's 18.x, port 5433),
  `packages/dashboard/src/lib/sql.ts` (uses `pg` for a localhost
  `DATABASE_URL`, Neon HTTP driver otherwise), `scripts/local-db.sh`
  (`db:local:dump|restore|sync`), `start:offline` script. Only `db.ts` goes
  through the adapter; `init-db.mjs`, `import-scan-output.mjs`, `remediate.mjs`
  still use `neon()` directly (CI/Neon-only paths).
- Verified: sync round-trips; all pages 200 against local; CUR upload
  (the unnest transaction) works on real Postgres.

## On hold (explicitly deferred 2026-10-05)

- CloudWatch utilization (see the `GetMetricData` item below). Scoped as:
  optional `avgCpuUtil` on `UsageRecord`, `estimateEc2Kwh` uses it over
  `CCF_AVG_CPU_UTIL`, `"high"` confidence at >=80% measured kWh, a small
  `UtilizationSource` seam (synthetic + real CloudWatch implementations),
  join by `resourceId` before correlation. Check first whether the sample
  CUR's `resourceId` is an instance ID or a type. Do not start without a
  fresh go-ahead.

## Discussed but NOT started (no go-ahead given yet)

- Wiring `LLMProvider.answerQuery()` into the dashboard UI (promoted to
  "Next up" above).
- MCP server integration.
- AI-based false-positive filtering.
- Real CloudWatch `GetMetricData` integration (`AWS/EC2`/`AWS/RDS`,
  `CPUUtilization`, stat `Average`) to replace the hardcoded
  `CCF_AVG_CPU_UTIL = 0.5` in `packages/core/src/carbon/coefficients/aws.ts`
  — this is the reason `estimateCarbon` never reports `"high"` confidence
  for EC2/RDS today (only the Compute Optimizer cross-reference path does).
  No public dataset of real utilization values exists (account-specific);
  plan is a synthetic `GetMetricData`-shaped generator alongside
  `scripts/generate-aws-cur-sample.mjs`, with a real
  `@aws-sdk/client-cloudwatch` call behind the same seam for production.
- AWS compute migration — **still planning only**, refined 2026-10-04:
  static `/` landing page on GitHub Pages or Vercel (unauthenticated, matches
  `proxy.ts`'s existing "only `/` is public" rule); authenticated dashboard
  app (`/dashboard`, `/projects/*`, `/api/*`) on **AWS Amplify Hosting**
  (true scale-to-zero SSR, least setup) as the default recommendation over
  hand-rolling OpenNext + Lambda + CloudFront + S3. Keep **Neon**, don't
  migrate to RDS/Aurora Serverless v2 (its ~0.5 ACU floor costs more idle
  than Neon's free tier) — this also avoids needing a VPC/NAT Gateway, the
  single biggest cost trap for a prototype. No ALB/ECS/Fargate/EC2 (all
  have an always-on hourly cost). Secrets via SSM Parameter Store (free)
  over Secrets Manager for a prototype. GitHub Actions workflows
  (`scan-repo.yml`/`remediate-repo.yml`) are host-agnostic, unaffected
  either way. Do not start migrating off Vercel/GitHub Actions without a
  fresh, explicit ask.

## Demo reference artifact (2026-10-04)

A full internals/Q&A reference for presenting this app was compiled from
live source (not assumption) and published as an artifact:
**"TerraTrace Internals"** — https://claude.ai/artifact/SzQzGikEaJZNbVn94LVFDP
Covers: the three-interface architecture, the Semgrep-based detection
engine (corrects an earlier "Python-only" misreading — Semgrep covers
Python/Java/Terraform; tree-sitter is a secondary, currently-unused-by-default
Python path), all 6 detection rules verbatim, the CCF-derived carbon math
formula and constants, billing correlation/apportionment logic, the LLM
provider's prompts and guardrails, the CLI/GitHub Action pipelines, the
role-access matrix, the DB schema, and a live Q&A crib sheet. Source file:
`scripts/generate-aws-cur-sample.mjs` was also edited this session (`DAYS`
3 → 30) to make the bundled sample CUR represent a full month instead of 3
days — `sample-data/aws-cur-sample*.csv` were regenerated accordingly.
These generator/data changes are uncommitted as of this writing (only
commit when explicitly asked).

## Strong user preferences (see also CLAUDE.md, CONTRIBUTING.md)

- Scanning must never write to the target repo, ever. Remediation is a
  separate, human-triggered action — this was a repeated, emphatic
  correction ("why would I raise PRs unnecessary").
- A PR is "in progress," not "remediated" — remediated status is only
  inferred from a clean rescan.
- Prefer using the same GitHub token/secrets already wired up over
  introducing new scoped-token machinery, unless asked.
- Navigation must preserve the `?view=` role param everywhere — this was a
  real, thoroughly-audited bug (home logo/link dropping role, hiding
  manager-gated tiles). Any new nav link must carry `?view=${role}`.

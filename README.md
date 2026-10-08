# TerraTrace

Traces cloud carbon and cost impact back to the specific function and line of
code that caused it — then uses Claude to explain the causal link across code,
billing, and infra evidence together, and to generate an actual fix diff (not
a generic suggestion).

Existing tools (AWS/GCP carbon dashboards, Cloud Carbon Footprint,
Terraform-plan-diff bots) stop at the infrastructure/billing layer or the IaC
diff. None of them trace carbon back into application code logic with
LLM-based reasoning that spans multiple evidence sources at once — that gap is
what TerraTrace fills. A live grid-carbon-intensity signal (planned) lets it
also recommend *when* to run batch workloads.

**What works today** (prototype, `v0.1`):

- **Scan** Python, Java and Terraform with six declarative Semgrep rules
  (N+1 queries, unbounded queries, chatty S3 loops, oversized instances,
  missing S3 lifecycle policies, autoscaling groups that never scale down).
- **Correlate** findings with AWS billing from a Cost and Usage Report (local
  CSV or S3), and cross-check rightsizing against an AWS Compute Optimizer
  export, to estimate dollars and kgCO2e per finding.
- **Explain and fix** with Claude, from a structured evidence bundle, with the
  fix validated by re-scanning before it is offered.
- **Dashboard** (Next.js on Vercel, Neon Postgres): an org-wide view, a
  per-project drill-down with three role views, and buttons to scan a repo,
  upload a CUR file and raise fix PRs.
- **Centralized pipelines** (GitHub Actions) that scan any registered repo
  read-only, and a separate, explicitly triggered one that opens fix PRs.
- **Offline demo** from a laptop with a local Postgres copy of the data.

## How this differs from AWS's Customer Carbon Footprint Tool (CCFT)

The most common "why not just use the free thing?" question. CCFT is AWS's
built-in dashboard that shows a customer's carbon footprint per service /
region / month. It's the primary comparator TerraTrace has to beat.

| Dimension | AWS CCFT | TerraTrace |
|---|---|---|
| **Attribution depth** | Stops at *service × region × month* | Traces down to the *function / line of code* that amplified an RDS or Lambda bill |
| **Output type** | A number in a dashboard | A number + an LLM-generated **fix diff** a developer can apply |
| **Scope of estate** | AWS only | Application code and Terraform alongside AWS billing today. On-prem is a planned extension (the provider type and a grid-intensity hook exist; there is no on-prem ingestion yet) |
| **Timeframe** | Retrospective only (3-month lag) | Retrospective, plus "fix this code" recommendations with an estimated impact. Region-shift and migrate-this-workload what-ifs are planned, not built |
| **Methodology** | Proprietary, market-based (includes AWS's PPA/renewables offsets) — usually produces *lower* numbers | Cloud Carbon Footprint's **open, location-based** methodology — defensible in public-sector tenders that want location-based figures |
| **Pre-cloud clients** | Nothing to show — no AWS spend yet | Planned: an on-prem mode for a pre-migration baseline that becomes the "before" in the migration business case. Today the code and Terraform scan works without any cloud spend, but without carbon figures |

**When CCFT is actually the right pick** (be honest about this): a client
already fully in AWS who just wants a monthly compliance snapshot and doesn't
care about *what to change* is served fine by CCFT. TerraTrace is overkill
there — don't pitch against that use case.

**Where TerraTrace wins:**

- Public-sector / EU tenders that score sustainability — they typically want
  location-based figures, not AWS's market-based number that credits
  renewables offsets. TerraTrace cites CCF's published methodology openly;
  CCFT's calc has to be hand-waved.
- Pre-migration engagements — CCFT gives them zero. The code and Terraform
  scan still applies, and the planned on-prem mode would add a baseline.
- Modernisation engagements where the value ask is *"what should we change?"*
  not *"what did we emit?"* — CCFT cannot answer that at all.

**Honest caveat on the numbers:** carbon figures use CCF's methodology, but
the wattage and grid-intensity tables in `packages/core/src/carbon/coefficients/`
are approximate seed values (flagged in the code), and CPU utilization is fixed
at CCF's 50% default, so estimates are at most *medium* confidence. Replace
the constants with CCF's published ones before quoting a figure to a client.

One-line positioning: *CCFT tells you what your AWS carbon was last quarter.
TerraTrace tells you which loop in which service caused it, gives you a fix
diff, and also works for the on-prem and pre-migration parts of the estate
that CCFT can't see.*

## Repo structure

```
terratrace/
├── package.json                  root workspace scripts (build, typecheck, test, scan)
├── pnpm-workspace.yaml           packages: "packages/*", native-build allow-list
├── tsconfig.base.json            shared strict TS config, ES2022, NodeNext
├── docker-compose.yml            local Postgres 18 for the offline demo
├── .env.example
├── .github/workflows/            scan-repo.yml, remediate-repo.yml, terratrace-fix.yml
├── .claude/                      PROJECT_CONTEXT.md and Claude Code skills (scan-repo, remediate-repo, add-project)
├── sample-repo/                  planted-bug demo code (Python, Java, Terraform)
├── sample-data/                  synthetic AWS CUR CSVs and a Compute Optimizer export
├── scan-output/                  per-project scan JSON (two demo snapshots are tracked)
├── scripts/                      sample-CUR generators and a carbon smoke test
├── README.md · CONTRIBUTING.md · CLAUDE.md · TESTING.md · Demo.MD
├── POSITIONING.md · POSITIONING-ONEPAGER.md
└── packages/
    ├── core/           shared types, the CloudBillingSource / CodeAnalyzer / LLMProvider
    │                   interfaces and their implementations, Semgrep rules, carbon math
    ├── cli/            end-to-end scan pipeline (packages/cli/src/index.ts)
    ├── github-action/  PR comments and fix PRs, bundled with ncc (packages/github-action/src/index.ts)
    └── dashboard/      Next.js app (packages/dashboard/src/app/) plus db/schema.sql and
                        scripts/ for DB init, scan import, remediation, CUR clearing and
                        the local backup/restore
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the full source tree, the
architecture behind the three core interfaces, and how to extend each of
them.

## Tech stack

| Layer | Technology |
|---|---|
| Language / tooling | TypeScript 7 (native compiler), strict mode; pnpm workspaces monorepo; Node.js ≥ 20.6 |
| Code detection | [Semgrep](https://semgrep.dev) YAML rules (Python, Java, Terraform); tree-sitter for Python as a secondary path |
| Billing and carbon | AWS Cost and Usage Report (local CSV or S3 via `@aws-sdk/client-s3`), optional Compute Optimizer export, [Cloud Carbon Footprint](https://www.cloudcarbonfootprint.org/docs/methodology/) methodology |
| LLM | Claude through the Vercel AI SDK (`ai`, `@ai-sdk/anthropic`), with an OpenRouter fallback; every call takes a structured `EvidenceBundle` |
| Dashboard | Next.js 16, React 19, Recharts |
| Data store | Neon serverless Postgres (`@neondatabase/serverless`); local Postgres 18 in Docker (`pg`) for the offline demo; `scan-output/*.json` as a no-database fallback |
| Hosting and CI | Vercel (dashboard); GitHub Actions (`scan-repo`, `remediate-repo`, `terratrace-fix`) |
| GitHub integration | Octokit for fix pull requests; GitHub OAuth for dashboard sign-in |
| Testing | Vitest (`@terratrace/core`), including an eval test against a planted N+1 finding |

## Architecture

Everything cross-cutting lives behind three interfaces in `@terratrace/core`:
`CodeAnalyzer`, `CloudBillingSource` and `LLMProvider`. The CLI, the GitHub
Action and the dashboard import only from core's public exports and never
reach into an implementation file, so a new language, cloud or model is one
new implementation and not a special case.

```mermaid
flowchart TB
  subgraph SRC["Inputs"]
    direction LR
    REPO["Target repo<br/>Python · Java · Terraform"]
    AWS["AWS billing<br/>Cost and Usage Report · Compute Optimizer"]
  end

  subgraph ENTRY["Entry points"]
    direction LR
    WEB["Dashboard<br/>Next.js 16 on Vercel"]
    WF["GitHub workflows<br/>scan-repo · remediate-repo"]
    CLI["CLI"]
    ACT["GitHub Action"]
  end

  subgraph CORE["@terratrace/core: public exports only"]
    direction LR
    ANA["CodeAnalyzer<br/>Semgrep · tree-sitter"] --> CARB["Correlation and carbon math<br/>Cloud Carbon Footprint"]
    BILL["CloudBillingSource<br/>CUR CSV or S3"] --> CARB
    CARB --> LLM["LLMProvider<br/>explain · fix · query"]
    LLM --> VAL["Fix validation<br/>re-scan, up to 2 retries"]
  end

  subgraph OUT["Results"]
    direction LR
    DB[("Postgres<br/>Neon, or local offline")]
    PR["Fix pull requests<br/>via Octokit"]
  end

  SRC -->|read| CORE
  ENTRY -->|call| CORE
  CORE -->|findings and fixes| OUT
```

How a scan, a billing upload and a fix PR move through the system:

```mermaid
sequenceDiagram
  actor U as User
  participant D as Dashboard (Vercel)
  participant G as GitHub Actions
  participant C as core + LLM
  participant P as Postgres
  participant R as Target repo

  U->>D: Scan
  D->>G: dispatch scan-repo
  G->>R: read-only checkout
  G->>C: analyze, correlate, explain, fix, validate
  G->>P: import findings
  U->>D: Upload CUR file
  D->>C: correlate usage with findings
  D->>P: apply cost and carbon estimates
  U->>D: Raise PRs
  D->>G: dispatch remediate-repo
  G->>R: open pull requests (Octokit)
  Note over U,R: Scanning never writes to the target repo
```

**Scan to fix, step by step**

1. **Analyze:** Semgrep rules find the patterns (N+1 queries, chatty S3 loops, oversized instances) in the target repo.
2. **Correlate:** findings are matched to AWS billing usage by service, then turned into dollars and kgCO2e using the Cloud Carbon Footprint methodology. Without a billing source, a bundled sample is used.
3. **Explain and fix:** the LLM receives an `EvidenceBundle` (finding, billing, carbon estimate, git context), never a bare prompt, and returns an explanation and a unified diff.
4. **Validate:** the diff is applied and the file re-scanned. A fix is offered only if the finding is gone and no new one appeared.
5. **Store and show:** findings land in Postgres, and the dashboard shows them by role (Executive, Middle Management, Engineer). Opening fix PRs is a separate, explicitly triggered step, and a PR only counts as remediated after a later rescan no longer finds the issue.

## AI in TerraTrace

**Where AI is used, and where it is not**

| Step | AI? | How |
|---|---|---|
| Scan | No | Semgrep rules: same code, same findings |
| Correlate | No | AWS billing plus Cloud Carbon Footprint maths: auditable numbers |
| Explain | Yes | Plain-language causal link across code, bill and carbon |
| Fix | Yes | A unified diff for the exact file |
| Check | No | Re-scan the patched file; the model never grades itself |

**What the model does** (`LLMProvider`)

- `explainFinding`: 2 to 3 sentences, only numbers from the evidence.
- `generateFix`: a raw diff for the one file named in the finding.
- `answerQuery`: answers a question from an array of evidence bundles. Built in core, not wired into the dashboard yet.

**More detail** (prompt construction, model and tooling, AI-assisted development,
and where each guardrail lives in the code) is in
[CONTRIBUTING.md](./CONTRIBUTING.md#working-on-the-ai-layer).

**Not built yet**

- `answerQuery` in the dashboard UI.
- An MCP server.
- AI-based false-positive filtering.
- Real CloudWatch utilization in place of the fixed 50% CPU assumption.

## Guardrails

TerraTrace sends someone else's code to an LLM and can open pull requests, so
the guardrails are part of the design and not an afterthought.

**AI guardrails**

| Guardrail | What it does |
|---|---|
| Evidence only | Every LLM method takes a structured `EvidenceBundle`, never a bare prompt. The model is told to use only numbers present in the bundle and to say so when billing or carbon data is missing |
| Prompt-injection defence | Scanned source, billing and git data are treated as untrusted. A system-prompt clause says it is data, never instructions, and the evidence is wrapped in `<untrusted_evidence>` tags |
| Rule-specific fix guidance | Framework-aware instructions per rule (Django, Spring Data, boto3 and so on), so fixes follow the codebase's idiom |
| Deterministic fix first | If the Semgrep rule ships its own autofix, that is used instead of asking the model |
| Fix validation | The diff is applied in memory and the file re-scanned. A fix is offered only if the finding is gone and no new finding appeared. Up to 2 retries, with the previous failure fed back to the model |
| Wrong-file rejection | A diff that touches any file other than the finding's own file is rejected |
| Cost cap | LLM calls are limited to `TERRATRACE_MAX_LLM_FINDINGS` findings per scan (default 50), highest severity first. The rest still appear, without an explanation or fix |
| Eval test | Runs the recommendation loop against the planted findings in `sample-repo/` to catch prompt, model or rule-guidance regressions. Skipped without an API key |

**Pipeline and access guardrails**

| Guardrail | What it does |
|---|---|
| Read-only scanning | The scan workflow only reads the target repo and writes to TerraTrace's own database. It must never gain commit, push or PR steps |
| Remediation is separate and explicit | Fix PRs come from their own workflow, triggered by a person. A PR means "in progress"; a finding is remediated only when a later rescan no longer finds it |
| No duplicate PRs | Each finding has an idempotency key, applied as a label, so re-runs never open a second PR for the same finding |
| Billing opt-in | A CUR upload only touches projects with the billing link switched on, so an unrelated repo never receives someone else's cost and carbon figures |
| Sign-in | GitHub OAuth with a collaborator check on the repo. The session is an HMAC-signed cookie compared in constant time |
| Build and type safety | Strict TypeScript everywhere. Every cross-cutting concern sits behind one of three interfaces, so a new cloud, language or model cannot bypass the evidence rule |

Where each guardrail lives in the code is listed in
[CONTRIBUTING.md](./CONTRIBUTING.md#working-on-the-ai-layer).

Roles (`?view=`) are a display persona and not a guardrail; see Known
limitations.

## Dashboard

`/` is a public landing page; signed-in users go on to `/dashboard`.

- **Home (`/dashboard`):** org-wide charts (impact by project and by service).
  Managers and above also get the Pipeline link, the Add-repo form and the
  project grid with Scan and Remove actions. A project tile opens its Overview.
- **Per-project pages:** Overview, plus Files, Domain, Recommendations, Fixes
  and Remediation. Every link keeps the `?view=` role.
- **Roles** are a simulated persona set by `?view=executive|manager|engineer`
  (shown as Executive, Middle Management, Engineer), gated by rank. Real access
  control is the GitHub sign-in described under Deploy.
- **Billing is opt-in per project.** One uploaded CUR file is applied
  org-wide, but only to projects whose billing link is switched on, so a
  registered open-source repo never inherits someone else's AWS bill.
- **Remediation:** a fix PR means "in progress". A finding only counts as
  remediated after a later rescan no longer finds it.
- **Pipeline page** (manager and above): recent scan runs and CUR upload history.
- **Data:** Neon Postgres when `DATABASE_URL` is set (schema in
  `packages/dashboard/db/schema.sql`: `projects`, `billing_uploads`,
  `findings`). Without it, the dashboard reads `scan-output/*.json` and the
  add-repo, scan, remediate and billing-upload actions are disabled.

## Detection coverage

Detection rules are declarative Semgrep YAML under
`packages/core/rules-semgrep/<language>/`, not hand-written per-language code
— adding a rule to an existing language, or a language to an existing rule,
is a new `.yaml` file plus a `RULE_SERVICE_MAP` entry in
`packages/core/src/carbon/correlate.ts`. See "Adding a new language analyzer"
/ "Adding a detection rule" in [CONTRIBUTING.md](./CONTRIBUTING.md).

**Application code** (Python, Java):

| Rule | Python | Java | Billed service |
|---|---|---|---|
| `n-plus-one-query` — DB call issued once per loop iteration instead of batched | ✅ | ✅ | AmazonRDS |
| `unbounded-query` — fetches a whole table into memory instead of paginating/streaming | ✅ | ✅ | AmazonRDS |
| `chatty-s3-loop` — S3 API call issued once per loop iteration instead of batched | ✅ | ✅ | AmazonS3 |

**Infrastructure as code** (Terraform, prototype — AWS resource types only today;
see `TerraformAnalyzer.ts` for why a GCP/Azure/on-prem IaC analyzer is a new
class next to it, not a rewrite):

| Rule | Billed service |
|---|---|
| `oversized-instance-type` — `aws_instance` using a 4xlarge-or-larger instance type | AmazonEC2 |
| `missing-lifecycle-policy` — `aws_s3_bucket` with no lifecycle rule, so objects accumulate forever | AmazonS3 |
| `no-autoscaling-floor` — `aws_autoscaling_group` with `min_size == max_size`, so it never scales down | AmazonEC2 |

**Telemetry-driven finding** (not a static rule): when
`TERRATRACE_RIGHTSIZING_FILE` points at an AWS Compute Optimizer export,
declared Terraform resources are matched to AWS's rightsizing recommendations
by tag, and an "Overprovisioned" resource gets a measured before/after carbon
and cost comparison. This is the only path that reports *high* confidence.
See `sample-data/compute-optimizer-sample.json` and `sample-repo/terraform/orders_db.tf`.

**Planned rules** (polling loops, chatty outbound HTTP, missing connection
reuse) are deliberately deferred because a precise pattern needs dataflow
reasoning; see "Adding a detection rule" in [CONTRIBUTING.md](./CONTRIBUTING.md).

## How the numbers are calculated

Carbon is derived from **usage**, never from cost. Cost travels alongside as
the billed figure and is never an input to the carbon number. The method is
Cloud Carbon Footprint's, with seed values for its constants (see the caveat
above).

```
EC2 / RDS   averageWatts = min + 0.5 × (max − min)             # min/max watts per instance family; RDS reuses the EC2 table
            kWh = usageHours × averageWatts × 1.135 / 1000     # 1.135 = AWS PUE
S3          tbHours = (GB / 1024) × 720
            kWh = tbHours × 0.0012 × 1.135
Lambda      kWh = gbSeconds × 0.0000167 × 1.135
All         kgCO2e = kWh × gridIntensity(provider, region)
```

| Constant | Value | Note |
|---|---|---|
| AWS PUE | 1.135 | Power usage effectiveness applied to every service |
| CPU utilisation | 0.5 | CCF's default; there is no CloudWatch input yet |
| Grid intensity, us-east-1 | 0.379 kg/kWh | One of 16 AWS regions in `coefficients/grid.ts` |
| Cleanest region | 0.008 kg/kWh | eu-north-1 (Stockholm) |
| Dirtiest region | 0.790 kg/kWh | ap-southeast-2 (Sydney) |
| Unknown region | 0.4 kg/kWh | Deliberately conservative fallback |

The same workload emits about **99× more** in Sydney than in Stockholm
(0.790 / 0.008), which is why region matters as much as code.

**Confidence**

- Coverage is the share of billing records the energy model can price.
  Coverage of 0.8 or above gives **medium**; below that, **low**.
- A service with no energy model (a load balancer, for example) counts as
  zero energy and lowers coverage. The bundled sample CUR reads *low* for
  exactly that reason.
- The deterministic estimator never returns **high**. Only the Compute
  Optimizer cross-reference does, because it is a measured before-and-after
  comparison and not an apportionment.

To reproduce the sample figures, run `node scripts/carbon-smoke.mjs`; the
expected output is in [TESTING.md](./TESTING.md). To change the model, see
"Working on the carbon model" in [CONTRIBUTING.md](./CONTRIBUTING.md).

## Prerequisites

- **Node.js ≥ 20.6** (the `--env-file=.env` flag used below needs 20.6+; tested on Node 26). On macOS: `brew install node`.
- **Corepack** — bootstraps pnpm at the workspace-pinned version. Recent Homebrew node builds no longer bundle it, so install it separately if `corepack` isn't on your PATH after installing node: `brew install corepack`.
- **pnpm** — activated via `corepack enable pnpm`. The first `pnpm install` will fetch the exact pnpm version pinned in this repo's `package.json`.
- **Semgrep** — `pip install semgrep` (or `brew install semgrep`). Required for Java and Terraform detection and by the GitHub Action. The CLI falls back to the tree-sitter Python analyzer alone if Semgrep is missing, with a warning.
- **Docker (or Colima)** — optional, only for the offline demo's local Postgres.
- **A Postgres database** — optional. A Neon project (or any Postgres reachable as `DATABASE_URL`) turns on the dashboard's scan, billing-upload and remediation features.
- **A Claude API key** — either an Anthropic key (`sk-ant-…` from [console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys)) *or* an OpenRouter key (`sk-or-…` from [openrouter.ai/keys](https://openrouter.ai/keys)). Only needed for the `explainFinding` / `generateFix` LLM calls — the deterministic scan itself runs without one.

## Environment variables

Copy `.env.example` to `.env` and fill in what you need. Variables marked
\* are not in `.env.example` yet; add them yourself where you use them.

**Scanning (CLI and GitHub Action)**

| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | `explainFinding`, `generateFix` and `answerQuery` calls. Set this **or** `OPENROUTER_API_KEY`; Anthropic wins if both are set |
| `OPENROUTER_API_KEY` | Alternative to `ANTHROPIC_API_KEY`: routes Claude calls through OpenRouter's OpenAI-compatible endpoint (default model `anthropic/claude-sonnet-4.6`) |
| `TERRATRACE_CUR_FILE` | Path to a local AWS Cost and Usage Report CSV to correlate findings against |
| `TERRATRACE_CUR_S3_BUCKET` / `TERRATRACE_CUR_S3_MANIFEST_KEY` | Fetch a real CUR export live from S3 instead. Both are required together and are ignored if `TERRATRACE_CUR_FILE` is set. Standard AWS credentials must be available (env vars, `~/.aws/credentials` profile, or an IAM role) with `s3:GetObject` on that bucket; the AWS SDK picks them up itself |
| `TERRATRACE_RIGHTSIZING_FILE` \* | AWS Compute Optimizer export (JSON) for the rightsizing cross-reference |
| `TERRATRACE_MAX_LLM_FINDINGS` \* | Cap on findings sent to the LLM per scan, highest severity first (default 50). Findings beyond the cap still appear, without an explanation or fix |
| `TERRATRACE_REPO_URL` \* | Overrides the git-remote-derived repo URL written to the output |
| `GITHUB_TOKEN` | GitHub Action: posting PR comments and opening fix PRs |

None of the billing variables are required. With none set, the CLI falls back
to bundled sample billing data.

**Dashboard** (all optional; each switches on a feature)

| Variable | Purpose |
|---|---|
| `DATABASE_URL` \* | Neon (or other Postgres) connection string. Without it the dashboard reads `scan-output/*.json` |
| `GITHUB_OAUTH_CLIENT_ID` / `GITHUB_OAUTH_CLIENT_SECRET` | GitHub sign-in. Leave unset locally to skip the login wall |
| `AUTH_COOKIE_SECRET` | Signs the session cookie, e.g. `openssl rand -base64 32` |
| `APP_URL` | The deploy's public origin, for the OAuth callback (`https://your-domain`, no trailing slash) |
| `GITHUB_REPO_OWNER` / `GITHUB_REPO_NAME` | The repo whose collaborators may sign in (default `ajaysinghio` / `terratrace`) |
| `GITHUB_DISPATCH_TOKEN` \* | Token the dashboard uses to dispatch the scan and remediate workflows and read their runs |
| `GITHUB_SCANNER_REPO` \* | `owner/repo` that holds those workflows (default `ajaysinghio/terratrace`) |
| `LOCAL_DATABASE_URL` \* | Override for `db:cur:clear:local` (default `postgres://terratrace:terratrace@localhost:5433/terratrace`) |

**GitHub Actions secrets** for the scan and remediate workflows, and where each
one goes, are listed in [CONTRIBUTING.md](./CONTRIBUTING.md#3-add-a-repo--central-scan-pipeline).

The CLI does not auto-load `.env`. Pass it via Node's built-in flag:
`node --env-file=.env packages/cli/dist/index.js …` (shown below). If you'd
rather `export` the vars in your shell, that works too.

## Run locally

```bash
# One-time: enable pnpm (if `corepack` is missing, install it separately: brew install corepack)
corepack enable pnpm

pnpm install

# Create your .env, then open it and paste your ANTHROPIC_API_KEY or OPENROUTER_API_KEY
cp .env.example .env
open -e .env

# Build every package — core first, ordering is automatic
pnpm build
```

> **Note on comments in commands:** don't paste commands with trailing `# …` comments from a code block into `zsh` — by default zsh treats `#` as a literal argument in interactive mode, which will break commands like `pnpm dev:dashboard # http://localhost:3000`. Either put comments on their own line (as above) or enable `setopt interactive_comments` in your shell.

`@terratrace/core` must be built before `cli`, `github-action`, or
`dashboard` will type-check or run — they all depend on its compiled
declarations via `workspace:*`. `pnpm build` handles ordering automatically.

**CLI** — scan a repo and write one project file to `scan-output/<project-id>.json`
(also printed to stdout). Run it once per repo, giving each a distinct project id.

> **Important:** run the CLI from the **workspace root**, not from `packages/cli/`.
> The dashboard reads `scan-output/` at the repo root; `pnpm --filter @terratrace/cli start …` changes cwd into `packages/cli/`, which both breaks glob patterns like `./sample-repo/**/*.py` and writes findings to the wrong place.

```bash
# Scan one repo — writes ./scan-output/<project-id>.json at the workspace root
node --env-file=.env packages/cli/dist/index.js "./sample-repo/**/*.py" sample-repo "Sample Repo"

# Same pattern, one invocation per repo:
node --env-file=.env packages/cli/dist/index.js "./sample-repo/**/*.py" orders-service "Orders Service"
node --env-file=.env packages/cli/dist/index.js "../payments-repo/**/*.py" payments-service "Payments Service"
```

**Dashboard (dev mode)** — the home page lists every scanned project, each
linking to its own drill-down page with the full charts, heatmap, and
carbon/environmental-impact breakdown. With no `DATABASE_URL` it reads
`scan-output/`; with one, it reads Postgres (apply the schema once with
`pnpm --filter @terratrace/dashboard db:init`):

```bash
pnpm dev:dashboard
```

Opens at http://localhost:3000. If port 3000 is already in use on your machine, Next.js will automatically fall back to the next available port (usually 3001) — watch the terminal output for the actual URL it prints (`- Local: http://localhost:3001`).

With the file-based fallback and an empty `scan-output/`, the home page shows
a "run the CLI first" message instead of erroring. At scale, the centralized
scan pipeline (below) writes results straight into Postgres.

**Checks**

```bash
pnpm build        # every package, core first
pnpm typecheck    # type-check every package
pnpm test         # Vitest in @terratrace/core; the LLM eval test is skipped without an API key
```

See [TESTING.md](./TESTING.md) for running the carbon pipeline against the
sample CUR and your own export.

## Deploy

### Dashboard — local production build

```bash
# One scan invocation per repo (must run from the workspace root, see CLI note above)
node --env-file=.env packages/cli/dist/index.js "./sample-repo/**/*.py" sample-repo "Sample Repo"

pnpm --filter @terratrace/dashboard build
pnpm --filter @terratrace/dashboard start
```

Opens at http://localhost:3000 (or the next free port).

### Dashboard — offline laptop demo (local Postgres)

A local copy of the Neon database lets the dashboard run with no internet.
Needs Docker (or Colima). Neon is only ever read (`pg_dump`); restore only
writes to the local container.

```bash
pnpm --filter @terratrace/dashboard db:local:sync     # Neon -> backups/*.sql -> local Postgres (localhost:5433)
pnpm build
pnpm --filter @terratrace/dashboard start:offline     # app on :3000, DB = local, no GitHub auth/token
```

`db:local:dump` and `db:local:restore [file]` do each half separately. See
[Demo.MD](./Demo.MD) for the full command sheet for each demo scenario.

To clear CUR upload data (upload history plus the cost/carbon estimates it
produced; projects and findings are kept), with a confirmation prompt:

```bash
pnpm --filter @terratrace/dashboard db:cur:clear:local    # local Postgres
pnpm --filter @terratrace/dashboard db:cur:clear:remote   # Neon, via DATABASE_URL in .env
```

Add `-- --yes` to skip the prompt.
Anything done in offline mode (uploads, link toggles) stays in the local
copy and is overwritten by the next `db:local:sync`. Scanning and PR
creation need GitHub Actions, so they don't work offline. `backups/` is
gitignored (it contains real findings data).

### Dashboard — remote (Vercel)

The dashboard is a standard Next.js App Router app, so it deploys to Vercel
with no extra config:

```bash
pnpm dlx vercel --cwd packages/dashboard
```

Notes:
- Vercel's build needs pnpm workspace awareness — set the project's **Root
  Directory** to `packages/dashboard` and enable "Include files outside the
  root directory", so `@terratrace/core` resolves via the workspace.
- **Build order still matters on Vercel, same as locally** (see "Build order
  matters" above) — with Root Directory set, Vercel's default Build Command
  only runs `packages/dashboard`'s own `build` script, never
  `@terratrace/core`'s. Since core hasn't been built, its `dist/` (and the
  `"./correlate"` export subpath `lib/roleStats.ts` imports) doesn't exist,
  and the build fails with a `Module not found: @terratrace/core/correlate`
  error. Fix: in Project Settings → Build and Deployment, override the
  **Build Command** to build core first:
  ```
  cd ../core && pnpm run build && cd ../dashboard && pnpm run build
  ```
- **Database:** add a Neon project (for example through Vercel's Storage tab)
  so `DATABASE_URL` is set, then apply the schema once with
  `pnpm --filter @terratrace/dashboard db:init`. Without `DATABASE_URL` the
  dashboard falls back to reading `scan-output/*.json` from disk
  (`packages/dashboard/src/lib/projects.ts`), and the add-repo, scan,
  billing-upload and remediation actions are disabled.
- **Region:** set the Vercel Function Region (Project Settings → Functions) to
  the one nearest your Neon region. Each page makes several queries, so a
  cross-region gap adds up quickly.
- **Scan and remediate buttons** need `GITHUB_DISPATCH_TOKEN` (and, if the
  workflows live elsewhere, `GITHUB_SCANNER_REPO`) so the dashboard can trigger
  the workflows in the next section.
- Two demo snapshots (`scan-output/orders-service.json`, `scan-output/infra.json`)
  are tracked in git so the file-based fallback has data to show; the
  `.gitignore` allow-list also permits `sample-repo.json`. Anything else
  written to `scan-output/` locally stays untracked.
- **Custom domain:** point the domain at the project, then set `APP_URL` to
  the exact public origin and update the OAuth App's callback URL to match.

**Restricting access to repo collaborators** — since the repo backing this
deploy is private, "authorized users" means "has at least read access to the
repo." There's no way to enforce that with GitHub Pages' access model (private
Pages sites require GitHub Enterprise); this app instead gates itself with a
small GitHub OAuth flow (see `src/proxy.ts`, `src/app/api/auth/*`):

1. GitHub → Settings → Developer settings → OAuth Apps → New OAuth App.
   Set **Authorization callback URL** to `<your-vercel-url>/api/auth/callback`.
2. In the Vercel project's environment variables, set:
   - `GITHUB_OAUTH_CLIENT_ID`, `GITHUB_OAUTH_CLIENT_SECRET` — from step 1.
   - `AUTH_COOKIE_SECRET` — a random secret, e.g. `openssl rand -base64 32`.
   - `APP_URL` — the deploy's public URL (must exactly match the callback URL's origin).
   - `GITHUB_REPO_OWNER` / `GITHUB_REPO_NAME` — defaults to `ajaysinghio`/`terratrace`; only set these if forking to a different repo.
3. Leave all of the above unset for local dev — `pnpm dev:dashboard` skips the
   gate entirely when `GITHUB_OAUTH_CLIENT_ID` isn't present.

The OAuth App requests the `repo` scope (needed to check collaborator access
on a *private* repo — GitHub has no narrower read-only scope for that check)
and is used only to read `GET /repos/{owner}/{repo}` for the signed-in user;
nothing is written back to GitHub with it.

### Centralized scan and remediate pipelines (GitHub Actions)

Two workflows in this repo run everything a scan needs (Semgrep, the CLI
build, the LLM key, `DATABASE_URL`), so a target repo needs no workflow file
and no secrets of its own. The dashboard's buttons dispatch them, and they
can also be run by hand:

```bash
# Read-only scan of a registered repo; results are imported into Postgres
gh workflow run scan-repo.yml -R ajaysinghio/terratrace \
  -f repo_owner=ajaysinghio -f repo_name=orders-service \
  -f project_id=orders-service -f project_name="Orders Service"

# Open real fix PRs (all ready findings, or one with -f finding_id=<id>)
gh workflow run remediate-repo.yml -R ajaysinghio/terratrace \
  -f repo_owner=ajaysinghio -f repo_name=orders-service -f project_id=orders-service
```

- **`scan-repo.yml` is read-only by design.** It checks out the target repo and writes only to TerraTrace's own database. Never add commit, push or PR steps to it.
- **`remediate-repo.yml` is separate and explicit.** It opens PRs through the GitHub API.
- A scan takes roughly 1.5 to 5 minutes per repo.
- Secrets, setup and the `terratrace-fix.yml` proof of concept: see [CONTRIBUTING.md](./CONTRIBUTING.md#3-add-a-repo--central-scan-pipeline).

### GitHub Action — build and publish

The Action is *meant* to run a committed bundle (`packages/github-action/dist`),
built with:

```bash
pnpm --filter @terratrace/github-action build
git add packages/github-action/dist
git commit -m "build: github-action dist"
```

**Known limitation — the committed dist is currently platform-locked.**
`tree-sitter`/`tree-sitter-python` ship native `.node` binaries, and `ncc`
only bundles whichever prebuild happens to be installed on the machine that
ran the build. If that dist is committed from a Mac (as it is today —
`darwin-arm64`), `uses: ajaysinghio/terratrace/packages/github-action@main`
**will fail at runtime on `ubuntu-latest`** (GitHub's default runner) with a
native-module load error. Fixing this properly needs a CI job that builds on
each target OS/arch and merges the prebuilds — not done yet.

**Until that's fixed, build from source in your own workflow instead** (this
is exactly what this repo's own `.github/workflows/terratrace-fix.yml` and
`.github/workflows/scan-repo.yml` do, and it's the only path that's actually
been run and confirmed working end-to-end):

```yaml
# .github/workflows/terratrace-pr.yml
name: TerraTrace (PR comments)
on:
  pull_request:
permissions:
  contents: read
  pull-requests: write
jobs:
  scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ github.event.pull_request.head.sha }}

      # Build fresh from source — `pnpm install` on this runner pulls the
      # correct tree-sitter linux-x64 prebuild automatically, sidestepping
      # the committed dist's darwin-arm64-only limitation above.
      - uses: actions/setup-node@v4
        with:
          node-version: "22"
      - uses: pnpm/action-setup@v4
        with:
          version: "11.22.0"
      - run: pnpm install --frozen-lockfile
      - run: pnpm build

      # Semgrep is a Python package, not vendored in the build — the
      # analyzer fails loud on a missing PATH binary if this step is skipped.
      - uses: actions/setup-python@v5
        with:
          python-version: "3.11"
      - run: pip install semgrep

      - uses: ./packages/github-action
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          # Set exactly one of these — the Action fails if neither is set.
          anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
          # openrouter-api-key: ${{ secrets.OPENROUTER_API_KEY }}
```

The Action has **two flows** driven by the triggering event — the workflow
above is the **PR comment flow** (`pull_request` events): reads the changed
source files from the checkout and posts findings + explanations as a PR
comment, no branches, no fix PRs. It scans the changed Python, Java and
Terraform files and needs Semgrep on the runner (the Action does not use
tree-sitter).

**Fix-PR flow** (`push` to default, `schedule`, or `workflow_dispatch`) —
scans every Python, Java and Terraform file in the repo, asks the LLM for a fix diff per finding,
validates each diff in-memory (applies it and re-analyzes) with up to 2
retries, and opens one PR per validated fix against the default branch. Each
PR is keyed by an idempotency label `terratrace:<hash>` where `hash` covers
`ruleId + filePath + snippet`, so re-runs never open duplicate PRs for the
same unresolved finding. Same build-from-source steps as above, just with a
different `on:` trigger and the fix-PR permissions — see
`.github/workflows/terratrace-fix.yml` for the full, working example.

The `actions/checkout` step is required for both flows — the Action reads
source files from the local checkout rather than the GitHub Contents API.
The fix-PR flow also needs `contents: write` and `pull-requests: write`.

### CLI — remote / CI usage

Run the same scan in any CI pipeline (no deploy needed, just Node + pnpm):

```bash
pnpm install --frozen-lockfile
pnpm --filter @terratrace/core build
pnpm --filter @terratrace/cli build
ANTHROPIC_API_KEY=*** pnpm --filter @terratrace/cli start "./src/**/*.py" my-repo-id "My Repo"
```

## Known limitations

- **Billing correlation is by AWS service, not resource tag.** Two billing-linked
  projects that share a service each receive that service's full usage, so
  org-wide totals can double-count. Fine for a single-account demo.
- **CPU utilization is a fixed 50%** (no CloudWatch integration yet), so
  EC2 and RDS estimates are at most *medium* confidence. Only the Compute
  Optimizer cross-reference reports *high*.
- **Scanning cannot run inside the Vercel-deployed dashboard** (native tree-sitter, Semgrep and `git` are not available there), which is why it runs in GitHub Actions.
- **Carbon constants are approximate** (see the caveat above).
- **The committed GitHub Action bundle is platform-locked** (see the build
  section); the workflows in this repo build from source instead.
- **Roles are a simulated persona**, not authorization. Any signed-in
  collaborator can set any `?view=`.
- **On-prem analysis and region-shift or migrate what-ifs are not built.**

## More documentation

- [CONTRIBUTING.md](./CONTRIBUTING.md): source tree, architecture, how to extend each interface.
- [CLAUDE.md](./CLAUDE.md): guidance for Claude Code and other agents working in this repo.
- [TESTING.md](./TESTING.md): running the carbon pipeline against a CUR export.
- [Demo.MD](./Demo.MD): command sheet for each demo scenario.
- [POSITIONING.md](./POSITIONING.md) and [POSITIONING-ONEPAGER.md](./POSITIONING-ONEPAGER.md): how TerraTrace compares with CCFT and CCF.
- `.claude/PROJECT_CONTEXT.md`: what is built, what is deliberately deferred, and standing preferences.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the full repo layout, the
three-interface architecture (`CloudBillingSource` / `CodeAnalyzer` /
`LLMProvider`) and how to extend each one, coding conventions, the suggested
3-person team split, and the Week 1 checklist.

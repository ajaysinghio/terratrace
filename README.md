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

## How this differs from AWS's Customer Carbon Footprint Tool (CCFT)

The most common "why not just use the free thing?" question. CCFT is AWS's
built-in dashboard that shows a customer's carbon footprint per service /
region / month. It's the primary comparator TerraTrace has to beat.

| Dimension | AWS CCFT | TerraTrace |
|---|---|---|
| **Attribution depth** | Stops at *service × region × month* | Traces down to the *function / line of code* that amplified an RDS or Lambda bill |
| **Output type** | A number in a dashboard | A number + an LLM-generated **fix diff** a developer can apply |
| **Scope of estate** | AWS only | Code + on-prem + cloud — covers pre-migration and hybrid clients CCFT literally can't see |
| **Timeframe** | Retrospective only (3-month lag) | Retrospective *plus* what-if scenarios: "fix this N+1", "shift region", "migrate this workload" |
| **Methodology** | Proprietary, market-based (includes AWS's PPA/renewables offsets) — usually produces *lower* numbers | Cloud Carbon Footprint's **open, location-based** methodology — defensible in public-sector tenders that want location-based figures |
| **Pre-cloud clients** | Nothing to show — no AWS spend yet | On-prem mode gives them a pre-migration baseline that becomes the "before" in the migration business case |

**When CCFT is actually the right pick** (be honest about this): a client
already fully in AWS who just wants a monthly compliance snapshot and doesn't
care about *what to change* is served fine by CCFT. TerraTrace is overkill
there — don't pitch against that use case.

**Where TerraTrace wins:**

- Public-sector / EU tenders that score sustainability — they typically want
  location-based figures, not AWS's market-based number that credits
  renewables offsets. TerraTrace cites CCF's published methodology openly;
  CCFT's calc has to be hand-waved.
- Pre-migration engagements — CCFT gives them zero. On-prem mode gives them a
  baseline.
- Modernisation engagements where the value ask is *"what should we change?"*
  not *"what did we emit?"* — CCFT cannot answer that at all.

One-line positioning: *CCFT tells you what your AWS carbon was last quarter.
TerraTrace tells you which loop in which service caused it, gives you a fix
diff, and also works for the on-prem and pre-migration parts of the estate
that CCFT can't see.*

## Repo structure

```
terratrace/
├── package.json                 (root workspace scripts)
├── pnpm-workspace.yaml           (packages: "packages/*")
├── tsconfig.base.json            (shared strict TS config, ES2022, NodeNext)
├── .gitignore
├── .env.example
├── README.md
├── CONTRIBUTING.md
└── packages/
    ├── core/          — shared types + CloudBillingSource / CodeAnalyzer / LLMProvider interfaces
    ├── cli/            — end-to-end scan pipeline (packages/cli/src/index.ts)
    ├── github-action/  — PR bot, bundled with ncc (packages/github-action/src/index.ts)
    └── dashboard/      — Next.js app: project list (home) → per-project drill-down, each with 3 role views (Executive/Middle Management/Engineer) via `?view=`, superset-gated (packages/dashboard/src/app/)
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the full source tree, the
architecture behind the three core interfaces, and how to extend each of
them.

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

**Planned, not yet implemented** (prototyped as ideas, deliberately deferred
because a precise Semgrep pattern needs dataflow reasoning a plain AST match
can't do reliably — shipping them now would mean a high false-positive rate,
which conflicts with this project's stated preference for being honest about
a heuristic's limits over chasing rule-count coverage):

- **Synchronous polling/busy-wait loops** (`while True: sleep(...)`-style) —
  burns compute continuously instead of waiting on an event; hard to
  distinguish from a legitimate backoff-retry loop without tracking whether
  the sleep duration actually backs off.
- **Chatty outbound HTTP calls in a loop** instead of a batch/bulk endpoint —
  valuable but the billed service depends on which API is being called, so
  it doesn't map cleanly onto one `RULE_SERVICE_MAP` entry the way S3/RDS
  calls do.
- **Missing connection/resource reuse** (constructing a new DB/HTTP client
  per request instead of a pooled/shared one) — amplifies per-invocation
  connection overhead; needs cross-function reasoning (is this client
  actually re-created on every call, or once at module/class scope?) beyond
  what a single-function AST pattern can see.

## Prerequisites

- **Node.js ≥ 20.6** (the `--env-file=.env` flag used below needs 20.6+; tested on Node 26). On macOS: `brew install node`.
- **Corepack** — bootstraps pnpm at the workspace-pinned version. Recent Homebrew node builds no longer bundle it, so install it separately if `corepack` isn't on your PATH after installing node: `brew install corepack`.
- **pnpm** — activated via `corepack enable pnpm`. The first `pnpm install` will fetch the exact pnpm version pinned in this repo's `package.json`.
- **A Claude API key** — either an Anthropic key (`sk-ant-…` from [console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys)) *or* an OpenRouter key (`sk-or-…` from [openrouter.ai/keys](https://openrouter.ai/keys)). Only needed for the `explainFinding` / `generateFix` LLM calls — the deterministic scan itself runs without one.

## Environment variables

Copy `.env.example` to `.env` and fill in what you need:

| Variable                | Required for                                      |
|--------------------------|----------------------------------------------------|
| `ANTHROPIC_API_KEY`      | CLI / GitHub Action (`explainFinding`, `generateFix`) — set this **or** `OPENROUTER_API_KEY` |
| `OPENROUTER_API_KEY`     | Alternative to `ANTHROPIC_API_KEY` — routes Claude calls through OpenRouter's OpenAI-compatible endpoint (default model `anthropic/claude-sonnet-4.6`) |
| `TERRATRACE_CUR_FILE`    | Path to a local AWS Cost and Usage Report CSV to correlate findings against |
| `TERRATRACE_CUR_S3_BUCKET` / `TERRATRACE_CUR_S3_MANIFEST_KEY` | Fetch a real CUR export live from S3 instead — both required together; ignored if `TERRATRACE_CUR_FILE` is set. Also needs standard AWS credentials available (env vars, `~/.aws/credentials` profile, or an IAM role) with `s3:GetObject` on that bucket — the AWS SDK picks these up itself, there's no separate TerraTrace variable for them |
| `GITHUB_TOKEN`           | GitHub Action (posting PR comments)               |

None of the CUR variables are required — the CLI falls back to bundled sample billing data if none are set.

The CLI does not auto-load `.env` — pass it via Node's built-in flag: `node --env-file=.env packages/cli/dist/index.js …` (shown below). If you'd rather `export` the vars in your shell, that works too.

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

**Dashboard (dev mode)** — the home page lists every project under
`scan-output/`, each linking to its own drill-down page with the full charts,
heatmap, and carbon/environmental-impact breakdown:

```bash
pnpm dev:dashboard
```

Opens at http://localhost:3000. If port 3000 is already in use on your machine, Next.js will automatically fall back to the next available port (usually 3001) — watch the terminal output for the actual URL it prints (`- Local: http://localhost:3001`).

If `scan-output/` is empty, the home page shows a "run the CLI first" message
instead of erroring. A company scanning 100s of repos would run the CLI (or
the GitHub Action) once per repo in CI and sync each repo's
`scan-output/<project-id>.json` into wherever the dashboard reads from — see
the remote-deploy note below.

## Deploy

### Dashboard — local production build

```bash
# One scan invocation per repo (must run from the workspace root, see CLI note above)
node --env-file=.env packages/cli/dist/index.js "./sample-repo/**/*.py" sample-repo "Sample Repo"

pnpm --filter @terratrace/dashboard build
pnpm --filter @terratrace/dashboard start
```

Opens at http://localhost:3000 (or the next free port).

### Dashboard — remote (Vercel)

The dashboard is a standard Next.js App Router app, so it deploys to Vercel
with no extra config:

```bash
pnpm dlx vercel --cwd packages/dashboard
```

Notes:
- Vercel's build needs pnpm workspace awareness — set the project's **Root
  Directory** to `packages/dashboard` and enable "Include files outside the
  root directory" (or deploy from the repo root with a Vercel `installCommand`
  of `pnpm install` and `buildCommand` of `pnpm --filter @terratrace/dashboard build`),
  so `@terratrace/core` resolves via the workspace.
- The dashboard currently reads every `scan-output/<project-id>.json` file
  from disk at request time (`packages/dashboard/src/lib/projects.ts`). For a
  remote deploy with 100s of repos, either sync each repo's scan output into
  `scan-output/` as part of your build/deploy step, or swap `projects.ts` for
  a real findings store (S3, a database, etc.) that CI writes to and the
  dashboard reads from — the directory-of-JSON-files read is a placeholder.
- Two demo snapshots (`scan-output/sample-repo.json`, `scan-output/orders-service.json`)
  are tracked in git specifically so a fresh deploy has data to show — see the
  `.gitignore` comment above the allow-list entries. Anything else written to
  `scan-output/` locally stays untracked.

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

### GitHub Action — build and publish

The Action runs a committed bundle, not source — there's no build step at
Action-invocation time. Build it before tagging/pushing a release:

```bash
pnpm --filter @terratrace/github-action build
git add packages/github-action/dist
git commit -m "build: github-action dist"
```

Then reference it from any workflow (in this repo or another one that can
reach it). The Action has **two flows** driven by the triggering event:

**1. PR comment flow** (`pull_request` events) — reads the changed `.py`
files from the checkout and posts findings + explanations as a PR comment.
No branches, no fix PRs.

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
      - uses: ajaysinghio/terratrace/packages/github-action@main
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
```

**2. Fix-PR flow** (`push` to default, `schedule`, or `workflow_dispatch`) —
scans every `.py` file in the repo, asks the LLM for a fix diff per finding,
validates each diff in-memory (applies it and re-analyzes) with up to 2
retries, and opens one PR per validated fix against the default branch. Each
PR is keyed by an idempotency label `terratrace:<hash>` where `hash` covers
`ruleId + filePath + snippet`, so re-runs never open duplicate PRs for the
same unresolved finding.

```yaml
# .github/workflows/terratrace-fix.yml
name: TerraTrace (fix PRs)
on:
  push:
    branches: [main]
  schedule:
    - cron: "0 6 * * 1"   # Monday 06:00 UTC
  workflow_dispatch:
permissions:
  contents: write
  pull-requests: write
jobs:
  scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: ajaysinghio/terratrace/packages/github-action@main
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
```

The `actions/checkout` step is required for both flows — the Action reads
Python source from the local checkout rather than the GitHub Contents API.
The fix-PR flow also needs `contents: write` and `pull-requests: write`.

### CLI — remote / CI usage

Run the same scan in any CI pipeline (no deploy needed, just Node + pnpm):

```bash
pnpm install --frozen-lockfile
pnpm --filter @terratrace/core build
pnpm --filter @terratrace/cli build
ANTHROPIC_API_KEY=*** pnpm --filter @terratrace/cli start "./src/**/*.py" my-repo-id "My Repo"
```

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the full repo layout, the
three-interface architecture (`CloudBillingSource` / `CodeAnalyzer` /
`LLMProvider`) and how to extend each one, coding conventions, the suggested
3-person team split, and the Week 1 checklist.

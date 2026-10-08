# Contributing to TerraTrace

## Prerequisites

- Node.js >= 20
- pnpm (via corepack: `corepack enable pnpm`, or `corepack prepare pnpm@latest --activate`)
- Semgrep (`pip install semgrep`) for Java and Terraform detection and for the GitHub Action; without it the CLI falls back to the Python tree-sitter analyzer only
- An Anthropic API key for any work touching `explainFinding` / `generateFix` / `answerQuery`
- A real AWS Cost and Usage Report (CUR) export for any work touching `AWSCurSource` against real data — see TESTING.md; the sample fixture works without one
- AWS credentials (env vars, `~/.aws/credentials` profile, or an IAM role) with `s3:GetObject` on the CUR bucket for any work touching `AWSCurS3Source` — it uses the AWS SDK's default credential chain, not a TerraTrace-specific config

## Local setup

```bash
git clone git@github.com:ajaysinghio/terratrace.git
cd terratrace
pnpm install
cp .env.example .env   # fill in ANTHROPIC_API_KEY, AWS_* as needed
pnpm build              # builds packages in dependency order (core first)
```

`@terratrace/core` is a dependency of every other package via
`workspace:*`. If you change anything in `packages/core/src`, rebuild it
(`pnpm --filter @terratrace/core build`) before other packages will pick up
the change — `pnpm -r build` from the root handles ordering automatically.

## Dashboard findings DB, CUR upload, and the central scan pipeline

The dashboard can run two ways: reading `scan-output/<project-id>.json`
files straight off disk (the original, zero-setup local-dev path — nothing
below is required for that), or backed by a real Postgres findings store
once `DATABASE_URL` is set, which unlocks CUR upload and the "Add repo" scan
pipeline. `src/lib/projects.ts` picks whichever `isDbConfigured()` says is
available, so both paths keep working side by side.

### 1. Findings database

- Provision a Postgres database (a Neon project via Vercel's Storage tab is
  the recommended path — `@neondatabase/serverless` is the driver used
  throughout `packages/dashboard/src/lib/db.ts`).
- Set `DATABASE_URL` in `packages/dashboard/.env` (local) and as a Vercel
  project env var (deployed) — this is one connection string with
  credentials embedded (`postgresql://user:password@host/db?sslmode=require`),
  not something to generate separately.
- Apply the schema once: `pnpm --filter @terratrace/dashboard db:init`
  (runs `db/schema.sql` — `projects`, `findings`, `billing_uploads`).
- Backfill existing `scan-output/*.json` into the DB:
  `pnpm --filter @terratrace/dashboard db:import` (or
  `... db:import <file>.json` to import just one file — always use the
  single-file form from automation, since the no-argument form re-imports
  every committed `scan-output/*.json` and would reset other projects' live
  CUR-upload correlation back to their stale committed snapshot).

### 2. CUR upload (cost/carbon re-correlation)

AWS issues one Cost and Usage Report **per payer account**, not per
repo/service — see `packages/core/src/billing/AWSCurSource.ts`'s doc
comment. So CUR upload lives in exactly one place, the dashboard home page
(`/dashboard`, `GlobalBillingUpload` component), not per project: one
upload re-correlates cost/carbon (`correlateFindingsWithUsage`) against
every scanned project at once, no LLM call and no repo checkout needed.
Each project page shows a read-only `BillingProvenanceBadge` — green "real
CUR data" only if a current finding's `billing_upload_id` still points at
an upload row, amber "from the last scan" otherwise (don't assume a project
ever having had an upload means its current numbers are still real — a
rescan resets every finding's estimate and `billing_upload_id` to null;
see `dbUpsertProject`'s doc comment for why).

### 3. Add a repo / central scan pipeline

`POST /api/projects` (the "Add repo" form on `/dashboard`, Manager/Engineer
view only) registers a project row and tries to auto-trigger
`.github/workflows/scan-repo.yml` in **this** repo via GitHub's
`workflow_dispatch` API — that one workflow does everything a scan needs
(checkout the *target* repo, build terratrace fresh, install semgrep, run
the CLI, push results into the DB), so **a target repo needs zero
configuration of its own**: no workflow file, no secrets. If the dispatch
isn't configured, the route falls back to handing back the equivalent
manual commands.

Secrets needed, all on the **terratrace** repo/Vercel project — never on a
target repo:

| Secret | Where | Scope | Purpose |
| --- | --- | --- | --- |
| `DATABASE_URL` | terratrace repo → Settings → Secrets → Actions | — (same value as the dashboard's own `.env`) | scan-repo.yml pushes results here |
| `ANTHROPIC_API_KEY` **or** `OPENROUTER_API_KEY` | terratrace repo → Actions secrets | — | `AnthropicProvider` falls back to `OPENROUTER_API_KEY` automatically if `ANTHROPIC_API_KEY` isn't set — no code difference, just which one you set |
| `CHECKOUT_TOKEN` | terratrace repo → Actions secrets | classic PAT, `repo` scope (same token as `GITHUB_DISPATCH_TOKEN` works fine) | lets the workflow check out **private** target repos — the default `GITHUB_TOKEN` only sees the terratrace repo itself. Not needed for public target repos. `scan-repo.yml`'s own header comment is the actual guarantee that nothing gets written to the target repo — remediation (opening a PR/pushing a fix) is a deliberately separate, on-demand workflow, never bundled into a routine scan. Scoping this token to a read-only fine-grained PAT is an optional extra hardening layer, not required. |
| `GITHUB_DISPATCH_TOKEN` | **Vercel** project env vars | classic PAT, `repo` scope | lets the dashboard's "Add repo" route call `workflow_dispatch` |
| `GITHUB_SCANNER_REPO` | Vercel project env vars (optional) | — | defaults to `ajaysinghio/terratrace` if unset |

Create PATs at <https://github.com/settings/tokens> → "Generate new token
(classic)". A classic PAT scoped to `repo` grants access to *all* your
repos, not just terratrace/orders-service/infra — fine for a prototype,
worth narrowing to a fine-grained PAT scoped to just the relevant repos
before this goes further than a demo.

**Known limitations, not yet solved:**
- Cost/carbon correlation matches by AWS *service* only
  (`RULE_SERVICE_MAP` in `packages/core/src/carbon/correlate.ts`), not by
  resource tag — if two projects share a service (e.g. both have EC2
  findings), the same account-wide EC2 usage gets attributed to *both*,
  which double-counts if summed org-wide. Fine for a single-account demo;
  a real multi-repo deployment needs to filter `UsageRecord`s by
  `resourceTags` per project before correlating.
- Scanning cannot run inside the Vercel-deployed dashboard itself —
  `PythonAnalyzer`'s native tree-sitter bindings break Turbopack's bundler
  ("asset is not placeable in ESM chunks"), Semgrep is a separate Python
  binary the serverless runtime doesn't have, and there's no `git` to
  clone an arbitrary target repo. That's why scanning is a GitHub Actions
  workflow, not a dashboard API route.
- `packages/github-action/dist` (the *distributable*, referenced via
  `uses: ajaysinghio/terratrace/packages/github-action@main` from another
  repo's own workflow) only has darwin-arm64 tree-sitter prebuilds
  committed — it will fail on the default `ubuntu-latest` runner. See the
  README's GitHub Action section for the build-from-source workaround this
  repo's own workflows use instead.

## Repo layout

```
terratrace/
├── package.json                 root workspace scripts (build, typecheck, test, scan)
├── pnpm-workspace.yaml          packages: "packages/*", native-build allow-list
├── tsconfig.base.json           shared strict TS config, ES2022, NodeNext
├── docker-compose.yml           local Postgres 18 for the offline demo
├── .env.example
├── .github/workflows/
│   ├── scan-repo.yml            central, read-only scan of any registered repo -> Postgres
│   ├── remediate-repo.yml       opens fix PRs (separate, explicitly triggered)
│   └── terratrace-fix.yml       proof of concept: runs the Action against this repo
├── .claude/
│   ├── PROJECT_CONTEXT.md       resumable notes: what is built, what is deferred
│   └── skills/                  scan-repo, remediate-repo, add-project
├── sample-repo/                 planted-bug demo code (analytics, billing, inventory, orders, reports, storage, java, terraform)
├── sample-data/                 synthetic CUR CSVs, Compute Optimizer export
├── scan-output/                 per-project scan JSON (orders-service.json and infra.json are tracked)
├── scripts/                     CUR sample generators, carbon-smoke.mjs
├── README.md · CONTRIBUTING.md · CLAUDE.md · TESTING.md · Demo.MD · POSITIONING*.md
└── packages/
    ├── core/
    │   ├── rules-semgrep/{python,java,terraform}/*.yaml   one declarative rule per file
    │   └── src/
    │       ├── index.ts, types.ts                          public exports, shared domain types (EvidenceBundle etc.)
    │       ├── analyzer/   CodeAnalyzer, SemgrepAnalyzer, Python/Java/TerraformAnalyzer,
    │       │               CompositeAnalyzer, MultiLanguageAnalyzer, languages.ts, rules/ (tree-sitter path)
    │       ├── billing/    CloudBillingSource, AWSCurSource, AWSCurS3Source
    │       ├── carbon/     carbonMath, correlate, correlateInfra, energyModel, coefficients/{aws,grid,index}
    │       ├── infra/      Compute Optimizer rightsizing: InfraAnalyzer, RightsizingSource/FileSource, TerraformHclAnalyzer
    │       ├── llm/        LLMProvider, AnthropicProvider (Anthropic or OpenRouter), ruleSkills
    │       └── recommend/  recommendFinding (generate, validate, retry) and __evals__/
    ├── cli/src/             index.ts (end-to-end scan), harness.ts (offline ScriptedLLM), sampleUsage.ts
    ├── github-action/       action.yml, src/index.ts (PR comments, fix PRs), scripts/copy-rules.mjs
    └── dashboard/
        ├── db/schema.sql
        ├── scripts/         init-db, import-scan-output, remediate, clear-cur, local-db.sh
        └── src/
            ├── proxy.ts     sign-in gate
            ├── app/         page.tsx (landing), dashboard/ (home), pipeline/, projects/[projectId]/{,files,domain,recommendations,fixes,remediation},
            │                api/{auth,billing,projects/...}, access-denied/
            ├── components/  Dashboard, Charts (recharts, lazy-loaded), ProjectShell, ScanButton, RemediateButton, GlobalBillingUpload, ...
            └── lib/         db, sql (Neon or local pg), projects, stats, roleStats, role, session, githubActions, scanTrigger, ...
```

This is a pnpm workspace with one shared package (`core`) and three
consumers (`cli`, `github-action`, `dashboard`).

## Architecture: three interfaces, everything else is swappable

Every cross-cutting concern is hidden behind a TypeScript interface in
`@terratrace/core`, so a single cloud/language/model can be swapped for
another later without touching any caller.

- **`CloudBillingSource`** — one method, `fetchUsage({ start, end })`. Two
  AWS implementations today: `AWSCurSource` (reads a local CUR file) and
  `AWSCurS3Source` (fetches one live from S3, given its manifest location).
  **To add a new cloud** (GCP, Azure, on-prem metering) or another AWS fetch
  mode (e.g. live Athena): write a new class implementing
  `CloudBillingSource` in `packages/core/src/billing/`; nothing else changes.

- **`CodeAnalyzer`** — one method, `analyzeFile(filePath, sourceCode)`.
  Detection rules today are declarative Semgrep YAML under
  `packages/core/rules-semgrep/<language>/`, run through `SemgrepAnalyzer`
  (generic across any language Semgrep supports). `PythonAnalyzer`,
  `JavaAnalyzer`, and `TerraformAnalyzer` are the named per-language entry
  points — `PythonAnalyzer` also carries a pluggable `DetectionRule[]`
  tree-sitter path for detections Semgrep's pattern language can't express
  (empty by default; see `rules/registry.ts`). `CompositeAnalyzer` combines
  multiple engines for *one* language (e.g. Semgrep + tree-sitter rules for
  Python); `MultiLanguageAnalyzer` dispatches per file extension across
  *different* languages (e.g. Python + Java + Terraform) behind one
  `CodeAnalyzer`. **To add a new
  language**: see "Adding a new language analyzer" below. **To add a new
  detection to an existing language**: add a `.yaml` file under
  `rules-semgrep/<language>/`.

- **`LLMProvider`** — three methods: `explainFinding`, `generateFix`,
  `answerQuery`, every one of them taking a structured `EvidenceBundle`
  (code + billing + carbon + infra + git context) instead of a bare prompt.
  The production implementation is `AnthropicProvider`, built on the Vercel
  AI SDK (Anthropic API, or OpenRouter when only `OPENROUTER_API_KEY` is
  set); the CLI's offline harness has a `ScriptedLLM` for tests. **To swap
  models**: change the model id passed into `AnthropicProvider`. **To add a
  new vendor**: write a sibling class implementing `LLMProvider`. See
  "Working on the AI layer" below.

## Workflow

- Work off short-lived branches; open a PR against `main`.
- Keep PRs scoped to one package or one concern where possible — it makes
  review of cross-cutting interface changes much easier to reason about.
- Run `pnpm typecheck` and `pnpm build` locally before pushing.
- If your change touches `packages/github-action/src`, rebuild it
  (`pnpm --filter @terratrace/github-action build`) and commit the resulting
  `dist/` output — GitHub Actions run the committed bundle, not source, since
  there is no build step at Action-invocation time.

## Adding a new billing source (e.g. GCP, Azure)

1. Create `packages/core/src/billing/<Provider>Source.ts` implementing
   `CloudBillingSource` (`provider: string`, `fetchUsage({ start, end })`).
2. Map that cloud's native usage/cost response into `UsageRecord[]` — see
   `AWSCurSource.ts` for the shape to follow.
3. Export it from `packages/core/src/index.ts`.
4. No changes needed in `cli`, `github-action`, or `dashboard` — they consume
   the interface, not the implementation.

## Adding a new language analyzer

Follow `JavaAnalyzer.ts` as the template — the default path for a new
language is Semgrep-only, no new native parser dependency required:

1. Add `packages/core/rules-semgrep/<language>/*.yaml` — one Semgrep rule
   file per detection, following the existing Python/Java packs (same rule
   `id` across languages when the detection is conceptually the same, e.g.
   `n-plus-one-query` exists for both).
2. Create `packages/core/src/analyzer/<Language>Analyzer.ts` implementing
   `CodeAnalyzer`: a thin class whose `analyzeFile` delegates to a
   `SemgrepAnalyzer` constructed with `{ language: "<language>", rulesDir:
   <path to that pack> }`. This gives the language a discoverable named
   entry point (matching `PythonAnalyzer`/`JavaAnalyzer`) without writing a
   tree-sitter grammar you don't need yet.
3. Add an entry to `SUPPORTED_LANGUAGES` in
   `packages/core/src/analyzer/languages.ts` (`id`, file `extensions`,
   `glob`) — `cli` and `github-action` both build their file glob and their
   `MultiLanguageAnalyzer` wiring from this list, so this one entry is
   enough for both to pick up the new language.
4. Export the new analyzer from `packages/core/src/index.ts`.
5. Add at least one planted-pattern sample file under `sample-repo/` (see
   the existing Python files and the `sample-repo/java/` tree) so the
   detection is exercisable end-to-end via the CLI.

Only reach for a real tree-sitter grammar (like `PythonAnalyzer`'s legacy
path) when a detection genuinely needs control-flow/AST reasoning Semgrep's
pattern language can't express — see the note at the top of
`rules/registry.ts` for why Python's tree-sitter rule set is empty by
default today.

### Adding a detection rule to an existing language

Add a new `.yaml` file under `rules-semgrep/<language>/` (see
`n-plus-one-query.yaml` for the shape: `id`, `languages`, `severity`,
`message`, `metadata`, `patterns`/`pattern`). Keep rule heuristics honest in
their own comments about false-positive/negative risk — see the note at the
top of `unbounded-query.yaml` for the tone to match. (The legacy
tree-sitter path — implement `DetectionRule` and add it to a language's
registry array — still exists for control-flow detections Semgrep can't
express; see `rules/python/database.ts`.)

If the new rule should get a carbon estimate, add its `id` to
`RULE_SERVICE_MAP` in `packages/core/src/carbon/correlate.ts`, mapping it to
the AWS service it most directly amplifies (e.g. `chatty-s3-loop` maps to
`AmazonS3`). Without an entry there, `correlateFindingsWithUsage` silently
skips that rule's findings — they just won't carry an `estimate`. Rule ids
are shared across languages, so one `RULE_SERVICE_MAP` entry covers a
detection's Python and Java (and future-language) implementations alike.

#### Rule backlog (deferred on purpose)

These were prototyped as ideas and deliberately deferred: a precise Semgrep
pattern needs dataflow reasoning a plain AST match can't do reliably, so
shipping them now would mean a high false-positive rate. That conflicts with
this project's preference for being honest about a heuristic's limits over
chasing rule-count coverage.

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

## Adding or swapping an LLM provider

- **Swapping models within Anthropic**: change the `modelId` passed into
  `AnthropicProvider`'s constructor (or the default in
  `packages/core/src/llm/AnthropicProvider.ts`) — one line.
- **Adding a new vendor**: create a sibling class implementing `LLMProvider`
  (`modelId`, `explainFinding`, `generateFix`, `answerQuery`), all three
  methods taking an `EvidenceBundle` (or `EvidenceBundle[]` for
  `answerQuery`). Do not add a method that takes a bare string prompt instead
  of an evidence bundle — every LLM call in this project must reason from
  structured code + billing + infra evidence, not act as a plain chatbot
  wrapper.

## Working on the carbon model

The formulas and constants are in the README ("How the numbers are
calculated"). This is where they live and what must stay true.

**Where things live** (`packages/core/src/carbon/`)

- `carbonMath.ts`: `estimateCarbon`, which sums kWh, applies grid intensity and sets confidence.
- `energyModel.ts`: the `EnergyModel` interface; `estimateKwh(record)` returns 0 for a service it does not recognise.
- `coefficients/aws.ts`: per-family watts, the PUE, and the S3 and Lambda coefficients.
- `coefficients/grid.ts`: kg CO2e per kWh by provider and region, the 0.4 default, and `registerOnPremGridIntensity` for per-deployment on-prem values.
- `coefficients/index.ts`: registers each provider's model.
- `correlate.ts` apportions a service's usage across its findings; `correlateInfra.ts` is the Compute Optimizer cross-reference.

**Invariants**

- Carbon comes from usage, never from cost.
- A record the model cannot price counts as zero energy and lowers coverage; do not guess a figure for it.
- Confidence is coverage-based (0.8 or above is medium). The deterministic estimator must not return high; only a measured comparison, like the Compute Optimizer path, may.
- An unknown region falls back to 0.4 kg/kWh.

**Adding a provider or service**

1. Implement `EnergyModel` for it and register it in `coefficients/index.ts`.
2. Fill in its grid intensities in `coefficients/grid.ts` (the GCP and Azure tables are empty today).
3. Add tests under `carbon/__tests__/` and re-run `node scripts/carbon-smoke.mjs` (expected output is in TESTING.md).

The wattage and grid tables are seed values that approximate CCF's published
ones, and both files carry a comment saying so. Replace them with CCF's
canonical constants before quoting a figure to a client.

## Working on the AI layer

Read this before changing a prompt, a model, `ruleSkills.ts` or the
validation loop. The reader-facing summary is in the README's "AI in
TerraTrace" and "Guardrails" sections.

### Where each guardrail lives

**AI guardrails**

| Guardrail | What it does | Where |
|---|---|---|
| Evidence only | Every LLM method takes a structured `EvidenceBundle`, never a bare prompt. The model is told to use only numbers present in the bundle and to say so when billing or carbon data is missing | `packages/core/src/llm/LLMProvider.ts`, `AnthropicProvider.ts` |
| Prompt-injection defence | Scanned source, billing and git data are treated as untrusted. A system-prompt clause says it is data, never instructions, and the evidence is wrapped in `<untrusted_evidence>` tags | `packages/core/src/llm/AnthropicProvider.ts` |
| Rule-specific fix guidance | Framework-aware instructions per rule (Django, Spring Data, boto3 and so on), so fixes follow the codebase's idiom | `packages/core/src/llm/ruleSkills.ts` |
| Deterministic fix first | If the Semgrep rule ships its own autofix, that is used instead of asking the model | `packages/core/src/recommend/recommendFinding.ts` |
| Fix validation | The diff is applied in memory and the file re-scanned. A fix is offered only if the finding is gone and no new finding appeared. Up to 2 retries, with the previous failure fed back to the model | `packages/core/src/recommend/recommendFinding.ts` |
| Wrong-file rejection | A diff that touches any file other than the finding's own file is rejected | `diffTargetsWrongFile` in `recommendFinding.ts` |
| Cost cap | LLM calls are limited to `TERRATRACE_MAX_LLM_FINDINGS` findings per scan (default 50), highest severity first. The rest still appear, without an explanation or fix | `packages/cli/src/index.ts` |
| Eval test | Runs the recommendation loop against the planted findings in `sample-repo/` to catch prompt, model or rule-guidance regressions. Skipped without an API key | `packages/core/src/recommend/__evals__/` |

**Pipeline and access guardrails**

| Guardrail | What it does | Where |
|---|---|---|
| Read-only scanning | The scan workflow only reads the target repo and writes to TerraTrace's own database. It must never gain commit, push or PR steps | `.github/workflows/scan-repo.yml` |
| Remediation is separate and explicit | Fix PRs come from their own workflow, triggered by a person. A PR means "in progress"; a finding is remediated only when a later rescan no longer finds it | `.github/workflows/remediate-repo.yml`, `packages/dashboard/scripts/remediate.mjs` |
| No duplicate PRs | Each finding has an idempotency key, applied as a label, so re-runs never open a second PR for the same finding | `remediate.mjs`, `packages/github-action/` |
| Billing opt-in | A CUR upload only touches projects with the billing link switched on, so an unrelated repo never receives someone else's cost and carbon figures | `packages/dashboard/src/app/api/billing/route.ts` |
| Sign-in | GitHub OAuth with a collaborator check on the repo. The session is an HMAC-signed cookie compared in constant time | `packages/dashboard/src/lib/session.ts`, `src/proxy.ts`, `src/app/api/auth/` |
| Build and type safety | Strict TypeScript everywhere. Every cross-cutting concern sits behind one of three interfaces, so a new cloud, language or model cannot bypass the evidence rule | `tsconfig.base.json`, `packages/core/src/index.ts` |

### How a prompt is built

- One system prompt per operation, each ending with the prompt-injection clause.
- The evidence bundle goes in as JSON inside `<untrusted_evidence>` tags.
- Per-rule guidance (`ruleSkills.ts`) adds framework idioms: Django ORM, Spring Data, boto3 batch calls.
- On a retry, the previous diff and why it failed go back into the bundle.

### Model and tooling

- Vercel AI SDK (`generateText`), behind the `LLMProvider` interface.
- Default model `claude-sonnet-4-6` on the Anthropic API. If only `OPENROUTER_API_KEY` is set, it routes `anthropic/claude-sonnet-4.6` through OpenRouter.
- Swapping the model is the constructor's `modelId` argument. Swapping the provider is a new `LLMProvider` implementation.
- Offline `ScriptedLLM` harness (`packages/cli/src/harness.ts`) replays canned diffs, so the validation loop can be tested with no API call.

### Changing a prompt, a model or rule guidance

- Keep the prompt-injection clause on every system prompt and the evidence inside `<untrusted_evidence>` tags.
- Keep "use only numbers in the evidence" intact; explanations must not invent figures.
- After any prompt, model or `ruleSkills.ts` change, run the eval: `ANTHROPIC_API_KEY=... pnpm --filter @terratrace/core test` (or set `OPENROUTER_API_KEY`). Without a key the eval is skipped, and the other tests use the offline `ScriptedLLM` and need no API call.

### AI-assisted development

- Built with Claude Code.
- `CLAUDE.md`: the rules agents follow here (three interfaces, evidence bundle, build order).
- `packages/dashboard/AGENTS.md`: tells agents to read the bundled Next.js docs before writing code.
- `.claude/PROJECT_CONTEXT.md`: resumable notes, so a fresh session picks up where the last one stopped.
- `.claude/skills/`: `scan-repo`, `remediate-repo` and `add-project` wrap the GitHub workflows. Scanning stays read-only; PRs are a separate, explicit skill.

## Coding conventions

- TypeScript everywhere, strict mode on (`tsconfig.base.json`). Don't loosen
  `strict` in a package-level `tsconfig.json`.
- Prefer small, focused interfaces over configuration objects with optional
  flags — that's the whole point of `CloudBillingSource` / `CodeAnalyzer` /
  `LLMProvider`.
- No comments explaining *what* code does; a short comment is fine (and
  encouraged) when a heuristic is intentionally approximate or a placeholder
  needs replacing before production use — see `carbonMath.ts` and
  `nPlusOneQuery.ts` for the tone to match.
- Don't hardcode a specific cloud, language, or model outside of that
  concern's own implementation file.
- The dashboard's charts (`packages/dashboard/src/components/Dashboard.tsx`)
  use `recharts`. Derived stats (severity counts, per-file impact scores) live
  in `packages/dashboard/src/lib/stats.ts` as pure functions — keep new chart
  data prep there rather than inline in the component, so it stays testable
  independent of React.

## Reporting issues

Use GitHub Issues on this repo. Include the package affected, repro steps,
and (for analyzer bugs) the offending code snippet.

## Suggested 3-person team split

- **Person A** — billing + carbon math, later the live grid-carbon-intensity
  API for batch-workload timing recommendations
  (`packages/core/src/billing/`, `packages/core/src/carbon/`).
- **Person B** — analyzer + detection rules, expanding the Semgrep rule packs
  (`packages/core/rules-semgrep/`) and language coverage beyond Python/Java/Terraform
  (`packages/core/src/analyzer/`).
- **Person C** — dashboard + GitHub Action, the surfaces judges/users
  actually see (`packages/dashboard/`, `packages/github-action/`).

## Week 1 checklist

- [x] `pnpm install` works cleanly at the repo root.
- [x] `pnpm scan` finds the planted N+1 query in `sample-repo/orders/views.py`.
- [ ] `explainFinding` returns a real Claude response (not a stub) for that finding — needs a real `ANTHROPIC_API_KEY` in `.env`.
- [ ] `AWSCurSource.fetchUsage(...)` returns real usage records — needs a real AWS CUR export file (see TESTING.md).

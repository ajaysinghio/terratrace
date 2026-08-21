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
    └── dashboard/      — Next.js app that reads scan-output.json (packages/dashboard/src/app/page.tsx)
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the full source tree, the
architecture behind the three core interfaces, and how to extend each of
them.

## Environment variables

Copy `.env.example` to `.env` and fill in what you need:

| Variable                | Required for                                      |
|--------------------------|----------------------------------------------------|
| `ANTHROPIC_API_KEY`      | CLI / GitHub Action (`explainFinding`, `generateFix`) |
| `AWS_ACCESS_KEY_ID`      | AWS Cost Explorer billing lookups                 |
| `AWS_SECRET_ACCESS_KEY`  | AWS Cost Explorer billing lookups                 |
| `AWS_REGION`             | AWS Cost Explorer billing lookups (default `us-east-1`) |
| `GITHUB_TOKEN`           | GitHub Action (posting PR comments)               |

## Run locally

```bash
corepack enable pnpm             # one-time, if pnpm isn't already available
pnpm install
cp .env.example .env             # fill in ANTHROPIC_API_KEY at minimum
pnpm build                       # builds every package, core first
```

`@terratrace/core` must be built before `cli`, `github-action`, or
`dashboard` will type-check or run — they all depend on its compiled
declarations via `workspace:*`. `pnpm build` handles ordering automatically.

**CLI** — scan the planted sample repo and print enriched findings as JSON:

```bash
pnpm scan
# or a specific glob:
pnpm --filter @terratrace/cli start "./sample-repo/**/*.py"
```

**Dashboard (dev mode)** — write scan results for the dashboard to read, then start it:

```bash
pnpm scan > scan-output.json
pnpm dev:dashboard               # http://localhost:3000
```

If `scan-output.json` doesn't exist yet, the dashboard renders a
"run the CLI first" message instead of erroring.

## Deploy

### Dashboard — local production build

```bash
pnpm scan > scan-output.json
pnpm --filter @terratrace/dashboard build
pnpm --filter @terratrace/dashboard start   # http://localhost:3000
```

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
- The dashboard currently reads `scan-output.json` from disk at request time
  (`packages/dashboard/src/app/page.tsx`). For a remote deploy, either commit
  a generated `scan-output.json` as part of your build step, or wire the page
  up to fetch findings from wherever your CI publishes them — the file-read
  is a placeholder for a real findings store.
- No environment variables are required by the dashboard itself today, since
  it only reads a local JSON file.

### GitHub Action — build and publish

The Action runs a committed bundle, not source — there's no build step at
Action-invocation time. Build it before tagging/pushing a release:

```bash
pnpm --filter @terratrace/github-action build
git add packages/github-action/dist
git commit -m "build: github-action dist"
```

Then reference it from any workflow (in this repo or another one that can
reach it):

```yaml
# .github/workflows/terratrace.yml
name: TerraTrace
on:
  pull_request:
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

The `actions/checkout` step with the PR head ref is required — the Action
reads changed Python files from the local checkout rather than the GitHub
Contents API.

### CLI — remote / CI usage

Run the same scan in any CI pipeline (no deploy needed, just Node + pnpm):

```bash
pnpm install --frozen-lockfile
pnpm --filter @terratrace/core build
pnpm --filter @terratrace/cli build
ANTHROPIC_API_KEY=*** pnpm scan > scan-output.json
```

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the full repo layout, the
three-interface architecture (`CloudBillingSource` / `CodeAnalyzer` /
`LLMProvider`) and how to extend each one, coding conventions, the suggested
3-person team split, and the Week 1 checklist.

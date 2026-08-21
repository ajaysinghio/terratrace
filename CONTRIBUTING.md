# Contributing to TerraTrace

## Prerequisites

- Node.js >= 20
- pnpm (via corepack: `corepack enable pnpm`, or `corepack prepare pnpm@latest --activate`)
- An Anthropic API key for any work touching `explainFinding` / `generateFix` / `answerQuery`
- AWS credentials with `ce:GetCostAndUsage` for any work touching `AWSCurSource`

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

## Repo layout

```
terratrace/
├── package.json                 (root workspace scripts)
├── pnpm-workspace.yaml           (packages: "packages/*")
├── tsconfig.base.json            (shared strict TS config, ES2022, NodeNext)
├── .gitignore
├── .env.example
├── README.md
└── packages/
    ├── core/
    │   └── src/
    │       ├── index.ts           (re-exports everything below)
    │       ├── types.ts           (shared domain types)
    │       ├── billing/
    │       │   ├── CloudBillingSource.ts   (interface)
    │       │   └── AWSCurSource.ts         (AWS Cost Explorer implementation)
    │       ├── analyzer/
    │       │   ├── CodeAnalyzer.ts         (interface + DetectionRule interface)
    │       │   ├── PythonAnalyzer.ts       (tree-sitter-python implementation)
    │       │   └── rules/
    │       │       ├── nPlusOneQuery.ts    (example rule)
    │       │       └── registry.ts         (pythonRules: DetectionRule[])
    │       ├── llm/
    │       │   ├── LLMProvider.ts          (interface)
    │       │   └── AnthropicProvider.ts    (Vercel AI SDK implementation)
    │       └── carbon/
    │           └── carbonMath.ts           (SCI-style kgCO2e estimate)
    ├── cli/
    │   └── src/index.ts           (end-to-end scan pipeline)
    ├── github-action/
    │   ├── action.yml             (node20 runtime)
    │   └── src/index.ts           (PR bot)
    └── dashboard/
        └── src/
            ├── app/
            │   ├── page.tsx                       (home: lists all scanned projects)
            │   └── projects/[projectId]/page.tsx   (drill-down: charts, heatmap, carbon)
            ├── components/Dashboard.tsx            (charts/heatmap/carbon, shared by drill-down)
            └── lib/
                ├── projects.ts    (reads scan-output/<project-id>.json files)
                ├── stats.ts       (severity/file/carbon aggregation, pure functions)
                └── equivalents.ts (illustrative environmental-impact equivalents)
```

This is a pnpm workspace with one shared package (`core`) and three
consumers (`cli`, `github-action`, `dashboard`).

## Architecture: three interfaces, everything else is swappable

Every cross-cutting concern is hidden behind a TypeScript interface in
`@terratrace/core`, so a single cloud/language/model can be swapped for
another later without touching any caller.

- **`CloudBillingSource`** — one method, `fetchUsage({ start, end })`. Only
  implementation today is `AWSCurSource` (AWS Cost Explorer). **To add a new
  cloud** (GCP, Azure, on-prem metering): write a new class implementing
  `CloudBillingSource` in `packages/core/src/billing/`; nothing else changes.

- **`CodeAnalyzer`** — one method, `analyzeFile(filePath, sourceCode)`. Only
  implementation today is `PythonAnalyzer`, which runs a pluggable list of
  `DetectionRule`s against a tree-sitter parse tree. **To add a new
  language**: write a new `CodeAnalyzer` (e.g. backed by
  `tree-sitter-javascript`) plus its own rule set under
  `packages/core/src/analyzer/`; the CLI, GitHub Action, and dashboard never
  need to change. **To add a new detection**: add a `DetectionRule` to
  `rules/registry.ts`.

- **`LLMProvider`** — three methods: `explainFinding`, `generateFix`,
  `answerQuery`, every one of them taking a structured `EvidenceBundle`
  (code + billing + carbon + infra + git context) instead of a bare prompt.
  Only implementation today is `AnthropicProvider`, built on the Vercel AI
  SDK. **To swap models**: change the model id passed into
  `AnthropicProvider`. **To add a new vendor**: write a sibling class
  implementing `LLMProvider`.

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

1. Create `packages/core/src/analyzer/<Language>Analyzer.ts` implementing
   `CodeAnalyzer` (`language: string`, `analyzeFile(filePath, sourceCode)`),
   backed by the relevant tree-sitter grammar package.
2. Add a `packages/core/src/analyzer/rules/` registry for that language's
   `DetectionRule[]`, following `nPlusOneQuery.ts` / `registry.ts` as the
   template.
3. Export the analyzer and its rule registry from
   `packages/core/src/index.ts`.

### Adding a detection rule to an existing language

Add a new file under `analyzer/rules/`, implement `DetectionRule` (`id`,
`description`, `severity`, `detect({ filePath, sourceCode, tree })`), and
add it to that language's registry array (e.g. `pythonRules`). Keep rule
heuristics honest in their own comments about false-positive/negative risk —
see the note at the top of `nPlusOneQuery.ts`.

If the new rule should get a carbon estimate, add its `id` to
`RULE_SERVICE_MAP` in `packages/core/src/carbon/correlate.ts`, mapping it to
the AWS service it most directly amplifies (e.g. a "chatty S3 list" rule
would map to `AmazonS3`). Without an entry there, `correlateFindingsWithUsage`
silently skips that rule's findings — they just won't carry an `estimate`.

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
- **Person B** — analyzer + detection rules, expanding beyond the N+1 query
  heuristic and eventually beyond Python
  (`packages/core/src/analyzer/`).
- **Person C** — dashboard + GitHub Action, the surfaces judges/users
  actually see (`packages/dashboard/`, `packages/github-action/`).

## Week 1 checklist

- [x] `pnpm install` works cleanly at the repo root.
- [x] `pnpm scan` finds the planted N+1 query in `sample-repo/orders/views.py`.
- [ ] `explainFinding` returns a real Claude response (not a stub) for that finding — needs a real `ANTHROPIC_API_KEY` in `.env`.
- [ ] `AWSCurSource.fetchUsage(...)` returns real usage records from Cost Explorer — needs real AWS credentials with `ce:GetCostAndUsage` permission.

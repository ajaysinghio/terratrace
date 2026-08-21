# CLAUDE.md

Guidance for Claude Code (or any agent) working in this repository.

## What this is

TerraTrace is a pnpm-workspace monorepo, TypeScript throughout: it scans a
codebase (Python first, via tree-sitter) for carbon/cost-impacting patterns,
correlates findings with AWS billing data, and uses Claude (via the Vercel AI
SDK) to explain the causal link and generate a real fix diff — not a generic
suggestion. See [README.md](./README.md) for run/deploy instructions and
[CONTRIBUTING.md](./CONTRIBUTING.md) for the full architecture and repo layout.

## Core rule: never bypass the three interfaces

Everything cross-cutting lives behind an interface in `@terratrace/core`:
`CloudBillingSource`, `CodeAnalyzer`, `LLMProvider`. When asked to add a
cloud, a language, or a model, add a new implementation of the relevant
interface under `packages/core/src/` — do not special-case it inside `cli`,
`github-action`, or `dashboard`. Those three packages should only ever import
from `@terratrace/core`'s public exports (`packages/core/src/index.ts`), never
reach into a sibling implementation file directly.

Every `LLMProvider` method takes a structured `EvidenceBundle` (or
`EvidenceBundle[]`), never a bare string prompt. If a change would make an
LLM call reason from anything less than the evidence bundle, stop and
reconsider — that's the project's stated differentiator, not an
implementation detail to relax under time pressure.

## Build order matters

`@terratrace/core` must be built (`pnpm --filter @terratrace/core build`)
before `cli`, `github-action`, or `dashboard` will type-check, since they
consume core's compiled `.d.ts` output via `workspace:*`, not its source.
Run `pnpm build` from the root to get correct ordering automatically. After
editing anything in `packages/core/src`, rebuild core before trusting a
type-check failure (or success) in a downstream package.

## Toolchain quirks worth knowing before "fixing" something

- `typescript@7.0.2` (the native/Corsa compiler) is the version pinned here
  deliberately — it was the actual latest stable release at generation time.
  Don't downgrade it to "fix" an unfamiliar error without first checking
  whether the error is a real regression versus a known TS7 compatibility
  gap in a third-party tool (see the ncc note below).
- `@vercel/ncc`'s bundled TS loader is not compatible with TS7's compiler
  internals. `packages/github-action` works around this by having `tsc`
  compile to `lib/` first, then pointing `ncc` at the plain JS
  (`lib/index.js`) instead of the TypeScript source. Don't "simplify" the
  github-action build script back to `ncc build src/index.ts` — it will
  break.
- `tree-sitter` / `tree-sitter-python` ship native addons; pnpm needs
  `allowBuilds` entries for both in `pnpm-workspace.yaml` (already set) or
  install will pause asking for approval.
- The GitHub Action reads changed `.py` files from the local filesystem
  (assumes the calling workflow already ran `actions/checkout` on the PR
  head), not the GitHub Contents API — don't "fix" this into an API call
  without checking the README's documented assumption first.

## Conventions

- Strict TypeScript everywhere (`tsconfig.base.json`); don't loosen `strict`
  in a package-level `tsconfig.json`.
- No comments explaining *what* code does. A short comment is fine (and
  matches existing style) when flagging an intentionally approximate
  heuristic or a placeholder that needs real data before production use —
  see `carbonMath.ts`'s placeholder energy coefficient and
  `nPlusOneQuery.ts`'s per-ORM caveat.
- `packages/github-action/dist` (and the `lib/` intermediate) are build
  output — the action.yml build note in the README explains when a rebuild
  needs to be committed. Don't hand-edit files under `dist/`.
- The dashboard's `scan-output.json` read is a placeholder for a real
  findings store — see the README's remote-deploy notes before assuming it
  should stay a local file read in any hosted context.

## Multi-project model

The dashboard is org-scale, not single-repo: the CLI writes one file per
scanned repo to `scan-output/<project-id>.json` (`{ project, findings }`,
see `packages/cli/src/index.ts`), and the dashboard's home page
(`packages/dashboard/src/app/page.tsx`) lists every project found under
`scan-output/`, linking to a drill-down page
(`packages/dashboard/src/app/projects/[projectId]/page.tsx`) that renders the
full `<Dashboard>` (charts, heatmap, carbon breakdown) for just that repo.
`packages/dashboard/src/lib/projects.ts` is the only place that knows
`scan-output/` is a directory of JSON files — when this becomes a real
findings store (S3, a database), that's the file to change; the home page and
drill-down page should keep consuming `loadProjectSummaries()` /
`loadProject()` unchanged. Don't reintroduce a single flat
`scan-output.json` — that was the pre-multi-project shape and no longer
matches what the dashboard reads.

## Future direction: core as an agent/harness, not just a library

Today `@terratrace/core` is a passive library — `cli`, `github-action`, and
`dashboard` each wire up `CloudBillingSource` + `CodeAnalyzer` + `LLMProvider`
themselves and drive the pipeline step by step. The intended evolution is for
`core` itself to behave like an agent/harness: given a linked source (a repo
path or URL, plus enough config to resolve its cloud billing account), it
should autonomously run the full analyze → correlate → estimate → explain →
recommend loop and hand back a finished set of findings, explanations, fix
diffs, and prioritized recommendations — without each caller re-orchestrating
that sequence by hand.

Do not build this now — it's noted here so future work moves toward it
instead of accidentally away from it. When it is picked up:

- The orchestration entrypoint belongs in `@terratrace/core` (e.g. something
  like a `TerraTraceAgent`/`runAnalysis` that composes a `CodeAnalyzer`, a
  `CloudBillingSource`, and an `LLMProvider`), not duplicated per-caller.
- It should still go through the existing three interfaces — "acting like an
  agent" means smarter orchestration and sequencing (deciding what to
  analyze, what billing window to correlate, when to call `generateFix` vs.
  just `explainFinding`, how to prioritize/rank findings into
  recommendations), not a bypass of `CloudBillingSource` / `CodeAnalyzer` /
  `LLMProvider`.
- `cli`, `github-action`, and `dashboard` should become thin callers of that
  orchestration entrypoint rather than each re-implementing the
  scan-then-explain loop.

## Verifying changes

- `pnpm build` (root) — builds every package, core first.
- `pnpm typecheck` (root) — type-checks every package.
- There is no test suite yet. If you add one, wire it into each package's
  `package.json` and the root `package.json`'s scripts rather than
  introducing a new ad hoc runner.
- To sanity-check the analyzer without spending an Anthropic API call, run
  `PythonAnalyzer.analyzeFile` directly against `sample-repo/orders/views.py`
  (which has a planted N+1 query) — see the Week 1 checklist in
  CONTRIBUTING.md.

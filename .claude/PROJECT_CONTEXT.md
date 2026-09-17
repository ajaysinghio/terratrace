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

## Discussed but NOT started (no go-ahead given yet)

- Wiring `LLMProvider.answerQuery()` into the dashboard UI.
- MCP server integration.
- AI-based false-positive filtering.
- AWS compute migration (Amplify Hosting for dashboard, CodeBuild for
  scanning, Lambda for remediation) — this was **explicitly framed as
  planning only** ("Just for planning right now"). Do not start migrating
  off Vercel/GitHub Actions without a fresh, explicit ask.

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

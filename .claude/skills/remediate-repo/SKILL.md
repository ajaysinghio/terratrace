---
name: remediate-repo
description: Open real GitHub PRs for validated TerraTrace fixes (bulk or per-finding) via the separate, explicitly-triggered remediate-repo.yml pipeline. Never bundle this into scanning.
---

# Raise fix PRs for a scanned repo

Remediation is a **deliberately separate, human-triggered** pipeline from
scanning — the user has repeatedly and emphatically insisted scanning must
never write to a target repo. This skill is only for the explicit "raise a
PR" / "remediate this finding" ask.

## Semantics — get this right

- Opening a PR moves a finding to **"in progress,"** never "remediated."
- A finding is only marked remediated when a **later rescan** no longer
  finds it (implying the PR was merged) — see the reconciliation logic in
  `packages/dashboard/scripts/import-scan-output.mjs` / `dbUpsertProject`.
- `finding.prUrl` (not `idempotencyKey`) is the source of truth for "has an
  open PR" — see `packages/dashboard/src/lib/roleStats.ts`'s
  `computeFixesInProgress`.

## How to trigger

Dashboard path (validates remediation candidates exist first via
`dbGetRemediationCandidates`):

```
POST /api/projects/<projectId>/remediate
Body: {}                    # bulk — all ready fixes
Body: { "findingId": "…" }  # single finding
```

This dispatches `.github/workflows/remediate-repo.yml`, which runs
`packages/dashboard/scripts/remediate.mjs <projectId> <repoOwner> <repoName> [findingId]`.
That script uses `@octokit/rest` + `diff`'s `applyPatch` against the
Contents/Git Data API directly — **no local checkout of the target repo**.

Direct `gh` trigger:

```bash
gh workflow run remediate-repo.yml \
  --repo <owner>/terratrace \
  -f repo_owner=<target-owner> -f repo_name=<target-repo> \
  -f project_id=<project-id> [-f finding_id=<finding-id>]
```

## Idempotency

PRs are labeled `terratrace:<idempotencyKey>` on a branch named
`terratrace/<idempotencyKey>` — re-running remediation won't duplicate an
already-open PR. A `terratrace:wontfix` label suppresses re-opening entirely.

## Guardrails — do not violate

- Never fold a remediation step into `scan-repo.yml`.
- Never mark a finding `remediated_at` just because a PR was opened —
  that only happens via rescan reconciliation.
- This writes to a real repo (opens a real PR). Confirm with the user
  before triggering unless they've already explicitly asked for it in this
  turn — the dashboard's own `RemediateButton` does a `window.confirm` for
  the same reason.

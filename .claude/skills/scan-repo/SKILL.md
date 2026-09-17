---
name: scan-repo
description: Trigger a read-only TerraTrace scan (first scan or rescan) of a registered project via the centralized scan-repo.yml GitHub Actions pipeline, and check on its run status.
---

# Scan a registered repo

TerraTrace scanning is centralized in `.github/workflows/scan-repo.yml` — it
never touches the target repo (no PRs, no commits, no pushes; this is a hard
invariant, see the "READ-ONLY GUARANTEE" comment block in that file). It
checks out both `terratrace` and the target repo, builds `core`+`cli` from
source, runs semgrep + the analyzer, and imports results into Neon via
`packages/dashboard/scripts/import-scan-output.mjs`.

## When to use this skill

The user asks to "scan `<repo>`", "rescan `<project>`", or "check if the scan
finished" — for a project already registered in the dashboard (via
"Add repo"). If the repo isn't registered yet, register it first (see the
`add-project` skill) — scanning requires a `project_id` that already exists.

## How to trigger a scan

Prefer using the dashboard UI path the app itself uses, since it already
knows the registered `project_id` → `repo_owner`/`repo_name` mapping:

```
POST /api/projects/<projectId>/scan
```

This calls `triggerScanWorkflow()` in `packages/dashboard/src/lib/scanTrigger.ts`,
which dispatches `scan-repo.yml` via the GitHub API using `GITHUB_DISPATCH_TOKEN`.

To trigger directly via `gh` (useful when working outside the running
dashboard, e.g. locally):

```bash
gh workflow run scan-repo.yml \
  --repo <owner>/terratrace \
  -f repo_owner=<target-owner> \
  -f repo_name=<target-repo> \
  -f project_id=<project-id>
```

## Checking status

- `gh run list --repo <owner>/terratrace --workflow=scan-repo.yml --limit 5`
- The dashboard's `/pipeline` page (Manager/Engineer role) shows live runs via
  `listScanWorkflowRuns()` — `packages/dashboard/src/lib/githubActions.ts`.
- Run titles follow `Scan <repo_owner>/<repo_name> → <project_id>` (the
  `run-name:` field), which `getInProgressScanProjectIds()` parses back to
  disable the Scan/Rescan button for that project while a run is in flight.

## Guardrails — do not violate

- Never add a checkout/commit/push step to `scan-repo.yml` for the target
  repo. If a task seems to need that, it's remediation, not scanning — use
  the separate `remediate-repo` skill/workflow instead.
- Don't bypass `import-scan-output.mjs`'s upsert/reconciliation logic (it
  marks findings with a `pr_url` as remediated when they disappear on
  rescan, and deletes stale findings without one) by writing to the DB
  directly.

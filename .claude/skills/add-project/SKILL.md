---
name: add-project
description: Register a new repo (including third-party OSS repos) in the TerraTrace dashboard so it can be scanned by the centralized pipeline, without doing an initial scan automatically.
---

# Register a new project

Registration and scanning are intentionally split (`AddRepoForm` only
registers; the resulting page then offers an explicit "Scan now" button —
see the `scan-repo` skill for that step).

## How to register

```
POST /api/projects
Body: { "name": "<display name>", "repoUrl": "https://github.com/<owner>/<repo>" }
```

This only inserts a `projects` row (`dbRegisterProject` in
`packages/dashboard/src/lib/db.ts`) — it does **not** dispatch a scan and
does **not** touch the target repo at all.

## Billing linkage defaults to OFF

Every newly registered project has `billing_linked = false`. This is
deliberate — a global CUR upload only re-correlates projects explicitly
opted in (`BillingLinkToggle`), so a freshly added OSS repo (e.g.
`spring-petclinic`) never gets bogus cost/carbon numbers from an unrelated
AWS account. Only flip this on for a repo the user confirms actually runs
under the AWS account whose CUR is being uploaded.

## After registering

1. Tell the user the project is registered but not yet scanned.
2. Offer to trigger a scan (`scan-repo` skill) if they want findings now.
3. Do not auto-enable billing linkage — ask, or wait for the user to use
   the toggle on the project's overview page.

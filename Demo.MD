# TerraTrace — demo command sheet

Every command for every demo scenario, in the order you'd use them. Run
`pnpm` commands from the repo root (`/Users/ajaykumarsingh/dev/terratrace`).
Every command is copy-paste ready — no shell variables to set.

Registered projects: `orders-service`, `infra` (both CUR-linked), plus
`spring-petclinic` and `unicorn-store-spring` (not linked — no bogus billing).

**Timing to plan around:** a scan takes ~1.5–5 min per repo (GitHub Actions).
Never start one live; scan beforehand, or show the "running" state and move on.

---

## 0. Before any demo (T-30 min, online)

```bash
git status -sb                         # main in sync with origin/main
gh auth status                         # logged in as ajaysinghio
gh run list -R ajaysinghio/terratrace -L 5   # last scans/deploys green, none stuck in progress
```

- Open the hosted site, sign in with GitHub, click through `/dashboard`
  once per role (`?view=executive|manager|engineer`) to **warm Neon** — the
  first query after idle is the slow one.
- Vercel → Settings → Functions → region should read **Singapore (sin1)**
  (matches Neon `ap-southeast-1`).

---

## 1. Scenario: hosted demo (Vercel + Neon), clean slate

Reset the billing story so the CUR upload is the live moment:

```bash
pnpm --filter @terratrace/dashboard db:cur:clear:remote           # type "clear" at the prompt; keeps projects + findings
```

Then in the browser:

1. Home (`/dashboard?view=executive`) — org charts, no billing numbers yet.
2. Switch to `?view=manager` → open **orders-service** → toggle **billing link** on (already on for orders-service/infra).
3. Upload `sample-data/aws-cur-sample.csv` via the home page upload box → cost/carbon appear on linked projects only.
4. Drill: Files → Domain → Recommendations → Fixes → Remediation.

Keep handy: the CUR file to upload is `sample-data/aws-cur-sample.csv`
(the generator is `node scripts/generate-aws-cur-sample.mjs`; don't
regenerate before a demo).

### Scan a repo (pre-demo, or to show it running)

```bash
gh workflow run scan-repo.yml -R ajaysinghio/terratrace \
  -f repo_owner=ajaysinghio -f repo_name=orders-service \
  -f project_id=orders-service -f project_name="Orders Service"

gh run list -R ajaysinghio/terratrace -w scan-repo.yml -L 3     # status
gh run watch -R ajaysinghio/terratrace                          # live, pick the run
```

(The dashboard's **Scan now / Rescan** buttons do the same thing.) Scanning
is read-only — it never writes to the target repo.

### Raise fix PRs (real PRs on GitHub — only when you mean to)

```bash
gh workflow run remediate-repo.yml -R ajaysinghio/terratrace \
  -f repo_owner=ajaysinghio -f repo_name=orders-service -f project_id=orders-service
# add  -f finding_id=<id>  to raise a PR for just one finding
```

(Or the **Raise PRs for N fix(es)** / per-finding **Create PR** button, manager+.)
A PR means "in progress"; a finding only becomes "remediated" after merge + rescan.
Close demo PRs on GitHub afterwards, or a rerun won't look like a first run.

---

## 2. Scenario: offline demo from the laptop (local Postgres)

**Online, the day before / at least 10 min before:**

```bash
colima start                                   # Docker daemon (skip if Docker Desktop is running)
pnpm --filter @terratrace/dashboard db:local:sync                 # Neon -> backups/*.sql -> local Postgres :5433
pnpm build
```

**Go offline and run:**

```bash
pnpm --filter @terratrace/dashboard start:offline                 # http://localhost:3000, local DB, no GitHub auth
pnpm --filter @terratrace/dashboard start:offline -p 3001         # if 3000 is taken
```

- No sign-in, no GitHub calls. Scan / Rescan / Create PR **do not work offline** — don't click them.
- Everything you change (uploads, link toggles) lives only in the local copy.

**Reset between offline runs** (either one):

```bash
pnpm --filter @terratrace/dashboard db:cur:clear:local            # drop CUR uploads + estimates, keep findings
pnpm --filter @terratrace/dashboard db:local:restore              # full put-back from backups/latest.sql (works with no internet)
```

`db:local:sync` needs internet (it pulls from Neon). `db:local:restore`
only needs the saved dump. Keep `packages/dashboard/backups/latest.sql`
safe — it's gitignored, so it only exists on this laptop.

---

## 3. Reset commands (pick the one you need)

| Goal | Command |
|---|---|
| Remove CUR data on **Neon** (keep findings) | `pnpm --filter @terratrace/dashboard db:cur:clear:remote` |
| Remove CUR data on **local** Postgres | `pnpm --filter @terratrace/dashboard db:cur:clear:local` |
| Skip the prompt | add `-- --yes` to either of the above |
| Restore local DB from the last dump | `pnpm --filter @terratrace/dashboard db:local:restore` |
| Refresh local DB from Neon | `pnpm --filter @terratrace/dashboard db:local:sync` |
| Save a dated Neon backup only | `pnpm --filter @terratrace/dashboard db:local:dump` |

A full "forget all scan results, keep the repos" reset has **no pnpm script**
(a `db:reset` was discussed but never added). Use this SQL — paste it into
the Neon SQL editor for the hosted DB, or for local:

```bash
docker compose exec -T db psql -U terratrace -d terratrace -c \
  "begin; delete from findings; delete from billing_uploads; update projects set scanned_at = null; commit;"
```

```sql
begin;
delete from findings;
delete from billing_uploads;
update projects set scanned_at = null;
commit;
```

This also drops PR links and remediated history. Re-scan afterwards (section 1).

---

## 4. Scan locally with the CLI (needs an Anthropic key, spends API credit)

```bash
pnpm build
ANTHROPIC_API_KEY=... pnpm scan "./sample-repo/**/*.py" sample-repo "Sample Repo"
```

Run from the repo root (the CLI's glob and `scan-output/` path depend on it).
Free sanity check with no API call: scan `sample-repo/orders/views.py` — it
has the planted N+1 query.

---

## 5. Quick health / troubleshooting

```bash
pnpm typecheck && pnpm build                   # code is healthy
lsof -ti:3000 | xargs kill                     # free port 3000 (or 3001)
docker ps                                      # local Postgres container up?  (name: terratrace-db-1)
colima status || colima start                  # Docker not running
docker compose up -d --wait db                 # start local Postgres by itself
```

| Symptom | Likely cause / fix |
|---|---|
| First page load slow, then fast | Neon waking from idle — open the site a few minutes before the demo |
| Slow on every load | Vercel function region not `sin1` (Settings → Functions) |
| `start:offline` can't connect | `docker compose up -d --wait db`, then retry |
| Offline shows stale/empty data | `pnpm --filter @terratrace/dashboard db:local:sync` (online) or `db:local:restore` |
| Billing upload says no project linked | Open a project (manager view) and toggle the billing link on |
| Scan button disabled | A scan for that project is still running — `gh run list -w scan-repo.yml` |
| Edits to `packages/core` look ignored downstream | `pnpm build` first (core must be built) |

---

## 6. Do not, during a demo

- Don't run `db:cur:clear:remote` or any reset against Neon without reading the host the prompt prints.
- Don't trigger `remediate-repo.yml` unless you want real PRs opened.
- Don't regenerate the sample CUR or rebuild the GitHub Action bundle.

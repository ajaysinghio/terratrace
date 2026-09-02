# Testing the carbon pipeline locally

Exact commands for smoke-testing the CCF-based carbon math against a real
or sample AWS Cost and Usage Report (CUR). A sample CUR file plus a runner
script ship with the repo, so no AWS access is needed for the default runs.

## Prerequisites

- pnpm installed
- Node.js 20+

## 1. One-time setup

Run once after cloning, and again any time files under `packages/core/src/`
change:

```bash
cd terratrace
pnpm install
pnpm build
```

`pnpm build` produces `packages/core/dist/`, which the smoke script imports
from. If you only edited core, `pnpm --filter @terratrace/core build` is
enough.

## 2. Run against the sample CUR

```bash
node scripts/carbon-smoke.mjs
```

Expected: 306 rows in the per-record breakdown, aggregate
`kgCO2e: ~15.64`, `confidence: "low"`. Confidence is `"low"` rather than
`"medium"` because the sample includes an ALB (load balancer) — the AWS
energy model doesn't estimate load-balancer wattage, matching CCF's own
scope (see Troubleshooting below).

## 3. Run against your own CUR export

```bash
node scripts/carbon-smoke.mjs /absolute/path/to/your-cur-export.csv
```

The file must be a real AWS CUR export (or something shaped like one) —
see `AWSCurSource.ts`'s docstring in
`packages/core/src/billing/AWSCurSource.ts` for the exact `lineItem/*`,
`product/*`, and `pricing/*` columns it reads. Minimum columns:
`lineItem/ProductCode`, `product/region`, `lineItem/UsageAmount`,
`lineItem/UsageStartDate`. Add `product/instanceType` for per-EC2/RDS-family
accuracy.

If your export uses different header names, add them to `COLUMN_ALIASES` in
`AWSCurSource.ts` and re-run `pnpm --filter @terratrace/core build`.

### Getting a real CUR export

Pulling your own CUR requires setting one up in your AWS account first
(Billing and Cost Management → Data Exports → Standard data export, hourly
granularity, resource IDs enabled). From there, either:

- **Download once, run offline**: sync the delivered files and point
  `carbon-smoke.mjs` / `TERRATRACE_CUR_FILE` at a `.csv` from the sync:

  ```bash
  aws s3 sync s3://your-bucket/your-export-name/ ./my-cur-data/
  ```

- **Fetch live**: set `TERRATRACE_CUR_S3_BUCKET` and
  `TERRATRACE_CUR_S3_MANIFEST_KEY` (pointing at the `*-Manifest.json` AWS
  writes alongside each billing period's data files) and the CLI's
  `AWSCurS3Source` will fetch and decompress the report shards itself —
  see `packages/core/src/billing/AWSCurS3Source.ts`. CUR 1.0 CSV(.gz)
  manifests only; CUR 2.0's Parquet export isn't supported yet. Needs AWS
  credentials available in the environment (env vars, `~/.aws/credentials`
  profile, or an IAM role) with `s3:GetObject` on that bucket — the AWS SDK
  resolves these itself via its default credential chain, nothing
  TerraTrace-specific to configure.

AWS Cost Explorer's `GetCostAndUsage` API and CloudWatch are **not** CUR —
they're coarser, separate AWS billing APIs that CCF explicitly doesn't use
for its carbon math (see `docs/POSITIONING.md`), so TerraTrace doesn't
ingest them either.

## What success looks like

- Non-zero `kgCO2e` in the aggregate.
- `confidence: "medium"` once ≥ 80% of records are covered by the AWS
  energy model (EC2, RDS, S3, Lambda). Services outside that set (e.g. a
  load balancer) will always show `0 kWh` and drag confidence down — that's
  expected, not a bug.
- Per-record breakdown shows different `kWh` values across regions with
  different grid intensities, and across EC2/RDS instance families.

## Cross-check against reference tools

Once you have real numbers from a real account, cross-check for
defensibility:

1. **AWS Customer Carbon Footprint Tool** (AWS Console → Billing →
   Customer Carbon Footprint). Expect TerraTrace's number to be
   **1.5–3× higher** than AWS's number, because CCF uses location-based
   grid intensity while AWS's tool uses market-based (credits their
   renewable purchases). Order-of-magnitude agreement is the win.

2. **CCF's own app** on the same billing period. Since we vendored their
   coefficients, TerraTrace's number should match CCF's within a few %.
   Any larger gap is a bug in our implementation, not a methodology
   difference.

## Troubleshooting

- **`Cannot find module '../packages/core/dist/index.js'`** — run
  `pnpm build` from the project root.
- **`0` records parsed from CSV** — column headers don't match. Compare
  your headers against `COLUMN_ALIASES` in `AWSCurSource.ts`.
- **`confidence: "low"` with real data** — records use a service the AWS
  model doesn't recognise yet. Currently covered: EC2, RDS, S3, Lambda (RDS
  reuses EC2's per-family wattage table, since it runs on the same
  underlying instance hardware — see `awsEnergyModel.estimateKwh` in
  `packages/core/src/carbon/coefficients/aws.ts`). Add more cases there as
  needed.

## Files involved

- `packages/core/src/carbon/energyModel.ts` — extensibility seam
- `packages/core/src/carbon/coefficients/` — CCF-vendored constants (AWS,
  grid intensity) + provider registry
- `packages/core/src/carbon/carbonMath.ts` — dispatches through the
  registry
- `packages/core/src/carbon/correlate.ts` — maps code findings to the AWS
  service their rule implicates (`RULE_SERVICE_MAP`), then to billing usage
  for that service
- `packages/core/src/billing/AWSCurSource.ts` — reads a real (or sample)
  AWS CUR file from local disk
- `packages/core/src/billing/AWSCurS3Source.ts` — fetches a real CUR export
  live from S3 given its manifest location
- `sample-data/aws-cur-sample.csv` — synthetic 3-day, hourly CUR sample for
  a common 3-tier app (EC2, RDS, ALB, Lambda, S3); regenerate with
  `node scripts/generate-aws-cur-sample.mjs`
- `scripts/carbon-smoke.mjs` — the runner used by all commands above
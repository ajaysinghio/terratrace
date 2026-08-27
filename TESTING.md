# Testing the carbon pipeline locally

Exact commands for smoke-testing the CCF-based carbon math (Option A) against
sample or real AWS billing data. Sample data plus a runner script ship with
the repo, so no AWS credentials are needed for the default runs.

## Prerequisites

- pnpm installed
- Node.js 20+
- (Optional, only for path 5 below) AWS CLI configured with credentials that
  have `ce:GetCostAndUsage` permission

## 1. One-time setup

Run once after cloning, and again any time files under `packages/core/src/`
change:

```bash
cd /Users/priyasrivastava/Downloads/terratrace
pnpm install
pnpm build
```

`pnpm build` produces `packages/core/dist/`, which the smoke script imports
from. If you only edited core, `pnpm --filter @terratrace/core build` is
enough.

## 2. Run against the CSV sample

```bash
node scripts/carbon-smoke.mjs
```

Expected: 8 rows in the per-record breakdown, aggregate `kgCO2e: 5.226…`,
`confidence: "medium"`.

## 3. Run against the JSON sample

```bash
node scripts/carbon-smoke.mjs sample-data/aws-cost-explorer-sample.json
```

Expected: 7 rows, aggregate `kgCO2e: 5.555…`, `confidence: "medium"`.

The JSON aggregate is ~6% higher than the CSV aggregate because the JSON
sample matches Cost Explorer's default `SERVICE + REGION` group-by, which
collapses EC2 records to family-average watts. That gap is the accuracy
cost of using Cost Explorer JSON instead of CUR.

## 4. Run against your own CSV export

```bash
node scripts/carbon-smoke.mjs /absolute/path/to/your-export.csv
```

The parser accepts flexible header names — see `COLUMN_ALIASES` in
`packages/core/src/billing/CostExplorerCsvSource.ts` for what it will match.
Minimum columns: `service`, `region`, `usageAmount`, `periodStart`. Add an
`instanceType` column if you want family-level EC2 accuracy.

If a rename isn't enough, add your header names to the `COLUMN_ALIASES`
table and re-run `pnpm --filter @terratrace/core build`.

## 5. Run against your own live AWS account (JSON path)

```bash
aws ce get-cost-and-usage \
  --time-period Start=2026-07-01,End=2026-08-01 \
  --granularity DAILY \
  --metrics UsageQuantity UnblendedCost \
  --group-by Type=DIMENSION,Key=SERVICE Type=DIMENSION,Key=REGION \
  --output json > my-costs.json

node scripts/carbon-smoke.mjs my-costs.json
```

Adjust `--time-period` to a month you actually have spend for.

For higher fidelity (per-EC2-family watts), swap `REGION` for
`INSTANCE_TYPE` in the `--group-by`. You'll then need a custom runner that
constructs `CostExplorerJsonSource` with
`{ groupByOrder: ["SERVICE", "INSTANCE_TYPE"], defaultRegion: "us-east-1" }`.

## What success looks like

- Non-zero `kgCO2e` in the aggregate.
- `confidence: "medium"` (≥ 80% of records covered by the AWS energy model).
- Per-record breakdown shows different `kWh` values across regions with
  different grid intensities.

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
  your headers against `COLUMN_ALIASES` in `CostExplorerCsvSource.ts`.
- **`confidence: "low"` with real data** — records use service names the
  AWS model doesn't recognise yet. Currently covered: EC2, S3, Lambda. Add
  more in the `switch` in `awsEnergyModel.estimateKwh`
  (`packages/core/src/carbon/coefficients/aws.ts`).
- **AWS CLI error `AccessDenied`** — the IAM role/user needs
  `ce:GetCostAndUsage` permission.

## Files involved

- `packages/core/src/carbon/energyModel.ts` — extensibility seam
- `packages/core/src/carbon/coefficients/` — CCF-vendored constants (AWS,
  grid intensity) + provider registry
- `packages/core/src/carbon/carbonMath.ts` — dispatches through the
  registry
- `packages/core/src/billing/CostExplorerCsvSource.ts` — offline CSV reader
- `packages/core/src/billing/CostExplorerJsonSource.ts` — offline JSON
  reader (matches `aws ce get-cost-and-usage --output json`)
- `sample-data/aws-cost-explorer-sample.{csv,json}` — sample fixtures
- `scripts/carbon-smoke.mjs` — the runner used by all commands above

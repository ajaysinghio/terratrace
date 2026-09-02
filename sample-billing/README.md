# Sample billing data

`cur-sample.csv` is a **synthetic** AWS Cost and Usage Report (CUR 1.0 flat
CSV form) for testing, generated because this environment doesn't have
billing-console admin access to pull a real export. It is not real billing
data and should not be treated as representative of actual AWS pricing.

## What it covers

3 days (2026-08-01 to 2026-08-03) of hourly (compute) / daily
(storage/serverless) line items for a common 3-tier web app:

- **EC2** — two `m5.large` app-tier instances, running continuously
- **RDS** — one `db.t3.medium` PostgreSQL instance (`db-orders-primary`),
  standing in for the database behind the N+1 query pattern in
  `sample-repo/orders/views.py`
- **ALB** — one Application Load Balancer fronting the app tier
- **Lambda** — two functions (`order-processor`, `image-resizer`), billed by
  request count and GB-seconds
- **S3** — one bucket (`orders-app-assets`), billed by stored GB and GET
  requests

## Schema

Column names match AWS's real CUR data dictionary
(`identity/LineItemId`, `lineItem/UsageStartDate`, `lineItem/UnblendedCost`,
`product/region`, etc.) so it can stand in for a real CUR export in code that
expects that shape. It intentionally omits reservation/savings-plan/tax
columns and other fields not needed for a basic cost+usage-quantity test.

## Regenerating

```
node sample-billing/generate-cur.mjs
```

Edit the resource lists (`ec2Instances`, `lambdaFunctions`, etc.) in
`generate-cur.mjs` to change the service mix, date range, or rates.
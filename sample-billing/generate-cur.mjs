// Generates sample-billing/cur-sample.csv: a synthetic AWS Cost and Usage
// Report (CUR 1.0, flat CSV form) for a small 3-tier web app. Column names
// match AWS's real CUR data dictionary so it can stand in for a real export
// when there's no billing-console access to pull one. Not real billing data.
//
// Run: node sample-billing/generate-cur.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

const PAYER_ACCOUNT_ID = "111122223333";
const USAGE_ACCOUNT_ID = "111122223333";
const REGION = "us-east-1";
const BILLING_PERIOD_START = "2026-08-01T00:00:00Z";
const BILLING_PERIOD_END = "2026-09-01T00:00:00Z";
const DAYS = 3;
const HOURS = DAYS * 24;

const COLUMNS = [
  "identity/LineItemId",
  "identity/TimeInterval",
  "bill/BillingPeriodStartDate",
  "bill/BillingPeriodEndDate",
  "bill/PayerAccountId",
  "lineItem/UsageAccountId",
  "lineItem/LineItemType",
  "lineItem/UsageStartDate",
  "lineItem/UsageEndDate",
  "lineItem/ProductCode",
  "lineItem/UsageType",
  "lineItem/Operation",
  "lineItem/AvailabilityZone",
  "lineItem/ResourceId",
  "lineItem/UsageAmount",
  "lineItem/CurrencyCode",
  "lineItem/UnblendedRate",
  "lineItem/UnblendedCost",
  "lineItem/LineItemDescription",
  "product/ProductName",
  "product/region",
  "product/instanceType",
  "product/databaseEngine",
  "product/storageClass",
  "pricing/publicOnDemandCost",
  "pricing/publicOnDemandRate",
  "pricing/unit",
  "resourceTags/user:Environment",
  "resourceTags/user:Name",
];

const rows = [];
let lineItemCounter = 1;

function isoHour(hourIndex) {
  const start = new Date(BILLING_PERIOD_START);
  start.setUTCHours(start.getUTCHours() + hourIndex);
  return start.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function isoDay(dayIndex) {
  const start = new Date(BILLING_PERIOD_START);
  start.setUTCDate(start.getUTCDate() + dayIndex);
  return start.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function addRow(fields) {
  const row = { ...fields };
  row["identity/LineItemId"] = `li-${String(lineItemCounter++).padStart(6, "0")}`;
  row["bill/BillingPeriodStartDate"] = BILLING_PERIOD_START;
  row["bill/BillingPeriodEndDate"] = BILLING_PERIOD_END;
  row["bill/PayerAccountId"] = PAYER_ACCOUNT_ID;
  row["lineItem/UsageAccountId"] = USAGE_ACCOUNT_ID;
  row["lineItem/LineItemType"] = "Usage";
  row["lineItem/CurrencyCode"] = "USD";
  row["product/region"] = REGION;
  row["resourceTags/user:Environment"] = "production";
  rows.push(row);
}

function hourlyUsageRow({ start, end, productCode, usageType, operation, az, resourceId, usageAmount, rate, productName, extra, tagName, unit = "Hrs" }) {
  const cost = usageAmount * rate;
  addRow({
    "identity/TimeInterval": `${start}/${end}`,
    "lineItem/UsageStartDate": start,
    "lineItem/UsageEndDate": end,
    "lineItem/ProductCode": productCode,
    "lineItem/UsageType": usageType,
    "lineItem/Operation": operation,
    "lineItem/AvailabilityZone": az,
    "lineItem/ResourceId": resourceId,
    "lineItem/UsageAmount": usageAmount.toFixed(6),
    "lineItem/UnblendedRate": rate.toFixed(8),
    "lineItem/UnblendedCost": cost.toFixed(8),
    "lineItem/LineItemDescription": `${productName} usage`,
    "product/ProductName": productName,
    "product/instanceType": extra?.instanceType ?? "",
    "product/databaseEngine": extra?.databaseEngine ?? "",
    "product/storageClass": extra?.storageClass ?? "",
    "pricing/publicOnDemandCost": cost.toFixed(8),
    "pricing/publicOnDemandRate": rate.toFixed(8),
    "pricing/unit": unit,
    "resourceTags/user:Name": tagName,
  });
}

// EC2: two app-tier instances, m5.large, running continuously.
const EC2_RATE = 0.096;
const ec2Instances = [
  { resourceId: "i-0aaaa1111bbbb2222", az: "us-east-1a", tagName: "app-server-1" },
  { resourceId: "i-0aaaa3333bbbb4444", az: "us-east-1b", tagName: "app-server-2" },
];
for (let h = 0; h < HOURS; h++) {
  const start = isoHour(h);
  const end = isoHour(h + 1);
  for (const instance of ec2Instances) {
    hourlyUsageRow({
      start,
      end,
      productCode: "AmazonEC2",
      usageType: "BoxUsage:m5.large",
      operation: "RunInstances",
      az: instance.az,
      resourceId: instance.resourceId,
      usageAmount: 1,
      rate: EC2_RATE,
      productName: "Amazon Elastic Compute Cloud",
      extra: { instanceType: "m5.large" },
      tagName: instance.tagName,
    });
  }
}

// RDS: single PostgreSQL instance backing the orders service (feeds the
// N+1 pattern in sample-repo/orders/views.py), running continuously.
const RDS_RATE = 0.068;
for (let h = 0; h < HOURS; h++) {
  const start = isoHour(h);
  const end = isoHour(h + 1);
  hourlyUsageRow({
    start,
    end,
    productCode: "AmazonRDS",
    usageType: "InstanceUsage:db.t3.medium",
    operation: "CreateDBInstance:0014",
    az: "us-east-1a",
    resourceId: "db-orders-primary",
    usageAmount: 1,
    rate: RDS_RATE,
    productName: "Amazon Relational Database Service",
    extra: { instanceType: "db.t3.medium", databaseEngine: "PostgreSQL" },
    tagName: "orders-db",
  });
}

// ALB fronting the app tier, running continuously.
const ALB_RATE = 0.0225;
for (let h = 0; h < HOURS; h++) {
  const start = isoHour(h);
  const end = isoHour(h + 1);
  hourlyUsageRow({
    start,
    end,
    productCode: "AWSELB",
    usageType: "LoadBalancerUsage",
    operation: "LoadBalancing:Application",
    az: "",
    resourceId: "app/orders-alb/abc123def456",
    usageAmount: 1,
    rate: ALB_RATE,
    productName: "Amazon Elastic Load Balancing",
    tagName: "orders-alb",
  });
}

// Lambda: two functions, billed daily (requests + GB-seconds).
const LAMBDA_REQUEST_RATE = 0.0000002; // per request
const LAMBDA_GB_SECOND_RATE = 0.0000166667;
const lambdaFunctions = [
  { resourceId: "order-processor", dailyRequests: 50000, avgDurationSec: 0.5, memoryGb: 0.5 },
  { resourceId: "image-resizer", dailyRequests: 8000, avgDurationSec: 2, memoryGb: 1 },
];
for (let d = 0; d < DAYS; d++) {
  const start = isoDay(d);
  const end = isoDay(d + 1);
  for (const fn of lambdaFunctions) {
    hourlyUsageRow({
      start,
      end,
      productCode: "AWSLambda",
      usageType: "Request",
      operation: "Invoke",
      az: "",
      resourceId: fn.resourceId,
      usageAmount: fn.dailyRequests,
      rate: LAMBDA_REQUEST_RATE,
      productName: "AWS Lambda",
      tagName: fn.resourceId,
      unit: "Requests",
    });
    const gbSeconds = fn.dailyRequests * fn.avgDurationSec * fn.memoryGb;
    hourlyUsageRow({
      start,
      end,
      productCode: "AWSLambda",
      usageType: "Lambda-GB-Second",
      operation: "Invoke",
      az: "",
      resourceId: fn.resourceId,
      usageAmount: gbSeconds,
      rate: LAMBDA_GB_SECOND_RATE,
      productName: "AWS Lambda",
      tagName: fn.resourceId,
      unit: "GB-Second",
    });
  }
}

// S3: one bucket, daily storage + request charges.
const S3_STORAGE_RATE = 0.023 / 30; // per GB per day
const S3_REQUEST_RATE = 0.0000004; // per GET request
const S3_STORED_GB = 500;
const S3_DAILY_REQUESTS = 12000;
for (let d = 0; d < DAYS; d++) {
  const start = isoDay(d);
  const end = isoDay(d + 1);
  hourlyUsageRow({
    start,
    end,
    productCode: "AmazonS3",
    usageType: "TimedStorage-ByteHrs",
    operation: "StandardStorage",
    az: "",
    resourceId: "orders-app-assets",
    usageAmount: S3_STORED_GB,
    rate: S3_STORAGE_RATE,
    productName: "Amazon Simple Storage Service",
    extra: { storageClass: "Standard" },
    tagName: "orders-app-assets",
    unit: "GB-Mo",
  });
  hourlyUsageRow({
    start,
    end,
    productCode: "AmazonS3",
    usageType: "Requests-Tier2",
    operation: "GetObject",
    az: "",
    resourceId: "orders-app-assets",
    usageAmount: S3_DAILY_REQUESTS,
    rate: S3_REQUEST_RATE,
    productName: "Amazon Simple Storage Service",
    extra: { storageClass: "Standard" },
    tagName: "orders-app-assets",
    unit: "Requests",
  });
}

function csvEscape(value) {
  const str = String(value ?? "");
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

const lines = [COLUMNS.join(",")];
for (const row of rows) {
  lines.push(COLUMNS.map((col) => csvEscape(row[col])).join(","));
}

const outPath = join(__dirname, "cur-sample.csv");
writeFileSync(outPath, lines.join("\n") + "\n");
console.log(`Wrote ${rows.length} rows to ${outPath}`);
// Generates sample-data/aws-cur-sample-partial.csv: the same synthetic CUR
// as aws-cur-sample.csv, minus every AmazonS3 line item. For the demo's
// "not every finding correlates with billing data" story — chatty-s3-loop
// and missing-lifecycle-policy findings (mapped to AmazonS3 in
// RULE_SERVICE_MAP) get no cost/carbon estimate against this file, while
// n-plus-one-query/unbounded-query (RDS) and oversized-instance-type/
// no-autoscaling-floor (EC2) still do — showing a finding can stay
// unrelated-to-billing and still carry a recommendation.
//
// Run: node scripts/generate-aws-cur-sample-partial.mjs (regenerate after
// re-running generate-aws-cur-sample.mjs, since this filters its output)

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const sourcePath = join(__dirname, "..", "sample-data", "aws-cur-sample.csv");
const outPath = join(__dirname, "..", "sample-data", "aws-cur-sample-partial.csv");

const lines = readFileSync(sourcePath, "utf-8").split("\n");
const header = lines[0];
const productCodeIndex = header.split(",").indexOf("lineItem/ProductCode");
if (productCodeIndex === -1) {
  throw new Error(`Couldn't find lineItem/ProductCode column in ${sourcePath}`);
}

const filtered = [
  header,
  ...lines.slice(1).filter((line) => line.length > 0 && line.split(",")[productCodeIndex] !== "AmazonS3"),
];

writeFileSync(outPath, filtered.join("\n") + "\n");
console.log(`Wrote ${outPath} (${filtered.length - 1} rows, AmazonS3 removed).`);

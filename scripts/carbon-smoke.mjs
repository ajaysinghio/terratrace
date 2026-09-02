import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { AWSCurSource, estimateCarbon, energyModelFor, gridIntensity } from "../packages/core/dist/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const inputPath = process.argv[2]
  ? resolve(process.cwd(), process.argv[2])
  : resolve(__dirname, "..", "sample-data", "aws-cur-sample.csv");

const source = new AWSCurSource(inputPath);
const records = await source.fetchUsage({ start: "2026-08-01", end: "2026-08-04" });

console.log(`\nParsed ${records.length} usage records from:\n  ${inputPath}\n`);

const awsModel = energyModelFor("aws");
if (!awsModel) throw new Error("AWS energy model not registered");

console.log("Per-record breakdown:");
console.log("─".repeat(105));
console.log(
  "service".padEnd(45) +
    "region".padEnd(14) +
    "instanceType".padEnd(14) +
    "kWh".padStart(10) +
    "gCO2/kWh".padStart(11) +
    "kgCO2e".padStart(10),
);
console.log("─".repeat(105));

for (const r of records) {
  const kwh = awsModel.estimateKwh(r);
  const intensity = gridIntensity("aws", r.region);
  const kg = kwh * intensity;
  console.log(
    r.service.padEnd(45) +
      r.region.padEnd(14) +
      (r.resourceId ?? "").padEnd(14) +
      kwh.toFixed(3).padStart(10) +
      (intensity * 1000).toFixed(0).padStart(11) +
      kg.toFixed(4).padStart(10),
  );
}
console.log("─".repeat(105));

const estimate = estimateCarbon(records);
console.log("\nAggregate CarbonEstimate:");
console.log(JSON.stringify(estimate, null, 2));
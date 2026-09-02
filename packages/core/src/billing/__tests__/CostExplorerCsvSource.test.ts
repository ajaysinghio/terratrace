import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseCostExplorerCsv } from "../CostExplorerCsvSource.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SAMPLE_CUR_PATH = resolve(__dirname, "../../../../../sample-billing/cur-sample.csv");

describe("parseCostExplorerCsv against a real-CUR-shaped fixture", () => {
  it("parses every row in sample-billing/cur-sample.csv", async () => {
    const csv = await readFile(SAMPLE_CUR_PATH, "utf8");
    const records = parseCostExplorerCsv(csv);

    expect(records).toHaveLength(306);
    for (const record of records) {
      expect(record.provider).toBe("aws");
      expect(record.service).not.toBe("");
      expect(record.region).toBe("us-east-1");
      expect(Number.isNaN(record.usageAmount)).toBe(false);
      expect(record.periodStart).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    }
  });

  it("maps an EC2 line item's lineItem/* and product/* columns correctly", async () => {
    const csv = await readFile(SAMPLE_CUR_PATH, "utf8");
    const records = parseCostExplorerCsv(csv);

    const ec2Record = records.find(
      (r) => r.service === "Amazon Elastic Compute Cloud" && r.periodStart === "2026-08-01T00:00:00Z",
    );

    expect(ec2Record).toBeDefined();
    // resourceId carries the instance family/type (not the literal resource
    // ARN) so CCF-style per-family energy math can key off it directly.
    expect(ec2Record?.resourceId).toBe("m5.large");
    expect(ec2Record?.usageAmount).toBe(1);
    expect(ec2Record?.usageUnit).toBe("Hrs");
    expect(ec2Record?.costUsd).toBeCloseTo(0.096, 6);
    expect(ec2Record?.periodEnd).toBe("2026-08-01T01:00:00Z");
  });

  it("covers the full service mix (EC2, RDS, ALB, Lambda, S3)", async () => {
    const csv = await readFile(SAMPLE_CUR_PATH, "utf8");
    const records = parseCostExplorerCsv(csv);
    const services = new Set(records.map((r) => r.service));

    expect(services).toEqual(
      new Set([
        "Amazon Elastic Compute Cloud",
        "Amazon Relational Database Service",
        "Amazon Elastic Load Balancing",
        "AWS Lambda",
        "Amazon Simple Storage Service",
      ]),
    );
  });
});
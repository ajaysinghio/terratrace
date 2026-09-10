import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { TerraformHclAnalyzer } from "../TerraformHclAnalyzer.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../../../../../");

describe("TerraformHclAnalyzer against real sample-repo fixtures", () => {
  it("extracts an aws_instance resource regardless of whether any static rule would flag it", async () => {
    const filePath = resolve(repoRoot, "sample-repo/terraform/web_instance.tf");
    const sourceCode = await readFile(filePath, "utf8");
    const resources = await new TerraformHclAnalyzer().parseFile(filePath, sourceCode);

    expect(resources).toHaveLength(1);
    expect(resources[0]).toMatchObject({
      provider: "aws",
      resourceType: "aws_instance",
      resourceAddress: "aws_instance.web",
      instanceType: "m5.4xlarge",
      region: "us-east-1",
      tags: { Name: "web" },
      filePath,
    });
    expect(resources[0].startLine).toBeGreaterThan(0);
  });

  it("extracts an aws_db_instance resource with a normal-looking instance_class", async () => {
    const filePath = resolve(repoRoot, "sample-repo/terraform/orders_db.tf");
    const sourceCode = await readFile(filePath, "utf8");
    const resources = await new TerraformHclAnalyzer().parseFile(filePath, sourceCode);

    expect(resources).toHaveLength(1);
    expect(resources[0]).toMatchObject({
      resourceType: "aws_db_instance",
      resourceAddress: "aws_db_instance.orders",
      instanceType: "db.t3.medium",
      tags: { Name: "orders-db" },
    });
  });

  it("ignores non-EC2/RDS resources (e.g. aws_s3_bucket)", async () => {
    const filePath = resolve(repoRoot, "sample-repo/terraform/logs_bucket.tf");
    const sourceCode = await readFile(filePath, "utf8");
    const resources = await new TerraformHclAnalyzer().parseFile(filePath, sourceCode);

    expect(resources).toHaveLength(0);
  });
});
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { TerraformHclAnalyzer } from "../../infra/TerraformHclAnalyzer.js";
import { RightsizingFileSource } from "../../infra/RightsizingFileSource.js";
import { correlateComputeOptimizerFindings, COMPUTE_OPTIMIZER_OVERPROVISIONED_RULE_ID } from "../correlateInfra.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../../../../../");

describe("correlateComputeOptimizerFindings against real sample-repo + sample-data fixtures", () => {
  it("flags the EC2 resource (cross-generation downsize: real measurable delta)", async () => {
    const hclAnalyzer = new TerraformHclAnalyzer();
    const webPath = resolve(repoRoot, "sample-repo/terraform/web_instance.tf");
    const dbPath = resolve(repoRoot, "sample-repo/terraform/orders_db.tf");

    const resources = [
      ...(await hclAnalyzer.parseFile(webPath, await readFile(webPath, "utf8"))),
      ...(await hclAnalyzer.parseFile(dbPath, await readFile(dbPath, "utf8"))),
    ];

    const recommendations = await new RightsizingFileSource(
      resolve(repoRoot, "sample-data/compute-optimizer-sample.json"),
    ).fetchRecommendations();

    const { findings, estimates } = correlateComputeOptimizerFindings(resources, recommendations);

    // Only the EC2 resource (m5.4xlarge -> m6i.large, a cross-family/
    // cross-generation downsize) shows up. The RDS resource is also marked
    // Overprovisioned by Compute Optimizer, but its recommendation
    // (db.t3.medium -> db.t3.small) is a same-family resize — aws.ts's
    // wattage model varies by family, not by size within a family, so it
    // measures zero delta today and is correctly suppressed rather than
    // reported as a 0.0000 kgCO2e "finding" (see the guard in
    // correlateComputeOptimizerFindings). This is an honest reflection of a
    // real, pre-existing limitation in the carbon model, not a bug here.
    expect(findings).toHaveLength(1);

    const finding = findings[0];
    expect(finding.ruleId).toBe(COMPUTE_OPTIMIZER_OVERPROVISIONED_RULE_ID);
    expect(finding.filePath).toBe(webPath);
    expect(finding.message).toContain("m5.4xlarge");
    expect(finding.message).toContain("m6i.large");

    const estimate = estimates.get(finding.id);
    expect(estimate).toBeDefined();
    expect(estimate?.kgCO2e).toBeGreaterThan(0);
    expect(estimate?.confidence).toBe("high");
  });

  it("does not flag a resource with no matching recommendation", async () => {
    const hclAnalyzer = new TerraformHclAnalyzer();
    const webPath = resolve(repoRoot, "sample-repo/terraform/web_instance.tf");
    const resources = await hclAnalyzer.parseFile(webPath, await readFile(webPath, "utf8"));

    const { findings } = correlateComputeOptimizerFindings(resources, []);
    expect(findings).toHaveLength(0);
  });

  it("suppresses a same-family resize that measures zero carbon delta", async () => {
    const hclAnalyzer = new TerraformHclAnalyzer();
    const dbPath = resolve(repoRoot, "sample-repo/terraform/orders_db.tf");
    const resources = await hclAnalyzer.parseFile(dbPath, await readFile(dbPath, "utf8"));

    const recommendations = await new RightsizingFileSource(
      resolve(repoRoot, "sample-data/compute-optimizer-sample.json"),
    ).fetchRecommendations();

    const { findings } = correlateComputeOptimizerFindings(resources, recommendations);
    expect(findings).toHaveLength(0);
  });
});
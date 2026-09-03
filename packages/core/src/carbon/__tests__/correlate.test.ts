import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PythonAnalyzer } from "../../analyzer/PythonAnalyzer.js";
import { nPlusOneQuery } from "../../analyzer/rules/python/database.js";
import { parseCurCsv } from "../../billing/AWSCurSource.js";
import { correlateFindingsWithUsage, RULE_SERVICE_MAP } from "../correlate.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../../../../../");

describe("correlateFindingsWithUsage against a real-CUR-shaped fixture", () => {
  it("attaches a non-zero, medium-confidence RDS estimate to an N+1-query finding", async () => {
    const filePath = resolve(repoRoot, "sample-repo/orders/views.py");
    const source = await readFile(filePath, "utf8");
    // The default PythonAnalyzer ships no rules today (Semgrep owns
    // detection in production); pass the legacy tree-sitter rule explicitly
    // so this test stays self-contained without needing semgrep on PATH.
    const findings = await new PythonAnalyzer([nPlusOneQuery]).analyzeFile(filePath, source);
    expect(findings.length).toBeGreaterThan(0);
    expect(RULE_SERVICE_MAP[findings[0].ruleId]).toBe("AmazonRDS");

    const csv = await readFile(resolve(repoRoot, "sample-data/aws-cur-sample.csv"), "utf8");
    const usageRecords = parseCurCsv(csv);

    const estimateByFindingId = correlateFindingsWithUsage(findings, usageRecords);

    for (const finding of findings) {
      const estimate = estimateByFindingId.get(finding.id);
      expect(estimate).toBeDefined();
      expect(estimate?.kgCO2e).toBeGreaterThan(0);
      expect(estimate?.confidence).toBe("medium");
    }
  });
});
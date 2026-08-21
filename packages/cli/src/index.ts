import { readFile } from "node:fs/promises";
import fg from "fast-glob";
import {
  PythonAnalyzer,
  AnthropicProvider,
  type EnrichedFinding,
} from "@terratrace/core";

// import { AWSCurSource, estimateCarbon } from "@terratrace/core";

const DEFAULT_PATTERN = "./sample-repo/**/*.py";

async function main(): Promise<void> {
  const pattern = process.argv[2] ?? DEFAULT_PATTERN;

  const files = await fg(pattern);
  const analyzer = new PythonAnalyzer();
  const llm = new AnthropicProvider();

  const enrichedFindings: EnrichedFinding[] = [];

  for (const filePath of files) {
    const sourceCode = await readFile(filePath, "utf-8");
    const findings = await analyzer.analyzeFile(filePath, sourceCode);

    for (const finding of findings) {
      const explanation = await llm.explainFinding({ codeFinding: finding });
      enrichedFindings.push({ ...finding, explanation });
    }
  }

  console.log(JSON.stringify(enrichedFindings, null, 2));
  console.error(`terratrace: found ${enrichedFindings.length} finding(s) across ${files.length} file(s).`);

  // Example: pull real AWS usage and estimate the carbon footprint behind it.
  // Requires AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_REGION to be set.
  //
  // const billing = new AWSCurSource();
  // const usage = await billing.fetchUsage({ start: "2026-08-01", end: "2026-08-21" });
  // const carbonEstimate = estimateCarbon(usage);
  // console.error(`terratrace: estimated ${carbonEstimate.kgCO2e.toFixed(4)} kgCO2e over the period.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

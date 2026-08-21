import { readFile } from "node:fs/promises";
import path from "node:path";
import type { EnrichedFinding } from "@terratrace/core";

const SCAN_OUTPUT_PATH = path.join(process.cwd(), "..", "..", "scan-output.json");

async function loadFindings(): Promise<EnrichedFinding[] | null> {
  try {
    const raw = await readFile(SCAN_OUTPUT_PATH, "utf-8");
    return JSON.parse(raw) as EnrichedFinding[];
  } catch {
    return null;
  }
}

export default async function Page() {
  const findings = await loadFindings();

  if (findings === null) {
    return (
      <main style={{ fontFamily: "sans-serif", padding: "2rem" }}>
        <h1>TerraTrace</h1>
        <p>
          No scan results found. Run the CLI first: <code>pnpm scan &gt; scan-output.json</code>
        </p>
      </main>
    );
  }

  return (
    <main style={{ fontFamily: "sans-serif", padding: "2rem", maxWidth: 900, margin: "0 auto" }}>
      <h1>TerraTrace findings</h1>
      <p>{findings.length} finding(s)</p>
      <ul style={{ listStyle: "none", padding: 0 }}>
        {findings.map((finding) => (
          <li
            key={finding.id}
            style={{ border: "1px solid #ddd", borderRadius: 8, padding: "1rem", marginBottom: "1rem" }}
          >
            <div style={{ fontWeight: 600 }}>
              {finding.filePath}:{finding.startLine}-{finding.endLine} — {finding.ruleId} ({finding.severity})
            </div>
            <pre
              style={{
                background: "#f6f6f6",
                padding: "0.75rem",
                borderRadius: 6,
                overflowX: "auto",
                marginTop: "0.5rem",
              }}
            >
              {finding.snippet}
            </pre>
            {finding.explanation && (
              <p style={{ marginTop: "0.5rem" }}>
                <strong>Explanation:</strong> {finding.explanation}
              </p>
            )}
          </li>
        ))}
      </ul>
    </main>
  );
}

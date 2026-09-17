import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PythonAnalyzer } from "../../analyzer/PythonAnalyzer.js";
import { nPlusOneQuery } from "../../analyzer/rules/registry.js";
import { AnthropicProvider } from "../../llm/AnthropicProvider.js";
import { recommendFinding } from "../recommendFinding.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// The same planted-finding fixture CONTRIBUTING.md's Week 1 checklist
// points at for a manual PythonAnalyzer.analyzeFile sanity check — reusing
// it here turns that manual step into an automated eval.
const SAMPLE_FILE = resolve(__dirname, "../../../../../sample-repo/orders/views.py");

const hasApiKey = Boolean(process.env.ANTHROPIC_API_KEY || process.env.OPENROUTER_API_KEY);

/**
 * A real eval, not a unit test: makes an actual billed call to whichever
 * LLM is configured and checks recommendFinding's own validation (apply the
 * diff → re-analyze → the finding is gone, nothing new appeared) actually
 * passes end-to-end. Skipped rather than failing when no API key is set
 * (CI without secrets, a contributor's local run) — this should never run
 * implicitly as a side effect of `pnpm test`. Run with ANTHROPIC_API_KEY or
 * OPENROUTER_API_KEY set to catch a prompt, model-swap, or ruleSkills
 * regression before it ships, the same way changing a detection rule gets
 * caught by a normal unit test.
 */
describe.skipIf(!hasApiKey)("recommendFinding eval: sample-repo's planted findings", () => {
  it(
    "produces a validated fix for the planted N+1 query in orders/views.py",
    async () => {
      const sourceCode = await readFile(SAMPLE_FILE, "utf-8");
      // pythonRules (PythonAnalyzer's no-arg default) is empty — Semgrep
      // owns Python detection now (see registry.ts's doc comment). The
      // legacy tree-sitter n-plus-one-query rule still exists exactly for
      // this kind of offline eval/test use, passed explicitly.
      const analyzer = new PythonAnalyzer([nPlusOneQuery]);
      const findings = await analyzer.analyzeFile(SAMPLE_FILE, sourceCode);
      const target = findings.find((f) => f.ruleId === "n-plus-one-query");
      expect(target, "expected PythonAnalyzer to find a planted n-plus-one-query in orders/views.py").toBeDefined();

      const llm = new AnthropicProvider();
      const recommendation = await recommendFinding({
        finding: target!,
        sourceCode,
        analyzer,
        llm,
        evidence: { codeFinding: target! },
        maxRetries: 2,
      });

      expect(
        recommendation.validation.ok,
        `fix did not validate: ${recommendation.validation.reason} — ${recommendation.validation.detail}`,
      ).toBe(true);
      expect(recommendation.fixDiff).toContain("--- a/");
    },
    60_000,
  );
});

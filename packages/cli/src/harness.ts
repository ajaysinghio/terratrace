import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createTwoFilesPatch } from "diff";
import {
  PythonAnalyzer,
  nPlusOneQuery,
  recommendFinding,
  type CodeFinding,
  type EvidenceBundle,
  type LLMProvider,
  type Recommendation,
} from "@terratrace/core";

/**
 * Offline harness for the recommendFinding orchestrator. Runs five scenarios
 * against the planted N+1 in sample-repo/orders/views.py using a scripted
 * LLM that returns pre-baked diffs instead of calling Anthropic. Exercises:
 *
 *   1. happy path      — one valid diff, validation.ok on attempt 1
 *   2. retry path      — one bad-but-appliable diff then one good diff, ok on attempt 2
 *   3. non-appliable   — garbage output, all attempts fail with diff-did-not-apply
 *   4. finding-persists — cosmetic-only diff, all attempts fail with finding-persists
 *   5. autofix path    — finding carries a rule-provided autofix, expect ok on attempt 1
 *                        with fixSource=rule-autofix and ZERO LLM calls
 *
 * Prints per-scenario outcomes and exits non-zero if any expectation misses.
 * Cheap to run in CI once we wire one up.
 */

class ScriptedLLM implements LLMProvider {
  readonly modelId = "scripted-offline";
  private index = 0;
  generateFixCallCount = 0;
  constructor(private readonly diffs: string[]) {}
  async explainFinding(_evidence: EvidenceBundle): Promise<string> {
    return "scripted-explanation";
  }
  async generateFix(_evidence: EvidenceBundle): Promise<string> {
    this.generateFixCallCount++;
    const diff = this.diffs[this.index] ?? this.diffs[this.diffs.length - 1] ?? "";
    this.index++;
    return diff;
  }
  async answerQuery(_question: string, _grounding: EvidenceBundle[]): Promise<string> {
    return "scripted-answer";
  }
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..", "..");
const SAMPLE_REL = "sample-repo/orders/views.py";
const SAMPLE_ABS = path.join(REPO_ROOT, SAMPLE_REL);

const GOOD_FIX_SOURCE = `from django.db.models import Sum
from django.http import JsonResponse

from .models import Order


def customer_order_totals(request):
    """Return each customer's total order value in a single aggregated query."""
    totals_qs = Order.objects.values("customer_id").annotate(total=Sum("amount"))
    totals = {row["customer_id"]: row["total"] for row in totals_qs}
    return JsonResponse(totals)
`;

const COSMETIC_ONLY_SOURCE = `from django.http import JsonResponse

from .models import Customer, Order


def customer_order_totals(request):
    """Docstring rewritten but the N+1 loop below is untouched."""
    customers = Customer.objects.all()
    totals = {}

    for customer in customers:
        orders = Order.objects.filter(customer_id=customer.id)
        totals[customer.id] = sum(order.amount for order in orders)

    return JsonResponse(totals)
`;

interface Expectation {
  ok: boolean;
  attempts?: number;
  reason?: Recommendation["validation"]["reason"];
  fixSource?: Recommendation["fixSource"];
  generateFixCalls?: number;
}

interface RunScenarioOpts {
  diffs: string[];
  expect: Expectation;
  /**
   * When set, the scenario runner attaches a synthesized autofix hint to the
   * finding (offsets computed from the snippet's position in source). The
   * `replacement` is what gets pasted in place of the finding. Used to
   * exercise the deterministic path without needing a live Semgrep install.
   */
  autofixReplacement?: string;
}

async function runScenario(
  label: string,
  opts: RunScenarioOpts,
): Promise<{ ok: boolean; rec: Recommendation }> {
  const sourceCode = await readFile(SAMPLE_ABS, "utf-8");
  // Harness is offline-first; use the tree-sitter n-plus-one rule explicitly
  // so it doesn't depend on semgrep being installed. In production the
  // default pythonRules is empty (Semgrep owns N+1); passing the rule
  // directly here keeps the harness self-contained.
  const analyzer = new PythonAnalyzer([nPlusOneQuery]);
  const findings = await analyzer.analyzeFile(SAMPLE_REL, sourceCode);
  if (findings.length === 0) {
    throw new Error(`${SAMPLE_REL} produced 0 findings; the planted N+1 should have fired.`);
  }
  let finding: CodeFinding = findings[0];

  if (opts.autofixReplacement !== undefined) {
    const startOffset = sourceCode.indexOf(finding.snippet);
    if (startOffset < 0) {
      throw new Error("could not locate finding snippet in source for autofix scaffold");
    }
    finding = {
      ...finding,
      autofix: {
        source: "test-scaffold",
        replacement: opts.autofixReplacement,
        startOffset,
        endOffset: startOffset + finding.snippet.length,
      },
    };
  }

  const llm = new ScriptedLLM(opts.diffs);
  const rec = await recommendFinding({
    finding,
    sourceCode,
    analyzer,
    llm,
    evidence: { codeFinding: finding },
    maxRetries: 2,
  });

  const { expect } = opts;
  const okMatch = rec.validation.ok === expect.ok;
  const attemptsMatch = expect.attempts === undefined || rec.validation.attempts === expect.attempts;
  const reasonMatch = expect.reason === undefined || rec.validation.reason === expect.reason;
  const fixSourceMatch = expect.fixSource === undefined || rec.fixSource === expect.fixSource;
  const genCallsMatch =
    expect.generateFixCalls === undefined || llm.generateFixCallCount === expect.generateFixCalls;
  const scenarioOk = okMatch && attemptsMatch && reasonMatch && fixSourceMatch && genCallsMatch;

  const marker = scenarioOk ? "PASS" : "FAIL";
  console.log(`[${marker}] ${label}`);
  console.log(
    `        idempotencyKey=${rec.idempotencyKey} ` +
      `ok=${rec.validation.ok} attempts=${rec.validation.attempts} reason=${rec.validation.reason ?? "-"} ` +
      `fixSource=${rec.fixSource} llmCalls=${llm.generateFixCallCount}`,
  );
  if (!scenarioOk) {
    console.log(
      `        expected: ok=${expect.ok} attempts=${expect.attempts ?? "-"} reason=${expect.reason ?? "-"} ` +
        `fixSource=${expect.fixSource ?? "-"} llmCalls=${expect.generateFixCalls ?? "-"}`,
    );
    if (rec.validation.detail) console.log(`        detail:   ${rec.validation.detail}`);
  }

  return { ok: scenarioOk, rec };
}

async function main(): Promise<void> {
  const sourceCode = await readFile(SAMPLE_ABS, "utf-8");
  const goodDiff = createTwoFilesPatch(SAMPLE_REL, SAMPLE_REL, sourceCode, GOOD_FIX_SOURCE);
  const cosmeticDiff = createTwoFilesPatch(SAMPLE_REL, SAMPLE_REL, sourceCode, COSMETIC_ONLY_SOURCE);
  const gibberishDiff = "not a real unified diff\njust some words\n";

  console.log("TerraTrace recommendFinding — offline harness");
  console.log("=".repeat(72));

  const results = [
    await runScenario("1. happy path: one good diff, expect ok on attempt 1", {
      diffs: [goodDiff],
      expect: { ok: true, attempts: 1, fixSource: "llm", generateFixCalls: 1 },
    }),
    await runScenario("2. retry path: cosmetic diff then good diff, expect ok on attempt 2", {
      diffs: [cosmeticDiff, goodDiff],
      expect: { ok: true, attempts: 2, fixSource: "llm", generateFixCalls: 2 },
    }),
    await runScenario("3. non-appliable: gibberish only, expect diff-did-not-apply after 3 attempts", {
      diffs: [gibberishDiff],
      expect: {
        ok: false,
        attempts: 3,
        reason: "diff-did-not-apply",
        fixSource: "llm",
        generateFixCalls: 3,
      },
    }),
    await runScenario(
      "4. finding-persists: cosmetic diff only, expect finding-persists after 3 attempts",
      {
        diffs: [cosmeticDiff],
        expect: {
          ok: false,
          attempts: 3,
          reason: "finding-persists",
          fixSource: "llm",
          generateFixCalls: 3,
        },
      },
    ),
    await runScenario(
      "5. autofix path: finding has rule-provided autofix, expect ok on attempt 1 with 0 LLM calls",
      {
        // Replace the entire for-loop with `totals = {}` — syntactically valid
        // Python that no longer contains a `for` + `.filter(` pattern, so the
        // tree-sitter N+1 rule stops firing after re-analysis.
        autofixReplacement: "totals = {}",
        diffs: [goodDiff], // never consumed
        expect: {
          ok: true,
          attempts: 1,
          fixSource: "rule-autofix",
          generateFixCalls: 0,
        },
      },
    ),
  ];

  console.log("=".repeat(72));
  const allOk = results.every((r) => r.ok);
  if (allOk) {
    console.log(`PASS: all ${results.length} scenarios matched expectations.`);
    process.exitCode = 0;
  } else {
    const failed = results.filter((r) => !r.ok).length;
    console.log(`FAIL: ${failed} of ${results.length} scenario(s) missed expectations.`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

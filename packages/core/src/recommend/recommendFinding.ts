import { createHash } from "node:crypto";
import { applyPatch, createTwoFilesPatch } from "diff";
import type { CodeAnalyzer } from "../analyzer/CodeAnalyzer.js";
import type { LLMProvider } from "../llm/LLMProvider.js";
import type {
  CodeFinding,
  EvidenceBundle,
  Recommendation,
  ValidationFailureReason,
  ValidationResult,
} from "../types.js";

export interface RecommendFindingArgs {
  finding: CodeFinding;
  sourceCode: string;
  analyzer: CodeAnalyzer;
  llm: LLMProvider;
  evidence: EvidenceBundle;
  /** Extra attempts allowed after the first one. Total attempts = 1 + maxRetries. Defaults to 2. */
  maxRetries?: number;
}

/**
 * Deterministic identifier for a finding-that-still-exists. Hashing the
 * ruleId + filePath + snippet (rather than line numbers) means unrelated
 * edits above the finding don't rotate the key, but a real fix to the
 * offending code does — which is exactly when we want an existing "fix PR"
 * to be considered stale and superseded.
 */
export function computeIdempotencyKey(finding: CodeFinding): string {
  return findingStructuralKey(finding).slice(0, 12);
}

/**
 * Full-length structural key over ruleId + filePath + snippet. Used
 * internally to compare findings across scans without relying on
 * `finding.id`, which today is a fresh randomUUID per analyze call and so
 * can never match between a baseline scan and a post-patch re-scan.
 *
 * filePath is normalized before hashing: leading `./` stripped, backslash
 * separators mapped to forward slashes. Necessary because the CLI's glob
 * ("./sample-repo/**\/*.py") and the Action's glob ("**\/*.py") produce
 * paths with and without the `./` prefix — same finding, different string
 * → different hash → dashboard "View PR" links point at labels that don't
 * exist on any real PR.
 */
function findingStructuralKey(finding: CodeFinding): string {
  const normalizedPath = finding.filePath.replace(/\\/g, "/").replace(/^\.\//, "");
  return createHash("sha256")
    .update(`${finding.ruleId}\0${normalizedPath}\0${finding.snippet}`)
    .digest("hex");
}

interface AttemptOutcome {
  diff: string;
  validation: Omit<ValidationResult, "attempts">;
}

/**
 * Most LLMs ignore "do not include markdown code fences" ~30% of the time
 * and wrap unified diffs in ```diff … ``` or plain ``` … ```. jsdiff's
 * applyPatch then chokes on the fence lines even though the hunks
 * themselves are valid. Strip a single outer fence if present so the LLM's
 * disobedience doesn't cost us the whole retry budget.
 */
function stripMarkdownFences(raw: string): string {
  const trimmed = raw.trim();
  const fenceMatch = trimmed.match(/^```(?:diff|patch)?\s*\n([\s\S]*?)\n```\s*$/);
  return fenceMatch ? fenceMatch[1] : raw;
}

async function attemptFix(
  args: RecommendFindingArgs,
  baselineKeys: Set<string>,
  targetKey: string,
  evidence: EvidenceBundle,
): Promise<AttemptOutcome> {
  const { finding, sourceCode, analyzer, llm } = args;
  const raw = await llm.generateFix(evidence);
  const diff = stripMarkdownFences(raw);

  // jsdiff's applyPatch is lenient: input without any @@ hunk markers is
  // returned unchanged instead of rejected, which would silently look like
  // "finding-persists" downstream. Reject clearly no-hunk output up front
  // so the retry feedback tells the LLM to actually emit a diff.
  if (diff.trim() === "" || !diff.includes("@@")) {
    return {
      diff,
      validation: {
        ok: false,
        reason: "diff-did-not-apply",
        detail: "Output contained no unified-diff hunks (missing '@@' markers).",
      },
    };
  }

  const patched = applyPatch(sourceCode, diff);
  if (patched === false || typeof patched !== "string") {
    return {
      diff,
      validation: {
        ok: false,
        reason: "diff-did-not-apply",
        detail: "diff.applyPatch returned false; diff hunks did not match the source.",
      },
    };
  }
  if (patched === sourceCode) {
    return {
      diff,
      validation: {
        ok: false,
        reason: "diff-did-not-apply",
        detail: "Diff applied cleanly but produced no changes; the fix was a no-op.",
      },
    };
  }

  const postFindings = await analyzer.analyzeFile(finding.filePath, patched);
  const postKeys = postFindings.map(findingStructuralKey);

  if (postKeys.some((k) => k === targetKey)) {
    return {
      diff,
      validation: {
        ok: false,
        reason: "finding-persists",
        detail: `Rule ${finding.ruleId} still fires at ${finding.filePath}:${finding.startLine} after applying the diff.`,
      },
    };
  }

  const newFindings = postFindings.filter((_, i) => !baselineKeys.has(postKeys[i]));
  if (newFindings.length > 0) {
    const summary = newFindings
      .map((f) => `${f.ruleId} at ${f.filePath}:${f.startLine}`)
      .join(", ");
    return {
      diff,
      validation: {
        ok: false,
        reason: "new-findings-appeared",
        detail: `Patch introduced ${newFindings.length} new finding(s): ${summary}.`,
      },
    };
  }

  return { diff, validation: { ok: true } };
}

/**
 * Given a single CodeFinding and an evidence bundle for it, ask the LLM for
 * a fix diff and validate it in-memory (apply → re-analyze) before returning.
 * On validation failure the failure reason is fed back into the next
 * attempt's evidence bundle as priorAttemptFailure, so the LLM can course
 * correct. Bounded by maxRetries (default 2, i.e. up to 3 total attempts).
 *
 * The returned Recommendation always carries the *last* attempt's diff and
 * validation result — check `validation.ok` before acting on it.
 */
export async function recommendFinding(args: RecommendFindingArgs): Promise<Recommendation> {
  const { finding, sourceCode, analyzer, maxRetries = 2 } = args;
  // Ground the LLM in the actual file bytes. Without this the model only
  // sees the finding's snippet (a few lines) and hallucinates surrounding
  // code that doesn't exist — its diffs then fail applyPatch because the
  // context lines don't match. Callers can still override by pre-populating
  // codeFileSource in their evidence.
  const evidence: EvidenceBundle = {
    ...args.evidence,
    codeFileSource: args.evidence.codeFileSource ?? sourceCode,
  };

  const baseline = await analyzer.analyzeFile(finding.filePath, sourceCode);
  const baselineKeys = new Set(baseline.map(findingStructuralKey));
  const targetKey = findingStructuralKey(finding);

  let autofixFailure: EvidenceBundle["priorAttemptFailure"] | undefined;

  // Deterministic path: if the detection rule shipped a mechanical fix
  // (Semgrep `fix:` etc.), apply it directly. If validation passes we skip
  // the LLM entirely — cheaper, faster, byte-for-byte reproducible. If it
  // fails, transparently fall through to the LLM loop so a broken rule
  // template doesn't block us from opening a fix.
  if (finding.autofix) {
    const autofix = tryAutofix(finding, sourceCode);
    if (autofix.validation.ok) {
      const postFindings = await analyzer.analyzeFile(finding.filePath, autofix.patched);
      const postKeys = postFindings.map(findingStructuralKey);
      const revalidated = revalidatePatched(postKeys, baselineKeys, targetKey, finding);
      if (revalidated.ok) {
        return {
          idempotencyKey: computeIdempotencyKey(finding),
          finding,
          fixDiff: autofix.diff,
          validation: { ok: true, attempts: 1 },
          fixSource: "rule-autofix",
        };
      }
      autofixFailure = {
        reason: revalidated.reason as ValidationFailureReason,
        detail: `Rule-provided autofix from '${finding.autofix.source}' applied but ${revalidated.detail}`,
        previousDiff: autofix.diff,
      };
    }
  }

  let attempts = 0;
  let lastDiff = "";
  let lastValidation: Omit<ValidationResult, "attempts"> = {
    ok: false,
    reason: "diff-did-not-apply",
    detail: "no attempt was made",
  };
  let priorFailure: EvidenceBundle["priorAttemptFailure"] | undefined = autofixFailure;

  const totalAttempts = 1 + Math.max(0, maxRetries);
  for (let i = 0; i < totalAttempts; i++) {
    attempts++;
    const evidenceForAttempt: EvidenceBundle = priorFailure
      ? { ...evidence, priorAttemptFailure: priorFailure }
      : evidence;

    const outcome = await attemptFix(args, baselineKeys, targetKey, evidenceForAttempt);
    lastDiff = outcome.diff;
    lastValidation = outcome.validation;

    if (outcome.validation.ok) break;

    priorFailure = {
      reason: outcome.validation.reason as ValidationFailureReason,
      detail: outcome.validation.detail,
      previousDiff: outcome.diff,
    };
  }

  return {
    idempotencyKey: computeIdempotencyKey(finding),
    finding,
    fixDiff: lastDiff,
    validation: { ...lastValidation, attempts },
    fixSource: "llm",
  };
}

interface AutofixResult {
  diff: string;
  patched: string;
  validation: { ok: boolean; reason?: ValidationFailureReason; detail?: string };
}

function tryAutofix(finding: CodeFinding, sourceCode: string): AutofixResult {
  const fix = finding.autofix;
  if (!fix) {
    return {
      diff: "",
      patched: sourceCode,
      validation: { ok: false, reason: "diff-did-not-apply", detail: "no autofix on finding" },
    };
  }
  const { startOffset, endOffset, replacement } = fix;
  if (
    startOffset < 0 ||
    endOffset > sourceCode.length ||
    startOffset > endOffset
  ) {
    return {
      diff: "",
      patched: sourceCode,
      validation: {
        ok: false,
        reason: "diff-did-not-apply",
        detail: `autofix offsets out of range: [${startOffset}, ${endOffset}] of ${sourceCode.length}`,
      },
    };
  }
  const patched = sourceCode.slice(0, startOffset) + replacement + sourceCode.slice(endOffset);
  if (patched === sourceCode) {
    return {
      diff: "",
      patched,
      validation: {
        ok: false,
        reason: "diff-did-not-apply",
        detail: "autofix produced no change",
      },
    };
  }
  const diff = createTwoFilesPatch(finding.filePath, finding.filePath, sourceCode, patched);
  return { diff, patched, validation: { ok: true } };
}

function revalidatePatched(
  postKeys: string[],
  baselineKeys: Set<string>,
  targetKey: string,
  finding: CodeFinding,
): { ok: boolean; reason?: ValidationFailureReason; detail?: string } {
  if (postKeys.some((k) => k === targetKey)) {
    return {
      ok: false,
      reason: "finding-persists",
      detail: `did not clear rule ${finding.ruleId} at ${finding.filePath}:${finding.startLine}`,
    };
  }
  const newCount = postKeys.filter((k) => !baselineKeys.has(k)).length;
  if (newCount > 0) {
    return {
      ok: false,
      reason: "new-findings-appeared",
      detail: `introduced ${newCount} new finding(s) after applying`,
    };
  }
  return { ok: true };
}

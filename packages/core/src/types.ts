/**
 * Shared domain types used across every TerraTrace package. These are the
 * currency that flows between the billing, analyzer, carbon-math, and LLM
 * layers — nothing downstream should need to know which cloud, language, or
 * model produced them.
 */

export type CloudProvider = "aws" | "gcp" | "azure" | "onprem";

/** A normalized billing line item, regardless of which cloud it came from. */
export interface UsageRecord {
  provider: CloudProvider;
  service: string;
  region: string;
  resourceId?: string;
  usageAmount: number;
  usageUnit: string;
  costUsd: number;
  /** ISO 8601 date */
  periodStart: string;
  /** ISO 8601 date */
  periodEnd: string;
}

export interface CarbonEstimate {
  kgCO2e: number;
  methodology: "sci" | "ccf-derived";
  gridIntensityGco2PerKwh: number;
  confidence: "low" | "medium" | "high";
  /** Sum of the billing usage records' costUsd this estimate was derived from. */
  costUsd: number;
}

export type Severity = "low" | "medium" | "high";

export interface CodeFinding {
  id: string;
  ruleId: string;
  severity: Severity;
  filePath: string;
  startLine: number;
  endLine: number;
  snippet: string;
  message: string;
  /**
   * Populated by analyzers whose rules ship a deterministic mechanical fix
   * (Semgrep's `fix:` clause, ESLint autofix, Ruff autofix, ...). When
   * present, `recommendFinding` prefers this over asking the LLM — cheaper,
   * faster, and byte-for-byte reproducible. Offsets are byte offsets into
   * the original source; `replacement` is the text that goes in place.
   */
  autofix?: {
    source: string;
    replacement: string;
    startOffset: number;
    endOffset: number;
  };
}

/**
 * Everything an LLM call needs to reason about a finding without inventing
 * facts: the code, the billing it correlates with, the derived carbon
 * estimate, any relevant infra config, and git/PR context. Every
 * LLMProvider method takes one of these (or an array of them) instead of a
 * bare string prompt — that's what forces cross-signal reasoning instead of
 * chatbot-style guessing.
 */
export interface EvidenceBundle {
  codeFinding?: CodeFinding;
  /**
   * Full source of the file the finding belongs to, verbatim. Passed to the
   * LLM alongside the finding so it authors diffs against real bytes rather
   * than hallucinating context lines. `recommendFinding` injects this from
   * its `sourceCode` arg automatically if the caller hasn't populated it.
   */
  codeFileSource?: string;
  relatedUsage?: UsageRecord[];
  carbonEstimate?: CarbonEstimate;
  infraConfigSnippet?: string;
  gitContext?: {
    commitSha?: string;
    prNumber?: number;
    diffSnippet?: string;
  };
  /**
   * Populated by recommendFinding on retry attempts so the LLM can see why
   * its previous diff was rejected (didn't apply, didn't clear the finding,
   * or introduced a new one) and correct course.
   */
  priorAttemptFailure?: {
    reason: ValidationFailureReason;
    detail?: string;
    previousDiff?: string;
  };
}

export interface EnrichedFinding extends CodeFinding {
  estimate?: CarbonEstimate;
  explanation?: string;
  suggestedFixDiff?: string;
  /**
   * Same deterministic hash the GitHub Action uses as its PR/Issue label
   * (`terratrace:<idempotencyKey>`). Populated by the CLI at write time so
   * the dashboard can link each finding to its PR/Issue without a live
   * GitHub API call.
   */
  idempotencyKey?: string;
}

/** A cloud resource declared in infrastructure-as-code, before it's ever been billed. */
export interface InfraResource {
  provider: CloudProvider;
  /** e.g. "aws_instance", "aws_db_instance" — the IaC tool's own resource type name. */
  resourceType: string;
  /** e.g. "aws_instance.web" — "<resourceType>.<name>", Terraform's own addressing scheme. */
  resourceAddress: string;
  /** e.g. "r5.2xlarge", "db.m5.4xlarge" — read verbatim from the declared config. */
  instanceType: string;
  region: string;
  /**
   * Declared tags. The only way to correlate a statically-declared resource
   * with a live recommendation for it (Compute Optimizer keys recommendations
   * by AWS resource ARN, which doesn't exist until after `terraform apply`
   * and isn't derivable from a .tf file alone without also reading
   * terraform.tfstate) — matching on a shared tag value is the honest
   * fallback used here instead.
   */
  tags?: Record<string, string>;
  filePath: string;
  startLine: number;
  endLine: number;
}

/** AWS Compute Optimizer's own finding classification, verbatim. */
export type RightsizingFinding = "Optimized" | "NotOptimized" | "Overprovisioned" | "Underprovisioned";

/** A normalized rightsizing recommendation, regardless of which cloud/resource-type API produced it. */
export interface RightsizingRecommendation {
  resourceArn: string;
  currentInstanceType: string;
  recommendedInstanceType: string;
  finding: RightsizingFinding;
  tags?: Record<string, string>;
}

export type ValidationFailureReason =
  | "diff-did-not-apply"
  | "finding-persists"
  | "new-findings-appeared";

export interface ValidationResult {
  ok: boolean;
  attempts: number;
  reason?: ValidationFailureReason;
  detail?: string;
}

/**
 * A finding packaged with an LLM-generated fix that has been validated
 * end-to-end: the diff applies cleanly to the source, and re-running the
 * analyzer on the patched source shows the finding is gone and no new
 * findings appeared. Consumers (GitHub Action, CLI, dashboard) can trust
 * validated recommendations enough to raise a PR from them.
 *
 * The idempotencyKey is a stable hash over (ruleId, filePath, snippet) so
 * repeated scans of the same unresolved finding produce the same key —
 * callers use it as a branch name / PR label to avoid opening duplicate PRs.
 */
export interface Recommendation {
  idempotencyKey: string;
  finding: CodeFinding;
  explanation?: string;
  fixDiff: string;
  validation: ValidationResult;
  /**
   * Which path produced the fix. "rule-autofix" means the detection rule
   * carried a deterministic replacement (Semgrep `fix:`, etc.) and the LLM
   * was never called for this finding. "llm" means the fix came from the
   * usual generateFix + retry loop.
   */
  fixSource: "llm" | "rule-autofix";
}

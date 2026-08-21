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
  relatedUsage?: UsageRecord[];
  carbonEstimate?: CarbonEstimate;
  infraConfigSnippet?: string;
  gitContext?: {
    commitSha?: string;
    prNumber?: number;
    diffSnippet?: string;
  };
}

export interface EnrichedFinding extends CodeFinding {
  estimate?: CarbonEstimate;
  explanation?: string;
  suggestedFixDiff?: string;
}

import type { EvidenceBundle } from "../types.js";

/**
 * Interface for any LLM backend. Every method takes structured evidence
 * (code + billing + infra + git context) rather than a bare string — this
 * is deliberate: TerraTrace's differentiator is reasoning across multiple
 * evidence sources at once, never a plain chatbot wrapper. Swapping models
 * or adding a second provider (OpenAI, a local model, etc.) means writing
 * one new implementation of this interface.
 */
export interface LLMProvider {
  readonly modelId: string;
  /** Explain the causal link between a code finding and its observed cost/carbon impact. */
  explainFinding(evidence: EvidenceBundle): Promise<string>;
  /** Generate a minimal unified diff that fixes the specific inefficiency. */
  generateFix(evidence: EvidenceBundle): Promise<string>;
  /** Answer a free-form question grounded strictly in the given findings. */
  answerQuery(question: string, grounding: EvidenceBundle[]): Promise<string>;
}

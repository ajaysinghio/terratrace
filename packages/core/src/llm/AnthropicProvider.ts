import { generateText, type LanguageModel } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import type { LLMProvider } from "./LLMProvider.js";
import type { EvidenceBundle } from "../types.js";

const DEFAULT_MODEL_ID = "claude-sonnet-4-6";
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const OPENROUTER_DEFAULT_MODEL_ID = "anthropic/claude-sonnet-4.6";

const EXPLAIN_SYSTEM_PROMPT = `You are a sustainability and cost engineer. You will be given a JSON evidence
bundle containing a code finding, related cloud billing usage records, a derived carbon estimate, optional
infrastructure config, and git context. In 2-3 sentences, explain the causal link between the code pattern
and the observed cost/carbon impact. Use ONLY numbers that are present in the evidence bundle — never invent,
estimate, or round figures that are not already there. If the evidence bundle lacks billing or carbon data,
say so explicitly rather than guessing at magnitude.`;

const FIX_SYSTEM_PROMPT = `You are a senior software engineer. You will be given a JSON evidence bundle
containing a code finding (including its file path, line range, and snippet) and surrounding context. Output
ONLY a minimal unified diff that fixes the specific inefficiency described in the finding. Match the
codebase's existing style, language idioms, and framework (e.g. Django ORM conventions if the snippet uses
Django). Do not include any commentary, explanation, or markdown code fences — output the raw diff only.`;

const ANSWER_SYSTEM_PROMPT = `You are a sustainability and cost engineer answering questions about a
codebase scan. You will be given a question and a JSON array of evidence bundles (findings + billing +
carbon data). Answer strictly using information contained in that array. If the answer is not contained in
the provided evidence, say so explicitly instead of guessing or using outside knowledge.`;

/**
 * LLMProvider implementation on top of the Vercel AI SDK, defaulting to
 * Anthropic Claude. Swapping models is a one-line change (the modelId
 * passed to createAnthropic(...)); adding a second vendor entirely means
 * writing a sibling class that implements the same LLMProvider interface.
 */
export class AnthropicProvider implements LLMProvider {
  readonly modelId: string;
  private readonly model: LanguageModel;

  constructor(modelId?: string, apiKey?: string) {
    const openrouterKey = apiKey ?? process.env.OPENROUTER_API_KEY;
    if (openrouterKey && !process.env.ANTHROPIC_API_KEY) {
      this.modelId = modelId ?? OPENROUTER_DEFAULT_MODEL_ID;
      const openrouter = createOpenAI({ apiKey: openrouterKey, baseURL: OPENROUTER_BASE_URL });
      this.model = openrouter(this.modelId);
    } else {
      this.modelId = modelId ?? DEFAULT_MODEL_ID;
      const anthropic = createAnthropic({ apiKey: apiKey ?? process.env.ANTHROPIC_API_KEY });
      this.model = anthropic(this.modelId);
    }
  }

  async explainFinding(evidence: EvidenceBundle): Promise<string> {
    const { text } = await generateText({
      model: this.model,
      system: EXPLAIN_SYSTEM_PROMPT,
      prompt: JSON.stringify(evidence),
    });
    return text;
  }

  async generateFix(evidence: EvidenceBundle): Promise<string> {
    const { text } = await generateText({
      model: this.model,
      system: FIX_SYSTEM_PROMPT,
      prompt: JSON.stringify(evidence),
    });
    return text;
  }

  async answerQuery(question: string, grounding: EvidenceBundle[]): Promise<string> {
    const { text } = await generateText({
      model: this.model,
      system: ANSWER_SYSTEM_PROMPT,
      prompt: JSON.stringify({ question, evidence: grounding }),
    });
    return text;
  }
}

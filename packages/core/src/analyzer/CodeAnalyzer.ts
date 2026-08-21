import type { CodeFinding } from "../types.js";

/**
 * Interface for scanning one language. Adding a new language means writing
 * one new implementation (e.g. a JavaScriptAnalyzer backed by
 * tree-sitter-javascript) plus its own rule set — the CLI, GitHub Action,
 * and dashboard never need to change.
 */
export interface CodeAnalyzer {
  readonly language: string;
  analyzeFile(filePath: string, sourceCode: string): Promise<CodeFinding[]>;
}

/**
 * A single detection heuristic. Rules operate on a parsed tree-sitter tree
 * and the raw source, and are intentionally pluggable — a language's rule
 * list lives in that language's `rules/registry.ts`, not hardcoded into the
 * analyzer itself.
 */
export interface DetectionRule {
  id: string;
  description: string;
  severity: "low" | "medium" | "high";
  detect(args: { filePath: string; sourceCode: string; tree: unknown }): CodeFinding[];
}

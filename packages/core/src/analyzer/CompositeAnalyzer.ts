import type { CodeAnalyzer } from "./CodeAnalyzer.js";
import type { CodeFinding } from "../types.js";

/**
 * A CodeAnalyzer that runs an ordered list of child analyzers against the
 * same file and concatenates their findings. This is how Semgrep (the
 * declarative rule shelf) and PythonAnalyzer (hand-authored tree-sitter
 * rules for detections Semgrep can't express) coexist behind a single
 * `CodeAnalyzer` seam — every downstream consumer (`recommendFinding`, the
 * CLI, the GitHub Action, the dashboard) treats a composite exactly like a
 * single-engine analyzer.
 *
 * No dedup today: two engines catching the same rule at the same location
 * will produce two findings. That's usually fine (different structural keys
 * because the ruleIds differ). If we ever ship two rules with the same id
 * from two engines, add a dedup pass here.
 */
export class CompositeAnalyzer implements CodeAnalyzer {
  readonly language: string;
  private readonly analyzers: CodeAnalyzer[];

  constructor(analyzers: CodeAnalyzer[], language?: string) {
    if (analyzers.length === 0) {
      throw new Error("CompositeAnalyzer requires at least one child analyzer.");
    }
    this.analyzers = analyzers;
    this.language = language ?? analyzers.map((a) => a.language).join("+");
  }

  async analyzeFile(filePath: string, sourceCode: string): Promise<CodeFinding[]> {
    const perAnalyzer = await Promise.all(
      this.analyzers.map((a) => a.analyzeFile(filePath, sourceCode)),
    );
    return perAnalyzer.flat();
  }
}

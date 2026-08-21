import Parser from "tree-sitter";
// tree-sitter-python ships no first-party type declarations; the default
// export is a Language object accepted by Parser#setLanguage.
// eslint-disable-next-line @typescript-eslint/no-var-requires
import Python from "tree-sitter-python";
import type { CodeAnalyzer, DetectionRule } from "./CodeAnalyzer.js";
import type { CodeFinding } from "../types.js";
import { pythonRules } from "./rules/registry.js";

/**
 * CodeAnalyzer implementation for Python, backed by tree-sitter. Parses
 * each file once and runs every rule in `rules` against the resulting tree.
 */
export class PythonAnalyzer implements CodeAnalyzer {
  readonly language = "python";
  private readonly parser: Parser;
  private readonly rules: DetectionRule[];

  constructor(rules: DetectionRule[] = pythonRules) {
    this.parser = new Parser();
    this.parser.setLanguage(Python as unknown as Parser.Language);
    this.rules = rules;
  }

  async analyzeFile(filePath: string, sourceCode: string): Promise<CodeFinding[]> {
    const tree = this.parser.parse(sourceCode);
    const findings: CodeFinding[] = [];

    for (const rule of this.rules) {
      findings.push(...rule.detect({ filePath, sourceCode, tree }));
    }

    return findings;
  }
}

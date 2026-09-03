import type ParserType from "tree-sitter";
import type { CodeAnalyzer, DetectionRule } from "./CodeAnalyzer.js";
import type { CodeFinding } from "../types.js";
import { pythonRules } from "./rules/registry.js";

/**
 * CodeAnalyzer implementation for Python, backed by tree-sitter. Parses
 * each file once and runs every rule in `rules` against the resulting tree.
 *
 * tree-sitter and tree-sitter-python are loaded lazily on first
 * `analyzeFile` call so the ncc'd GitHub Action bundle can import this
 * module (via the core barrel export) without eagerly loading the native
 * .node files — those are platform-specific and won't match the CI runner
 * when built on a developer's macOS machine. Consumers that never call
 * `analyzeFile` (like the Action, which now delegates rules to Semgrep)
 * therefore never trigger the mismatched native load.
 */
export class PythonAnalyzer implements CodeAnalyzer {
  readonly language = "python";
  private readonly rules: DetectionRule[];
  private parserPromise?: Promise<ParserType>;

  constructor(rules: DetectionRule[] = pythonRules) {
    this.rules = rules;
  }

  private ensureParser(): Promise<ParserType> {
    if (!this.parserPromise) {
      this.parserPromise = (async () => {
        const [{ default: Parser }, { default: Python }] = await Promise.all([
          import("tree-sitter"),
          // tree-sitter-python ships no first-party type declarations; the
          // default export is a Language object accepted by Parser#setLanguage.
          import("tree-sitter-python"),
        ]);
        const parser = new Parser();
        parser.setLanguage(Python as unknown as ParserType.Language);
        return parser;
      })();
    }
    return this.parserPromise;
  }

  async analyzeFile(filePath: string, sourceCode: string): Promise<CodeFinding[]> {
    const parser = await this.ensureParser();
    const tree = parser.parse(sourceCode);
    const findings: CodeFinding[] = [];

    for (const rule of this.rules) {
      findings.push(...rule.detect({ filePath, sourceCode, tree }));
    }

    return findings;
  }
}

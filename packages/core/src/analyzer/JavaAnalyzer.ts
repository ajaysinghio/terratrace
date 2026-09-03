import path from "node:path";
import { fileURLToPath } from "node:url";
import type { CodeAnalyzer } from "./CodeAnalyzer.js";
import type { CodeFinding } from "../types.js";
import { SemgrepAnalyzer } from "./SemgrepAnalyzer.js";

/**
 * CodeAnalyzer implementation for Java. Unlike PythonAnalyzer there is no
 * tree-sitter-java grammar wired up yet, so this is a thin named wrapper
 * around SemgrepAnalyzer's `language: "java"` mode, pointed at the bundled
 * `rules-semgrep/java` pack. Giving Java its own class (rather than callers
 * instantiating `new SemgrepAnalyzer({ language: "java" })` inline) keeps the
 * per-language entry point discoverable the same way `PythonAnalyzer` is, and
 * leaves room to add hand-authored tree-sitter-java rules later (a
 * `CompositeAnalyzer` of this class + a future tree-sitter rule set, exactly
 * like Python does today) without changing any caller.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_JAVA_RULES_DIR = path.resolve(HERE, "..", "..", "rules-semgrep", "java");

export interface JavaAnalyzerOptions {
  /** Directory holding the Java YAML rule pack. Defaults to the pack bundled with @terratrace/core. */
  rulesDir?: string;
  /** Override the semgrep executable name/path. Defaults to "semgrep" on PATH. */
  semgrepBin?: string;
}

export class JavaAnalyzer implements CodeAnalyzer {
  readonly language = "java";
  private readonly semgrep: SemgrepAnalyzer;

  constructor(options: JavaAnalyzerOptions = {}) {
    this.semgrep = new SemgrepAnalyzer({
      language: "java",
      rulesDir: options.rulesDir ?? DEFAULT_JAVA_RULES_DIR,
      semgrepBin: options.semgrepBin,
    });
  }

  async analyzeFile(filePath: string, sourceCode: string): Promise<CodeFinding[]> {
    return this.semgrep.analyzeFile(filePath, sourceCode);
  }
}

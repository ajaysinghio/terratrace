import path from "node:path";
import type { CodeAnalyzer } from "./CodeAnalyzer.js";
import type { CodeFinding } from "../types.js";

/**
 * A CodeAnalyzer that dispatches each file to the single child analyzer
 * registered for that file's extension, instead of running every child
 * against every file the way CompositeAnalyzer does. Use this to combine
 * *different languages* behind one CodeAnalyzer (e.g. Python + Java); use
 * CompositeAnalyzer to combine multiple engines for the *same* language
 * (e.g. Semgrep + PythonAnalyzer).
 *
 * A file whose extension has no registered analyzer produces zero findings
 * rather than throwing — callers typically build their file glob from the
 * same extensions passed in here, so this only matters for stray files that
 * slipped through the glob.
 */
export class MultiLanguageAnalyzer implements CodeAnalyzer {
  readonly language: string;
  private readonly byExtension: Map<string, CodeAnalyzer>;

  constructor(entries: Array<{ extensions: string[]; analyzer: CodeAnalyzer }>) {
    if (entries.length === 0) {
      throw new Error("MultiLanguageAnalyzer requires at least one language entry.");
    }
    this.byExtension = new Map();
    for (const { extensions, analyzer } of entries) {
      for (const ext of extensions) {
        this.byExtension.set(ext, analyzer);
      }
    }
    this.language = entries.map(({ analyzer }) => analyzer.language).join("+");
  }

  async analyzeFile(filePath: string, sourceCode: string): Promise<CodeFinding[]> {
    const analyzer = this.byExtension.get(path.extname(filePath));
    if (!analyzer) return [];
    return analyzer.analyzeFile(filePath, sourceCode);
  }
}

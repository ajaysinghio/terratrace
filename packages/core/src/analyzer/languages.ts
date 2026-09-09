/**
 * Single source of truth for which languages TerraTrace scans and which file
 * extensions/glob each one owns. `cli` and `github-action` both need this
 * (to build their file glob and to pick the right CodeAnalyzer per file) —
 * defining it once here keeps that mapping from drifting between packages,
 * per the "don't hardcode a language outside its own concern" rule.
 *
 * Adding a language means adding one entry here plus a CodeAnalyzer
 * implementation (see PythonAnalyzer.ts / JavaAnalyzer.ts) — no changes
 * needed to this file's shape.
 */
export interface SupportedLanguage {
  id: string;
  extensions: string[];
  /** fast-glob pattern matching this language's source files. */
  glob: string;
}

export const SUPPORTED_LANGUAGES: SupportedLanguage[] = [
  { id: "python", extensions: [".py"], glob: "**/*.py" },
  { id: "java", extensions: [".java"], glob: "**/*.java" },
  { id: "terraform", extensions: [".tf"], glob: "**/*.tf" },
];

/** fast-glob patterns for every supported language, for a repo-wide scan. */
export function scanGlobs(languages: SupportedLanguage[] = SUPPORTED_LANGUAGES): string[] {
  return languages.map((language) => language.glob);
}

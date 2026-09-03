import type { DetectionRule } from "../CodeAnalyzer.js";

/**
 * Default rule shelf applied by PythonAnalyzer when constructed without an
 * explicit rules array. Deliberately empty today because Semgrep owns every
 * pattern we currently detect (see rules-semgrep/python/*.yaml); the
 * PythonAnalyzer + tree-sitter path exists for rules Semgrep's pattern
 * language can't express (control flow, cross-function reasoning, etc.).
 *
 * When you author such a rule, add it to a category file under
 * ./python/<category>.ts and re-export the category array here — the
 * grouping is the same one Semgrep uses, so a reader can find the shelf
 * for a concern regardless of which engine owns each rule.
 *
 * The legacy tree-sitter n-plus-one-query rule stays available for tests
 * and the offline harness via `pythonDatabaseRules` and `nPlusOneQuery`
 * from ./python/database.js — pass it explicitly to
 * `new PythonAnalyzer([nPlusOneQuery])` when needed.
 */
export const pythonRules: DetectionRule[] = [];

export { pythonDatabaseRules, nPlusOneQuery } from "./python/database.js";

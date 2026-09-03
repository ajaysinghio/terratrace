import { randomUUID } from "node:crypto";
import type { DetectionRule } from "../../CodeAnalyzer.js";
import type { CodeFinding } from "../../../types.js";

/**
 * Database-adjacent detection rules for Python. Each rule stays a small
 * `DetectionRule` object; grouping them here (rather than one file per rule)
 * keeps the rule shelf browsable as it grows. Related rules can share helpers
 * within this file — the shared tree-sitter walker below is the current
 * example. New database rules (missing-index, unbatched-insert, select-*)
 * should land in this file too; only cross a file boundary when a rule needs
 * a substantially different traversal.
 */

interface TreeSitterNode {
  type: string;
  text: string;
  startPosition: { row: number };
  endPosition: { row: number };
  children: TreeSitterNode[];
}

interface TreeSitterTree {
  rootNode: TreeSitterNode;
}

function walk(node: TreeSitterNode, visit: (node: TreeSitterNode) => void): void {
  visit(node);
  for (const child of node.children) {
    walk(child, visit);
  }
}

// NOTE: this is a starting heuristic, not a precise per-ORM detector. It
// flags any `for` loop whose body text contains a call that *looks* like a
// per-row database query. Django QuerySet methods (.objects.filter/.get)
// are the primary target today; SQLAlchemy/Peewee/raw-SQL call shapes will
// need their own substrings (or a proper AST-aware check) as false
// positive/negative rates come in from real codebases.
const N_PLUS_ONE_SUSPECT_CALLS = [
  ".objects.filter(",
  ".objects.get(",
  ".query(",
  ".filter(",
  ".get(",
];

export const nPlusOneQuery: DetectionRule = {
  id: "n-plus-one-query",
  description:
    "Flags for-loops that appear to issue a database query per iteration, a classic N+1 pattern that multiplies both cost and carbon footprint per request.",
  severity: "high",
  detect({ filePath, tree }): CodeFinding[] {
    const findings: CodeFinding[] = [];
    const { rootNode } = tree as TreeSitterTree;

    walk(rootNode, (node) => {
      if (node.type !== "for_statement") return;
      const hasSuspectCall = N_PLUS_ONE_SUSPECT_CALLS.some((substring) =>
        node.text.includes(substring),
      );
      if (!hasSuspectCall) return;

      findings.push({
        id: randomUUID(),
        ruleId: "n-plus-one-query",
        severity: "high",
        filePath,
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
        snippet: node.text,
        message:
          "This loop appears to issue a database call on every iteration (N+1 query pattern). " +
          "Each iteration adds its own round-trip cost and carbon overhead; batch it into a single " +
          "query (e.g. Django's prefetch_related/select_related, or an equivalent bulk fetch/IN query) " +
          "before the loop instead.",
      });
    });

    return findings;
  },
};

/** All database-related Python rules. Extend this array as rules are added. */
export const pythonDatabaseRules: DetectionRule[] = [nPlusOneQuery];

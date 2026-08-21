import { randomUUID } from "node:crypto";
import type { DetectionRule } from "../CodeAnalyzer.js";
import type { CodeFinding } from "../../types.js";

// NOTE: this is a starting heuristic, not a precise per-ORM detector. It
// flags any `for` loop whose body text contains a call that *looks* like a
// per-row database query. Django QuerySet methods (.objects.filter/.get)
// are the primary target today; SQLAlchemy/Peewee/raw-SQL call shapes will
// need their own substrings (or a proper AST-aware check) as false
// positive/negative rates come in from real codebases.
const SUSPECT_CALL_SUBSTRINGS = [
  ".objects.filter(",
  ".objects.get(",
  ".query(",
  ".filter(",
  ".get(",
];

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
      const hasSuspectCall = SUSPECT_CALL_SUBSTRINGS.some((substring) =>
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

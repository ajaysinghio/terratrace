import { spawn } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import type { CodeAnalyzer } from "./CodeAnalyzer.js";
import type { CodeFinding, Severity } from "../types.js";

/**
 * CodeAnalyzer backed by the Semgrep CLI (https://semgrep.dev). Rules are
 * data (YAML files under `rules-semgrep/`), not code — so growing the rule
 * set never grows the TypeScript file count. Semgrep runs as a subprocess;
 * no Node bindings, no long-lived process.
 *
 * Semgrep coexists with the tree-sitter-based `PythonAnalyzer` behind the
 * same `CodeAnalyzer` interface — compose them with `CompositeAnalyzer` when
 * you want both engines running against the same file (Semgrep for the
 * declarative rule shelf, PythonAnalyzer for hand-authored rules that need
 * real AST/control-flow analysis Semgrep can't express).
 *
 * Requires `semgrep` on PATH. Install with `pip install semgrep` or a static
 * binary release; the analyzer throws a clear error if the CLI is missing
 * so misconfiguration surfaces immediately rather than silently returning
 * zero findings.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_RULES_DIR = path.resolve(HERE, "..", "..", "rules-semgrep");

interface SemgrepResultPosition {
  line: number;
  col: number;
}

interface SemgrepResult {
  check_id: string;
  path: string;
  start: SemgrepResultPosition;
  end: SemgrepResultPosition;
  extra: {
    message: string;
    severity?: string;
    lines?: string;
    fix?: string;
    metadata?: Record<string, unknown>;
  };
}

interface SemgrepOutput {
  results: SemgrepResult[];
  errors: unknown[];
}

export interface SemgrepAnalyzerOptions {
  /** Language passed via `--lang` when Semgrep reads from stdin. Defaults to "python". */
  language?: string;
  /** Directory holding the YAML rule pack. Defaults to the pack bundled with @terratrace/core. */
  rulesDir?: string;
  /** Override the executable name/path. Defaults to "semgrep" on PATH. */
  semgrepBin?: string;
  /** Milliseconds before killing the semgrep process. Defaults to 60_000. */
  timeoutMs?: number;
}

export class SemgrepAnalyzer implements CodeAnalyzer {
  readonly language: string;
  private readonly rulesDir: string;
  private readonly semgrepBin: string;
  private readonly timeoutMs: number;
  private ruleIdsPromise?: Promise<string[]>;

  constructor(options: SemgrepAnalyzerOptions = {}) {
    this.language = options.language ?? "python";
    this.rulesDir = options.rulesDir ?? DEFAULT_RULES_DIR;
    this.semgrepBin = options.semgrepBin ?? "semgrep";
    this.timeoutMs = options.timeoutMs ?? 60_000;
  }

  /**
   * Probes for a semgrep binary on PATH. Cheap enough to call at CLI/Action
   * startup so callers can decide between CompositeAnalyzer([Semgrep,
   * PythonAnalyzer]) and PythonAnalyzer alone without hard-failing.
   */
  static async isAvailable(semgrepBin = "semgrep"): Promise<boolean> {
    return new Promise((resolve) => {
      const proc = spawn(semgrepBin, ["--version"], { stdio: "ignore" });
      proc.on("error", () => resolve(false));
      proc.on("close", (code) => resolve(code === 0));
    });
  }

  async analyzeFile(filePath: string, sourceCode: string): Promise<CodeFinding[]> {
    const [output, ruleIds] = await Promise.all([
      this.runSemgrep(sourceCode, filePath),
      this.loadRuleIds(),
    ]);
    return output.results.map((r) => this.toCodeFinding(r, filePath, sourceCode, ruleIds));
  }

  /**
   * Semgrep 1.x mangles rule ids by prefixing them with the config path in
   * dot notation (e.g. `packages.core.rules-semgrep.python.n-plus-one-query`
   * instead of the plain `n-plus-one-query` the YAML declares). We fix this
   * ourselves: parse the YAML files under `rulesDir`, collect each rule's
   * declared `id:`, and later match Semgrep's mangled check_id by longest
   * id-suffix. Handles hierarchical ids like `perf.my-rule` correctly —
   * simply stripping the last dot segment would drop the `perf.` prefix.
   *
   * Lazy + cached: only pays the file-walk cost on the first analyze call.
   */
  private loadRuleIds(): Promise<string[]> {
    if (!this.ruleIdsPromise) {
      this.ruleIdsPromise = collectDeclaredRuleIds(this.rulesDir).catch(() => []);
    }
    return this.ruleIdsPromise;
  }

  private async runSemgrep(sourceCode: string, canonicalPath: string): Promise<SemgrepOutput> {
    // Semgrep 1.x rejects stdin input when running with --config (it treats
    // --lang as inline-pattern mode and demands -e). Simplest cross-version
    // fix: stage the source in a temp file whose extension matches
    // `this.language` so semgrep's rule dispatch works normally, then delete
    // it after. Adds a few ms per call; correct across every semgrep release.
    const scratchDir = await mkdtemp(path.join(tmpdir(), "terratrace-semgrep-"));
    const ext = extensionForLanguage(this.language);
    const scratchFile = path.join(scratchDir, `${path.basename(canonicalPath, path.extname(canonicalPath))}${ext}`);
    try {
      await writeFile(scratchFile, sourceCode, "utf-8");
      return await this.spawnSemgrep(scratchFile);
    } finally {
      await rm(scratchDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private spawnSemgrep(targetPath: string): Promise<SemgrepOutput> {
    return new Promise((resolve, reject) => {
      const args = [
        "scan",
        "--config",
        this.rulesDir,
        "--json",
        "--quiet",
        "--metrics=off",
        "--disable-version-check",
        targetPath,
      ];
      const proc = spawn(this.semgrepBin, args, { stdio: ["ignore", "pipe", "pipe"] });

      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      let settled = false;

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        proc.kill("SIGKILL");
        reject(new Error(`SemgrepAnalyzer: semgrep timed out after ${this.timeoutMs}ms.`));
      }, this.timeoutMs);

      proc.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
      proc.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

      proc.on("error", (err: NodeJS.ErrnoException) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (err.code === "ENOENT") {
          reject(
            new Error(
              `SemgrepAnalyzer: '${this.semgrepBin}' not found on PATH. Install with \`pip install semgrep\` or a static binary release.`,
            ),
          );
          return;
        }
        reject(err);
      });

      proc.on("close", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const stdout = Buffer.concat(stdoutChunks).toString("utf-8");
        const stderr = Buffer.concat(stderrChunks).toString("utf-8");
        if (code !== 0 && code !== 1) {
          reject(
            new Error(
              `SemgrepAnalyzer: semgrep exited with code ${code}.\nstderr: ${stderr.slice(0, 4000)}`,
            ),
          );
          return;
        }
        try {
          resolve(JSON.parse(stdout) as SemgrepOutput);
        } catch (parseErr) {
          reject(
            new Error(
              `SemgrepAnalyzer: failed to parse semgrep JSON output — ${
                parseErr instanceof Error ? parseErr.message : String(parseErr)
              }. stdout head: ${stdout.slice(0, 500)}`,
            ),
          );
        }
      });
    });
  }

  private toCodeFinding(
    result: SemgrepResult,
    canonicalPath: string,
    sourceCode: string,
    knownRuleIds: string[],
  ): CodeFinding {
    const severity = mapSeverity(result.extra.severity);
    // Always slice from source. Semgrep OSS returns the placeholder string
    // "requires login" for extra.lines on some rule configurations — using
    // it as the snippet collapses distinct matches into identical hashes
    // (same ruleId + filePath + "requires login" → same id → dedup errors
    // downstream and React duplicate-key warnings on the dashboard).
    const snippet = sliceSnippet(sourceCode, result.start.line, result.end.line);
    const ruleId = normalizeCheckId(result.check_id, knownRuleIds);

    // Deterministic id keyed on the same structural signature the
    // recommend/idempotency machinery uses. Matches the intent that
    // finding.id should be a stable identifier, not a per-run UUID.
    const id = createHash("sha256")
      .update(`${ruleId}\0${canonicalPath}\0${snippet}`)
      .digest("hex")
      .slice(0, 16);

    const finding: CodeFinding = {
      id,
      ruleId,
      severity,
      filePath: canonicalPath,
      startLine: result.start.line,
      endLine: result.end.line,
      snippet,
      message: result.extra.message,
    };

    if (typeof result.extra.fix === "string") {
      const startOffset = lineColToOffset(sourceCode, result.start.line, result.start.col);
      const endOffset = lineColToOffset(sourceCode, result.end.line, result.end.col);
      finding.autofix = {
        source: "semgrep",
        replacement: result.extra.fix,
        startOffset,
        endOffset,
      };
    }

    return finding;
  }
}

function mapSeverity(input: string | undefined): Severity {
  switch ((input ?? "").toUpperCase()) {
    case "ERROR":
      return "high";
    case "WARNING":
      return "medium";
    case "INFO":
      return "low";
    default:
      return "medium";
  }
}

function sliceSnippet(sourceCode: string, startLine: number, endLine: number): string {
  const lines = sourceCode.split(/\r?\n/);
  return lines.slice(Math.max(0, startLine - 1), endLine).join("\n");
}

async function collectDeclaredRuleIds(rulesDir: string): Promise<string[]> {
  const ids: string[] = [];
  const stack: string[] = [rulesDir];
  while (stack.length > 0) {
    const dir = stack.pop() as string;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile() && (entry.name.endsWith(".yaml") || entry.name.endsWith(".yml"))) {
        const contents = await readFile(full, "utf-8");
        for (const match of contents.matchAll(/^\s*-?\s*id:\s*([A-Za-z0-9_.\-\/]+)\s*$/gm)) {
          ids.push(match[1]);
        }
      }
    }
  }
  // Longest ids first — suffix match should prefer the most specific one.
  return ids.sort((a, b) => b.length - a.length);
}

/**
 * Semgrep prefixes each rule's declared `id:` with a dot-encoded config
 * path. Match the check_id against our known ids (longest first, so
 * `perf.my-rule` wins over `my-rule` when both are declared) and return
 * the declared id. If no match — e.g. the rule was pulled from a Semgrep
 * registry pack we didn't parse — fall back to the last dot segment.
 */
function normalizeCheckId(checkId: string, knownRuleIds: string[]): string {
  for (const id of knownRuleIds) {
    if (checkId === id) return id;
    if (checkId.endsWith(`.${id}`)) return id;
  }
  const lastDot = checkId.lastIndexOf(".");
  return lastDot === -1 ? checkId : checkId.slice(lastDot + 1);
}

function extensionForLanguage(language: string): string {
  switch (language.toLowerCase()) {
    case "python":
      return ".py";
    case "typescript":
      return ".ts";
    case "tsx":
      return ".tsx";
    case "javascript":
      return ".js";
    case "jsx":
      return ".jsx";
    case "go":
      return ".go";
    case "java":
      return ".java";
    case "ruby":
      return ".rb";
    default:
      return ".txt";
  }
}

/**
 * Convert 1-indexed (line, col) — Semgrep's convention — to a 0-indexed byte
 * offset. Assumes LF line endings (Semgrep normalizes on read).
 */
function lineColToOffset(source: string, line: number, col: number): number {
  let currentLine = 1;
  let offset = 0;
  while (currentLine < line && offset < source.length) {
    if (source[offset] === "\n") currentLine++;
    offset++;
  }
  return offset + Math.max(0, col - 1);
}

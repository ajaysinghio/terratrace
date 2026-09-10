import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import type { InfraAnalyzer } from "./InfraAnalyzer.js";
import type { InfraResource } from "../types.js";

/**
 * Unlike semgrep (a separate system tool the user installs themselves),
 * parse-hcl is a real npm dependency of @terratrace/core — so resolve its
 * installed bin path directly rather than relying on `node_modules/.bin`
 * being on PATH, which is only true when invoked via a pnpm/npm script,
 * not when the CLI is run directly via `node dist/index.js`.
 */
function resolveDefaultParseHclBin(): string {
  try {
    const require = createRequire(import.meta.url);
    const pkgJsonPath = require.resolve("parse-hcl/package.json");
    const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf-8")) as { bin?: string | Record<string, string> };
    const binRelative = typeof pkg.bin === "string" ? pkg.bin : pkg.bin?.["parse-hcl"];
    if (binRelative) return path.join(path.dirname(pkgJsonPath), binRelative);
  } catch {
    // Fall through — bare name relies on PATH (works when node_modules/.bin
    // is on it, e.g. invoked via a pnpm script).
  }
  return "parse-hcl";
}

export interface TerraformHclAnalyzerOptions {
  /** Region assumed when the file's provider block doesn't declare one. Defaults to "us-east-1". */
  defaultRegion?: string;
  /** Override the executable name/path. Defaults to "parse-hcl" on PATH. */
  parseHclBin?: string;
  /** Milliseconds before killing the parse-hcl process. Defaults to 30_000. */
  timeoutMs?: number;
}

const INSTANCE_TYPE_ATTRIBUTE: Record<string, string> = {
  aws_instance: "instance_type",
  aws_db_instance: "instance_class",
};

interface ParseHclLiteral {
  type: "literal";
  value: string | number;
}

interface ParseHclObject {
  type: "object";
  value: Record<string, ParseHclValue>;
}

type ParseHclValue = ParseHclLiteral | ParseHclObject | { type: string; [key: string]: unknown };

interface ParseHclBlock {
  type?: string;
  name: string;
  properties: Record<string, ParseHclValue>;
}

interface ParseHclOutput {
  provider?: ParseHclBlock[];
  resource?: ParseHclBlock[];
}

/**
 * InfraAnalyzer backed by the parse-hcl CLI (https://github.com/sigmoid-hq/parse-hcl).
 * Shells out to a subprocess rather than embedding an HCL parser — same
 * pattern SemgrepAnalyzer uses for semgrep. Only reads resources whose
 * instance-size attribute is a literal (a plain string/number in the .tf
 * file); a value driven by a variable or expression can't be resolved
 * without also evaluating the rest of the module, so it's skipped rather
 * than guessed.
 *
 * Supports aws_instance and aws_db_instance today — the two resource types
 * TerraTrace's carbon math (carbon/coefficients/aws.ts) already models.
 */
export class TerraformHclAnalyzer implements InfraAnalyzer {
  readonly provider = "aws" as const;
  private readonly defaultRegion: string;
  private readonly parseHclBin: string;
  private readonly timeoutMs: number;

  constructor(options: TerraformHclAnalyzerOptions = {}) {
    this.defaultRegion = options.defaultRegion ?? "us-east-1";
    this.parseHclBin = options.parseHclBin ?? resolveDefaultParseHclBin();
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  async parseFile(filePath: string, sourceCode: string): Promise<InfraResource[]> {
    const scratchDir = await mkdtemp(path.join(tmpdir(), "terratrace-parse-hcl-"));
    const scratchFile = path.join(scratchDir, path.basename(filePath));
    try {
      await writeFile(scratchFile, sourceCode, "utf-8");
      const output = await this.runParseHcl(scratchFile);
      return this.toInfraResources(output, filePath, sourceCode);
    } finally {
      await rm(scratchDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private runParseHcl(targetPath: string): Promise<ParseHclOutput> {
    return new Promise((resolve, reject) => {
      const args = ["--file", targetPath, "--format", "json", "--stdout"];
      const proc = spawn(this.parseHclBin, args, { stdio: ["ignore", "pipe", "pipe"] });

      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      let settled = false;

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        proc.kill("SIGKILL");
        reject(new Error(`TerraformHclAnalyzer: parse-hcl timed out after ${this.timeoutMs}ms.`));
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
              `TerraformHclAnalyzer: '${this.parseHclBin}' not found on PATH. ` +
                `It's a dependency of @terratrace/core (installed to node_modules/.bin) — ` +
                `run via a pnpm script, or pass an explicit parseHclBin path.`,
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
        if (code !== 0) {
          reject(new Error(`TerraformHclAnalyzer: parse-hcl exited with code ${code}.\nstderr: ${stderr.slice(0, 4000)}`));
          return;
        }
        // parse-hcl prints a "[parser:info] ..." banner line to stdout ahead
        // of the JSON, with no documented quiet flag — slice from the first
        // '{' rather than JSON.parse the raw stream.
        const jsonStart = stdout.indexOf("{");
        if (jsonStart === -1) {
          reject(new Error(`TerraformHclAnalyzer: no JSON object found in parse-hcl output. stdout head: ${stdout.slice(0, 500)}`));
          return;
        }
        try {
          resolve(JSON.parse(stdout.slice(jsonStart)) as ParseHclOutput);
        } catch (parseErr) {
          reject(
            new Error(
              `TerraformHclAnalyzer: failed to parse parse-hcl JSON output — ${
                parseErr instanceof Error ? parseErr.message : String(parseErr)
              }`,
            ),
          );
        }
      });
    });
  }

  private toInfraResources(output: ParseHclOutput, canonicalPath: string, sourceCode: string): InfraResource[] {
    const region = unwrapLiteralString(output.provider?.[0]?.properties.region) ?? this.defaultRegion;
    const resources: InfraResource[] = [];

    for (const block of output.resource ?? []) {
      const resourceType = block.type;
      if (!resourceType) continue;
      const instanceTypeAttr = INSTANCE_TYPE_ATTRIBUTE[resourceType];
      if (!instanceTypeAttr) continue;

      const instanceType = unwrapLiteralString(block.properties[instanceTypeAttr]);
      if (!instanceType) continue; // driven by a variable/expression — can't resolve statically

      const line = findDeclarationLine(sourceCode, resourceType, block.name);

      resources.push({
        provider: "aws",
        resourceType,
        resourceAddress: `${resourceType}.${block.name}`,
        instanceType,
        region,
        tags: unwrapTags(block.properties.tags),
        filePath: canonicalPath,
        startLine: line,
        endLine: line,
      });
    }

    return resources;
  }
}

function unwrapLiteralString(value: ParseHclValue | undefined): string | undefined {
  if (value && value.type === "literal" && "value" in value) {
    const v = (value as ParseHclLiteral).value;
    return typeof v === "string" ? v : typeof v === "number" ? String(v) : undefined;
  }
  return undefined;
}

function unwrapTags(value: ParseHclValue | undefined): Record<string, string> | undefined {
  if (!value || value.type !== "object" || !("value" in value)) return undefined;
  const entries = (value as ParseHclObject).value;
  const tags: Record<string, string> = {};
  for (const [key, nested] of Object.entries(entries)) {
    const unwrapped = unwrapLiteralString(nested);
    if (unwrapped !== undefined) tags[key] = unwrapped;
  }
  return tags;
}

function findDeclarationLine(sourceCode: string, resourceType: string, name: string): number {
  const pattern = new RegExp(`resource\\s+"${escapeRegExp(resourceType)}"\\s+"${escapeRegExp(name)}"`);
  const lines = sourceCode.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (pattern.test(lines[i])) return i + 1;
  }
  return 1;
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
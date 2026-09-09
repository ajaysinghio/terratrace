import path from "node:path";
import { fileURLToPath } from "node:url";
import type { CodeAnalyzer } from "./CodeAnalyzer.js";
import type { CodeFinding } from "../types.js";
import { SemgrepAnalyzer } from "./SemgrepAnalyzer.js";

/**
 * CodeAnalyzer implementation for Terraform (HCL). Same shape as JavaAnalyzer —
 * a thin named wrapper around SemgrepAnalyzer's `language: "terraform"` mode,
 * pointed at the bundled `rules-semgrep/terraform` pack. This is the prototype's
 * infra-as-code analyzer: AWS-first (the rule pack targets AWS resource types),
 * with the same CodeAnalyzer seam a GCP/Azure/on-prem IaC analyzer would use
 * later — no caller changes needed beyond a new SUPPORTED_LANGUAGES entry.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_TERRAFORM_RULES_DIR = path.resolve(HERE, "..", "..", "rules-semgrep", "terraform");

export interface TerraformAnalyzerOptions {
  /** Directory holding the Terraform YAML rule pack. Defaults to the pack bundled with @terratrace/core. */
  rulesDir?: string;
  /** Override the semgrep executable name/path. Defaults to "semgrep" on PATH. */
  semgrepBin?: string;
}

export class TerraformAnalyzer implements CodeAnalyzer {
  readonly language = "terraform";
  private readonly semgrep: SemgrepAnalyzer;

  constructor(options: TerraformAnalyzerOptions = {}) {
    this.semgrep = new SemgrepAnalyzer({
      language: "terraform",
      rulesDir: options.rulesDir ?? DEFAULT_TERRAFORM_RULES_DIR,
      semgrepBin: options.semgrepBin,
    });
  }

  async analyzeFile(filePath: string, sourceCode: string): Promise<CodeFinding[]> {
    return this.semgrep.analyzeFile(filePath, sourceCode);
  }
}

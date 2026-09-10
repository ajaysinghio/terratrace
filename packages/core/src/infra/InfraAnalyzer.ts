import type { CloudProvider, InfraResource } from "../types.js";

/**
 * Interface for reading declared cloud resources out of infrastructure-as-
 * code. Adding a new IaC tool (CloudFormation, Pulumi, ...) or a new cloud's
 * resource types means writing one new implementation — nothing else in the
 * pipeline needs to change.
 */
export interface InfraAnalyzer {
  readonly provider: CloudProvider;
  parseFile(filePath: string, sourceCode: string): Promise<InfraResource[]>;
}
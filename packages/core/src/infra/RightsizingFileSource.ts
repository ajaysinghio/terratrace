import { readFile } from "node:fs/promises";
import type { RightsizingSource } from "./RightsizingSource.js";
import type { RightsizingFinding, RightsizingRecommendation } from "../types.js";

interface ComputeOptimizerTag {
  key: string;
  value: string;
}

interface EC2InstanceRecommendation {
  instanceArn: string;
  currentInstanceType: string;
  finding: RightsizingFinding;
  recommendationOptions?: Array<{ instanceType: string; rank: number }>;
  tags?: ComputeOptimizerTag[];
}

interface RDSDBRecommendation {
  resourceArn: string;
  currentDBInstanceClass: string;
  instanceFinding: RightsizingFinding;
  instanceRecommendationOptions?: Array<{ dbInstanceClass: string; rank: number }>;
  tags?: ComputeOptimizerTag[];
}

interface ComputeOptimizerExport {
  instanceRecommendations?: EC2InstanceRecommendation[];
  rdsDBRecommendations?: RDSDBRecommendation[];
}

/**
 * RightsizingSource backed by a local file shaped like AWS Compute
 * Optimizer's real API responses (GetEC2InstanceRecommendations'
 * `instanceRecommendations` and/or GetRDSDatabaseRecommendations'
 * `rdsDBRecommendations`, verbatim field names) — same "offline file first,
 * live fetch later" precedent as AWSCurSource vs AWSCurS3Source. Useful for
 * testing without an AWS account opted into Compute Optimizer (it requires
 * explicit opt-in and days of accumulated CloudWatch history before it
 * returns anything live).
 */
export class RightsizingFileSource implements RightsizingSource {
  readonly provider = "aws" as const;

  constructor(private readonly filePath: string) {}

  async fetchRecommendations(): Promise<RightsizingRecommendation[]> {
    const raw = await readFile(this.filePath, "utf8");
    const parsed = JSON.parse(raw) as ComputeOptimizerExport;

    const recommendations: RightsizingRecommendation[] = [];

    for (const rec of parsed.instanceRecommendations ?? []) {
      const top = topRanked(rec.recommendationOptions, (o) => o.instanceType);
      if (!top) continue;
      recommendations.push({
        resourceArn: rec.instanceArn,
        currentInstanceType: rec.currentInstanceType,
        recommendedInstanceType: top,
        finding: rec.finding,
        tags: tagsToRecord(rec.tags),
      });
    }

    for (const rec of parsed.rdsDBRecommendations ?? []) {
      const top = topRanked(rec.instanceRecommendationOptions, (o) => o.dbInstanceClass);
      if (!top) continue;
      recommendations.push({
        resourceArn: rec.resourceArn,
        currentInstanceType: rec.currentDBInstanceClass,
        recommendedInstanceType: top,
        finding: rec.instanceFinding,
        tags: tagsToRecord(rec.tags),
      });
    }

    return recommendations;
  }
}

function topRanked<T extends { rank: number }>(options: T[] | undefined, pick: (o: T) => string): string | undefined {
  if (!options || options.length === 0) return undefined;
  const best = options.reduce((a, b) => (b.rank < a.rank ? b : a));
  return pick(best);
}

function tagsToRecord(tags: ComputeOptimizerTag[] | undefined): Record<string, string> | undefined {
  if (!tags || tags.length === 0) return undefined;
  return Object.fromEntries(tags.map((t) => [t.key, t.value]));
}
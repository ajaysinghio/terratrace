import type { UsageRecord } from "../../types.js";
import type { EnergyModel } from "../energyModel.js";

/**
 * AWS energy model, following Cloud Carbon Footprint's methodology:
 * https://www.cloudcarbonfootprint.org/docs/methodology/
 *
 * kWh per instance-hour = watts × PUE ÷ 1000, where watts is linearly
 * interpolated between per-family min/max using CPU utilisation. When we
 * have no CloudWatch metric, we use CCF's default 50% assumption — that's
 * the reason estimateCarbon reports at most "medium" confidence today.
 *
 * Seed values below approximate CCF's published tables. Replace with the
 * canonical constants from `@cloud-carbon-footprint/aws-*` (Apache-2.0)
 * before quoting to a client.
 */

export const AWS_PUE = 1.135;
export const CCF_AVG_CPU_UTIL = 0.5;

interface FamilyWatts {
  min: number;
  max: number;
}

const EC2_WATTS_BY_FAMILY: Record<string, FamilyWatts> = {
  m4: { min: 0.6415, max: 3.492 },
  m5: { min: 0.71, max: 3.46 },
  m6i: { min: 0.5045, max: 2.9192 },
  c4: { min: 0.6415, max: 3.492 },
  c5: { min: 0.51, max: 3.05 },
  c6i: { min: 0.4842, max: 3.0072 },
  r4: { min: 0.85, max: 4.03 },
  r5: { min: 0.85, max: 4.03 },
  r6i: { min: 0.6231, max: 3.0072 },
  t2: { min: 0.4835, max: 2.94875 },
  t3: { min: 0.34, max: 2.05 },
};

const EC2_AVG_WATTS: FamilyWatts = { min: 0.71, max: 3.46 };

// CCF: SSD ~1.2 Wh per TB-hour, HDD ~0.65 Wh per TB-hour. S3 is a mix; we
// use SSD's coefficient as a conservative default.
const S3_KWH_PER_TB_HOUR = 1.2 / 1000;

// CCF Lambda: ~0.0000167 kWh per GB-second (very rough — Lambda's real
// footprint depends on execution-host utilisation which AWS does not
// expose).
const LAMBDA_KWH_PER_GB_SECOND = 0.0000167;

function watts(family: FamilyWatts, cpuUtil: number): number {
  return family.min + cpuUtil * (family.max - family.min);
}

function extractEc2Family(record: UsageRecord): string {
  // Prefer resourceId (populated by CUR / by CSV rows that carry
  // instance-type). Fall back to usageUnit and to a family-average. Also
  // matches RDS-style types ("db.t3.medium") since the regex just looks
  // for the family.size pattern anywhere in the string.
  const source = record.resourceId ?? record.usageUnit ?? "";
  const match = source.match(/([a-z]+\d)[a-z]*\./i);
  return match?.[1]?.toLowerCase() ?? "";
}

function estimateEc2Kwh(record: UsageRecord): number {
  const family = extractEc2Family(record);
  const w = EC2_WATTS_BY_FAMILY[family] ?? EC2_AVG_WATTS;
  const averageWatts = watts(w, CCF_AVG_CPU_UTIL);
  return record.usageAmount * averageWatts * AWS_PUE / 1000;
}

function estimateS3Kwh(record: UsageRecord): number {
  // usageAmount conventionally in GB-month for S3 billing rows.
  const tbHours = (record.usageAmount / 1024) * 24 * 30;
  return tbHours * S3_KWH_PER_TB_HOUR * AWS_PUE;
}

function estimateLambdaKwh(record: UsageRecord): number {
  // usageAmount in GB-seconds when the row is a Lambda duration line item.
  return record.usageAmount * LAMBDA_KWH_PER_GB_SECOND * AWS_PUE;
}

/**
 * Cost Explorer uses long service names ("Amazon Elastic Compute Cloud -
 * Compute") while CUR uses short codes ("AmazonEC2"). CCF's tables are
 * keyed on the CUR form; we canonicalise here so both ingest paths work.
 */
function canonicaliseAwsService(name: string): string {
  const s = name.trim();
  if (/^AmazonEC2$/i.test(s) || /Elastic Compute Cloud/i.test(s)) return "AmazonEC2";
  if (/^AmazonRDS$/i.test(s) || /Relational Database Service/i.test(s)) return "AmazonRDS";
  if (/^AmazonS3$/i.test(s) || /Simple Storage Service/i.test(s)) return "AmazonS3";
  if (/^AWSLambda$/i.test(s) || /Lambda/i.test(s)) return "AWSLambda";
  return s;
}

export const awsEnergyModel: EnergyModel = {
  provider: "aws",
  estimateKwh(record) {
    switch (canonicaliseAwsService(record.service)) {
      case "AmazonEC2":
      // RDS runs on the same EC2-family instance hardware, so it reuses
      // the same per-family wattage table rather than a separate one —
      // matches CCF's own approach (no RDS-specific table either).
      case "AmazonRDS":
        return estimateEc2Kwh(record);
      case "AmazonS3":
        return estimateS3Kwh(record);
      case "AWSLambda":
        return estimateLambdaKwh(record);
      default:
        return 0;
    }
  },
};

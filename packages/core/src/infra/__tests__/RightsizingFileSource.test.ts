import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { RightsizingFileSource } from "../RightsizingFileSource.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SAMPLE_PATH = resolve(__dirname, "../../../../../sample-data/compute-optimizer-sample.json");

describe("RightsizingFileSource against sample-data/compute-optimizer-sample.json", () => {
  it("normalizes both EC2 and RDS recommendations to the same shape", async () => {
    const recommendations = await new RightsizingFileSource(SAMPLE_PATH).fetchRecommendations();

    expect(recommendations).toHaveLength(2);

    const ec2 = recommendations.find((r) => r.tags?.Name === "web");
    expect(ec2).toMatchObject({
      resourceArn: "arn:aws:ec2:us-east-1:111122223333:instance/i-0abc123def456789",
      currentInstanceType: "m5.4xlarge",
      recommendedInstanceType: "m6i.large",
      finding: "Overprovisioned",
    });

    const rds = recommendations.find((r) => r.tags?.Name === "orders-db");
    expect(rds).toMatchObject({
      resourceArn: "arn:aws:rds:us-east-1:111122223333:db:orders-db",
      currentInstanceType: "db.t3.medium",
      recommendedInstanceType: "db.t3.small",
      finding: "Overprovisioned",
    });
  });
});
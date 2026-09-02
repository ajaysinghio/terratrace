import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { AWSCurS3Source } from "../AWSCurS3Source.js";

const HEADER =
  "lineItem/UsageStartDate,lineItem/UsageEndDate,lineItem/ProductCode,product/region,lineItem/UsageAmount,pricing/unit,lineItem/UnblendedCost,product/instanceType";

function curRow(hour: string, productCode: string, amount: number, cost: number, instanceType = "") {
  return `${hour}T00:00:00Z,${hour}T01:00:00Z,${productCode},us-east-1,${amount},Hrs,${cost},${instanceType}`;
}

function fakeBody(bytes: Uint8Array) {
  return { transformToByteArray: async () => bytes };
}

/** Fake S3 client keyed by object key; asserts the bucket matches too. */
function fakeS3Client(bucket: string, objects: Record<string, Uint8Array>) {
  return {
    send: async (command: GetObjectCommand) => {
      const { Bucket, Key } = command.input;
      if (Bucket !== bucket) throw new Error(`unexpected bucket: ${Bucket}`);
      const bytes = objects[Key ?? ""];
      if (!bytes) throw new Error(`no fake object for key: ${Key}`);
      return { Body: fakeBody(bytes) };
    },
  };
}

describe("AWSCurS3Source", () => {
  it("fetches a gzip-compressed, multi-shard manifest and parses each shard independently", async () => {
    const shard1 = `${HEADER}\n${curRow("2026-08-01", "AmazonEC2", 1, 0.096, "m5.large")}\n`;
    const shard2 = `${HEADER}\n${curRow("2026-08-01", "AmazonRDS", 1, 0.068, "db.t3.medium")}\n`;

    const manifest = {
      bucket: "cur-bucket",
      compression: "GZIP",
      reportKeys: ["reports/shard-1.csv.gz", "reports/shard-2.csv.gz"],
    };

    const client = fakeS3Client("cur-bucket", {
      "manifests/latest-Manifest.json": new TextEncoder().encode(JSON.stringify(manifest)),
      "reports/shard-1.csv.gz": gzipSync(Buffer.from(shard1)),
      "reports/shard-2.csv.gz": gzipSync(Buffer.from(shard2)),
    });

    const source = new AWSCurS3Source({
      manifestBucket: "cur-bucket",
      manifestKey: "manifests/latest-Manifest.json",
      client,
    });

    const records = await source.fetchUsage({ start: "2026-08-01", end: "2026-08-02" });

    expect(records).toHaveLength(2);
    expect(records.map((r) => r.service).sort()).toEqual(["AmazonEC2", "AmazonRDS"]);
    expect(records.find((r) => r.service === "AmazonEC2")?.resourceId).toBe("m5.large");
  });

  it("fetches an uncompressed manifest", async () => {
    const shard = `${HEADER}\n${curRow("2026-08-01", "AmazonS3", 500, 0.383)}\n`;
    const manifest = { bucket: "cur-bucket", reportKeys: ["reports/shard.csv"] };

    const client = fakeS3Client("cur-bucket", {
      "manifests/latest-Manifest.json": new TextEncoder().encode(JSON.stringify(manifest)),
      "reports/shard.csv": new TextEncoder().encode(shard),
    });

    const source = new AWSCurS3Source({
      manifestBucket: "cur-bucket",
      manifestKey: "manifests/latest-Manifest.json",
      client,
    });

    const records = await source.fetchUsage({ start: "2026-08-01", end: "2026-08-02" });

    expect(records).toHaveLength(1);
    expect(records[0].service).toBe("AmazonS3");
    expect(records[0].costUsd).toBeCloseTo(0.383, 6);
  });
});
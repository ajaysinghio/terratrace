import { gunzipSync } from "node:zlib";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import type { CloudBillingSource } from "./CloudBillingSource.js";
import type { UsageRecord } from "../types.js";
import { parseCurCsv } from "./AWSCurSource.js";

type S3Like = Pick<S3Client, "send">;

export interface AWSCurS3SourceOptions {
  manifestBucket: string;
  manifestKey: string;
  region?: string;
  /** Inject a fake S3 client for testing; defaults to a real S3Client. */
  client?: S3Like;
}

interface CurManifest {
  bucket?: string;
  reportKeys?: string[];
  compression?: string;
}

/**
 * CloudBillingSource that fetches a real AWS CUR export live from S3,
 * rather than requiring a pre-downloaded local file (see AWSCurSource for
 * that path — this is a separate CloudBillingSource, not a mode switch on
 * it, so a future fetch mode can be added the same way).
 *
 * Point it at the manifest.json AWS's CUR delivery writes alongside the
 * data files for a billing period. Each report shard carries its own
 * header row, so files are parsed independently with parseCurCsv and
 * concatenated — not joined as raw text first, which would corrupt the
 * header/data boundary.
 *
 * CUR 1.0 CSV(.gz) manifests only — CUR 2.0's Parquet export isn't
 * supported here.
 */
export class AWSCurS3Source implements CloudBillingSource {
  readonly provider = "aws";
  private readonly client: S3Like;

  constructor(private readonly opts: AWSCurS3SourceOptions) {
    this.client = opts.client ?? new S3Client({ region: opts.region ?? process.env.AWS_REGION ?? "us-east-1" });
  }

  async fetchUsage(_params: { start: string; end: string }): Promise<UsageRecord[]> {
    const manifest = await this.fetchManifest();
    const bucket = manifest.bucket ?? this.opts.manifestBucket;
    const reportKeys = manifest.reportKeys ?? [];

    const records: UsageRecord[] = [];
    for (const key of reportKeys) {
      const bytes = await this.getObjectBytes(bucket, key);
      const isGzipped = key.endsWith(".gz") || manifest.compression?.toUpperCase() === "GZIP";
      const csv = Buffer.from(isGzipped ? gunzipSync(bytes) : bytes).toString("utf8");
      records.push(...parseCurCsv(csv));
    }
    return records;
  }

  private async fetchManifest(): Promise<CurManifest> {
    const bytes = await this.getObjectBytes(this.opts.manifestBucket, this.opts.manifestKey);
    return JSON.parse(Buffer.from(bytes).toString("utf8")) as CurManifest;
  }

  private async getObjectBytes(bucket: string, key: string): Promise<Uint8Array> {
    const response = await this.client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    if (!response.Body) throw new Error(`Empty S3 object body for s3://${bucket}/${key}`);
    return response.Body.transformToByteArray();
  }
}
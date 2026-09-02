import { readFile } from "node:fs/promises";
import type { CloudBillingSource } from "./CloudBillingSource.js";
import type { UsageRecord } from "../types.js";

/**
 * CloudBillingSource backed by an offline AWS Cost Explorer CSV export.
 * Used for testing and for engagements where hitting the live Cost Explorer
 * API is not an option (no credentials, air-gapped review, deterministic
 * fixtures).
 *
 * Expected columns (header names are case-insensitive; the first match
 * from each group wins, so massaging a raw console export is usually just
 * a rename or two). Both a Cost Explorer console export and a real CUR's
 * `lineItem/*` / `product/*` / `pricing/*` prefixed columns are recognized:
 *
 *   service       — "Service" | "ProductName" | "product/ProductName"
 *   region        — "Region"  | "Location"    | "product/region"
 *   usageAmount   — "UsageAmount" | "UsageQuantity" | "Usage" |
 *                    "lineItem/UsageAmount"
 *   usageUnit     — "UsageUnit"   | "Unit"          | "PricingUnit" |
 *                    "pricing/unit"
 *   costUsd       — "Cost" | "UnblendedCost" | "CostUsd" | "USD" |
 *                    "lineItem/UnblendedCost"
 *   periodStart   — "PeriodStart" | "Start" | "Date" | "UsageStartDate" |
 *                    "lineItem/UsageStartDate"
 *   periodEnd     — "PeriodEnd"   | "End"   | "UsageEndDate" |
 *                    "lineItem/UsageEndDate" (optional)
 *   instanceType  — "InstanceType" | "ResourceId" | "product/instanceType" |
 *                    "lineItem/ResourceId" (optional, populates
 *                    UsageRecord.resourceId so per-family energy math works)
 *
 * Rows missing a required column are skipped.
 */
export class CostExplorerCsvSource implements CloudBillingSource {
  readonly provider = "aws";

  constructor(private readonly filePath: string) {}

  async fetchUsage(_params: { start: string; end: string }): Promise<UsageRecord[]> {
    const raw = await readFile(this.filePath, "utf8");
    return parseCostExplorerCsv(raw);
  }
}

const COLUMN_ALIASES = {
  service: ["service", "productname", "product/productname"],
  region: ["region", "location", "product/region"],
  usageAmount: ["usageamount", "usagequantity", "usage", "lineitem/usageamount"],
  usageUnit: ["usageunit", "unit", "pricingunit", "pricing/unit"],
  costUsd: ["cost", "unblendedcost", "costusd", "usd", "lineitem/unblendedcost"],
  periodStart: ["periodstart", "start", "date", "usagestartdate", "lineitem/usagestartdate"],
  periodEnd: ["periodend", "end", "usageenddate", "lineitem/usageenddate"],
  instanceType: ["instancetype", "resourceid", "product/instancetype", "lineitem/resourceid"],
} as const;

export function parseCostExplorerCsv(csv: string): UsageRecord[] {
  const rows = parseCsvRows(csv);
  if (rows.length < 2) return [];

  const headerIndex = buildHeaderIndex(rows[0]);
  const records: UsageRecord[] = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (row.length === 0 || (row.length === 1 && row[0] === "")) continue;

    const service = readCell(row, headerIndex, "service");
    const region = readCell(row, headerIndex, "region");
    const usageAmount = Number(readCell(row, headerIndex, "usageAmount"));
    const costUsd = Number(readCell(row, headerIndex, "costUsd"));
    const periodStart = readCell(row, headerIndex, "periodStart");

    if (!service || !region || Number.isNaN(usageAmount) || !periodStart) continue;

    const record: UsageRecord = {
      provider: "aws",
      service,
      region,
      usageAmount,
      usageUnit: readCell(row, headerIndex, "usageUnit") || "Unknown",
      costUsd: Number.isNaN(costUsd) ? 0 : costUsd,
      periodStart,
      periodEnd: readCell(row, headerIndex, "periodEnd") || periodStart,
    };

    const instanceType = readCell(row, headerIndex, "instanceType");
    if (instanceType) record.resourceId = instanceType;

    records.push(record);
  }

  return records;
}

type ColumnKey = keyof typeof COLUMN_ALIASES;

function buildHeaderIndex(header: string[]): Map<ColumnKey, number> {
  const normalised = header.map((h) => h.trim().toLowerCase());
  const map = new Map<ColumnKey, number>();
  for (const key of Object.keys(COLUMN_ALIASES) as ColumnKey[]) {
    for (const alias of COLUMN_ALIASES[key]) {
      const idx = normalised.indexOf(alias);
      if (idx !== -1) {
        map.set(key, idx);
        break;
      }
    }
  }
  return map;
}

function readCell(row: string[], index: Map<ColumnKey, number>, key: ColumnKey): string {
  const i = index.get(key);
  if (i === undefined || i >= row.length) return "";
  return row[i].trim();
}

/**
 * Minimal RFC-4180-ish CSV parser: handles quoted fields with commas,
 * embedded quotes escaped as "", CRLF or LF line endings. Not a full
 * standards implementation; enough for the shapes Cost Explorer exports
 * produce.
 */
function parseCsvRows(csv: string): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < csv.length; i++) {
    const ch = csv[i];

    if (inQuotes) {
      if (ch === '"') {
        if (csv[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && csv[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      field = "";
      row = [];
    } else {
      field += ch;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

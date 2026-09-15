"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

interface ProjectResult {
  projectId: string;
  projectName: string;
  findingsUpdated: number;
  totalFindings: number;
  totalCostUsd: number;
  totalKgCO2e: number;
}

interface UploadResult {
  filename: string;
  recordCount: number;
  projects: ProjectResult[];
  findingsUpdated: number;
  totalCostUsd: number;
  totalKgCO2e: number;
}

/**
 * The one place to upload a CUR file, org-wide — AWS issues a CUR per
 * payer account, not per repo/service, so there's no such thing as "the CUR
 * for this project" (see api/billing/route.ts). One upload here
 * re-correlates every scanned project at once.
 */
export default function GlobalBillingUpload() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<"idle" | "uploading" | "done" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [result, setResult] = useState<UploadResult | null>(null);

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    setStatus("uploading");
    setMessage(null);
    setResult(null);

    const formData = new FormData();
    formData.append("file", file);

    try {
      const response = await fetch("/api/billing", { method: "POST", body: formData });
      const body = await response.json();
      if (!response.ok) {
        setStatus("error");
        setMessage(body.error ?? "Upload failed.");
        return;
      }
      setStatus("done");
      setResult(body);
      router.refresh();
    } catch {
      setStatus("error");
      setMessage("Upload failed — check your connection and try again.");
    } finally {
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="card">
      <h2>Billing data</h2>
      <p className="card__hint">
        Upload your AWS account&apos;s Cost and Usage Report (CUR 1.0 CSV) here — one file, applied to every scanned
        project at once. No rescan, no LLM call, just cost/carbon re-correlation.
      </p>
      <input
        ref={inputRef}
        type="file"
        accept=".csv"
        onChange={handleFileChange}
        disabled={status === "uploading"}
        className="billing-upload__input"
      />
      {status === "uploading" && <p className="card__hint">Parsing and correlating across every project…</p>}
      {status === "error" && <p className="billing-upload__error">{message}</p>}
      {status === "done" && result && (
        <div className="billing-upload__success">
          <p>
            Applied <strong>{result.filename}</strong> ({result.recordCount} usage records) across{" "}
            {result.projects.length} project(s) — updated <strong>{result.findingsUpdated}</strong> findings, $
            {result.totalCostUsd.toFixed(2)}/mo and {result.totalKgCO2e.toFixed(4)} kgCO2e total.
          </p>
          <ul className="billing-upload__project-list">
            {result.projects.map((p) => (
              <li key={p.projectId}>
                <strong>{p.projectName}</strong>: {p.findingsUpdated}/{p.totalFindings} findings correlated — $
                {p.totalCostUsd.toFixed(2)}/mo, {p.totalKgCO2e.toFixed(4)} kgCO2e
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

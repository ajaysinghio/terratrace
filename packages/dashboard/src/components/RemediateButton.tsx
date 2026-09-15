"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface RemediateResult {
  candidateCount: number;
  dispatched: boolean;
  scannerActionsUrl: string;
}

/**
 * Opens real GitHub PR(s) for finding(s) that already have a validated fix
 * diff — a deliberately separate, explicit action from scanning (see
 * remediate-repo.yml's header comment). Pass findingId for the per-finding
 * "Create PR" button; omit it for the project-level "Raise PRs for fixes"
 * bulk action. Always confirms first — this writes to the target repo.
 */
export default function RemediateButton({
  projectId,
  findingId,
  label,
}: {
  projectId: string;
  findingId?: string;
  label: string;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<"idle" | "submitting" | "done" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [result, setResult] = useState<RemediateResult | null>(null);

  async function handleClick() {
    const confirmText = findingId
      ? "Open a real pull request on the target repo with this finding's fix? This writes to GitHub."
      : "Open real pull requests on the target repo for every finding with a ready fix? This writes to GitHub.";
    if (!window.confirm(confirmText)) return;

    setStatus("submitting");
    setMessage(null);
    setResult(null);

    try {
      const response = await fetch(`/api/projects/${projectId}/remediate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(findingId ? { findingId } : {}),
      });
      const body = await response.json();
      if (!response.ok) {
        setStatus("error");
        setMessage(body.error ?? "Couldn't trigger remediation.");
        return;
      }
      setStatus("done");
      setResult(body);
      router.refresh();
    } catch {
      setStatus("error");
      setMessage("Couldn't reach the server — check your connection and try again.");
    }
  }

  return (
    <span className="remediate-button">
      <button type="button" className="button" onClick={handleClick} disabled={status === "submitting"}>
        {status === "submitting" ? "…" : label}
      </button>
      {status === "error" && <p className="billing-upload__error">{message}</p>}
      {status === "done" && result && (
        <p className="billing-upload__success">
          {result.dispatched ? (
            <>
              Remediation triggered for {result.candidateCount} finding(s) — check the{" "}
              <a href={result.scannerActionsUrl} target="_blank" rel="noopener noreferrer">
                terratrace repo&apos;s Actions tab
              </a>{" "}
              for progress.
            </>
          ) : (
            <>Auto-trigger isn&apos;t configured yet (set GITHUB_DISPATCH_TOKEN).</>
          )}
        </p>
      )}
    </span>
  );
}

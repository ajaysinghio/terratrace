"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface ScanResult {
  dispatched: boolean;
  scannerActionsUrl: string;
  steps: string[];
}

/**
 * Triggers a scan for an already-registered project — used both right
 * after "Add repo" (first scan) and as the "Rescan" action on an
 * already-scanned project card. Deliberately its own explicit click, not
 * something Add-repo does automatically: registering a repo shouldn't
 * silently queue a CI run and LLM spend just because someone typed a URL.
 */
export default function ScanButton({
  projectId,
  label,
  variant = "pill",
  stopPropagation = false,
}: {
  projectId: string;
  label: string;
  /** "pill" = full labeled button (e.g. "Scan now"). "icon" = compact square button for a tight space (e.g. the rescan icon in a project card's corner). */
  variant?: "pill" | "icon";
  /** True when rendered inside a project-card <Link> — prevents the click from also navigating. */
  stopPropagation?: boolean;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<"idle" | "submitting" | "done" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [result, setResult] = useState<ScanResult | null>(null);

  async function handleClick(event: React.MouseEvent) {
    if (stopPropagation) {
      event.preventDefault();
      event.stopPropagation();
    }
    setStatus("submitting");
    setMessage(null);
    setResult(null);

    try {
      const response = await fetch(`/api/projects/${projectId}/scan`, { method: "POST" });
      const body = await response.json();
      if (!response.ok) {
        setStatus("error");
        setMessage(body.error ?? "Couldn't trigger the scan.");
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
    <>
      <button
        type="button"
        className={variant === "icon" ? "project-card__scan" : "button button--primary"}
        onClick={handleClick}
        disabled={status === "submitting"}
        aria-label={variant === "icon" ? label : undefined}
        title={variant === "icon" ? label : undefined}
      >
        {status === "submitting" ? "…" : variant === "icon" ? "⟳" : label}
      </button>
      {status === "error" && <p className="billing-upload__error">{message}</p>}
      {status === "done" && result && (
        <div className="billing-upload__success">
          {result.dispatched ? (
            <p>
              Scan triggered — check the{" "}
              <a href={result.scannerActionsUrl} target="_blank" rel="noopener noreferrer">
                terratrace repo&apos;s Actions tab
              </a>{" "}
              for progress.
            </p>
          ) : (
            <>
              <p>
                Auto-trigger isn&apos;t configured yet (set <code>GITHUB_DISPATCH_TOKEN</code>) — run these from your
                machine instead:
              </p>
              <pre className="add-repo-form__steps">{result.steps.join("\n")}</pre>
            </>
          )}
        </div>
      )}
    </>
  );
}

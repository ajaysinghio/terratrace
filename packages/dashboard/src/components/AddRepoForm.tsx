"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

interface RegisterResult {
  projectId: string;
  projectName: string;
  repoUrl: string;
  dispatched: boolean;
  scannerActionsUrl: string;
  steps: string[];
}

/**
 * Registers a repo to scan — doesn't scan it itself. CodeAnalyzer needs the
 * repo checked out with tree-sitter/semgrep available, which this dashboard
 * (deployed on Vercel) doesn't have; see api/projects/route.ts. It tries to
 * auto-trigger the central scan-repo.yml GitHub Actions workflow, which does
 * have all of that — falls back to showing manual commands only if that
 * dispatch isn't configured (GITHUB_DISPATCH_TOKEN) yet. Kept to
 * Manager/Engineer views (see dashboard home page) since it's a setup
 * action, not something an executive would do.
 */
export default function AddRepoForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [repoUrl, setRepoUrl] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "done" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [result, setResult] = useState<RegisterResult | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!repoUrl.trim()) return;

    setStatus("submitting");
    setMessage(null);
    setResult(null);

    try {
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoUrl: repoUrl.trim() }),
      });
      const body = await response.json();
      if (!response.ok) {
        setStatus("error");
        setMessage(body.error ?? "Couldn't add that repo.");
        return;
      }
      setStatus("done");
      setResult(body);
      setRepoUrl("");
      router.refresh();
    } catch {
      setStatus("error");
      setMessage("Couldn't reach the server — check your connection and try again.");
    }
  }

  if (!open) {
    return (
      <div className="add-repo-form__trigger">
        <button type="button" className="button" onClick={() => setOpen(true)}>
          + Add repo
        </button>
      </div>
    );
  }

  return (
    <div className="card add-repo-form__trigger">
      <h2>Add a repo</h2>
      <p className="card__hint">
        Registers a repo to scan — this dashboard can&apos;t run the scan itself (it needs the repo checked out with
        the code analyzer available), so you&apos;ll get the exact commands to run it after adding.
      </p>
      <form onSubmit={handleSubmit} className="add-repo-form">
        <input
          ref={inputRef}
          type="url"
          required
          placeholder="https://github.com/your-org/your-repo"
          value={repoUrl}
          onChange={(e) => setRepoUrl(e.target.value)}
          disabled={status === "submitting"}
          className="add-repo-form__input"
        />
        <button type="submit" className="button button--primary" disabled={status === "submitting"}>
          {status === "submitting" ? "Adding…" : "Add repo"}
        </button>
      </form>
      {status === "error" && <p className="billing-upload__error">{message}</p>}
      {status === "done" && result && (
        <div className="billing-upload__success">
          {result.dispatched ? (
            <p>
              Added <strong>{result.projectName}</strong> and triggered the scan — check the{" "}
              <a href={result.scannerActionsUrl} target="_blank" rel="noopener noreferrer">
                terratrace repo&apos;s Actions tab
              </a>{" "}
              for progress. It&apos;ll show up as &quot;not yet scanned&quot; here until that run finishes.
            </p>
          ) : (
            <p>
              Added <strong>{result.projectName}</strong> — it&apos;ll show up as &quot;not yet scanned&quot; until
              you run the scan (auto-trigger isn&apos;t configured yet — set GITHUB_DISPATCH_TOKEN to enable it).
              Run these from your machine:
            </p>
          )}
          {!result.dispatched && <pre className="add-repo-form__steps">{result.steps.join("\n")}</pre>}
        </div>
      )}
    </div>
  );
}

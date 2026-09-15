"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import ScanButton from "./ScanButton";

interface RegisterResult {
  projectId: string;
  projectName: string;
  repoUrl: string;
}

/**
 * Registers a repo to track — a deliberately separate step from scanning it
 * (see ScanButton). Adding a repo shouldn't silently queue a CI run and LLM
 * spend the moment someone types a URL in; scanning is its own explicit
 * click, right here after registering or later as "Rescan" on the project
 * card. Kept to Manager/Engineer views (see dashboard home page) since it's
 * a setup action, not something an executive would do.
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
      <button type="button" className="button" onClick={() => setOpen(true)}>
        + Add repo
      </button>
    );
  }

  return (
    <div className="card add-repo-form__card">
      <h2>Add a repo</h2>
      <p className="card__hint">
        Registers a repo to track. Scanning is a separate step — you&apos;ll get a &quot;Scan now&quot; button right
        after adding.
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
          <p>
            Added <strong>{result.projectName}</strong> — it&apos;ll show up as &quot;not yet scanned&quot; until you
            run a scan.
          </p>
          <ScanButton projectId={result.projectId} label="Scan now" />
        </div>
      )}
    </div>
  );
}

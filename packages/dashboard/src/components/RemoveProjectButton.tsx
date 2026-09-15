"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Small "×" on a project card — stops the click from bubbling to the card's
 * own <Link> (which would navigate instead of removing). Only removes the
 * DB rows tracking this project; the target repo on GitHub is untouched.
 */
export default function RemoveProjectButton({ projectId, projectName }: { projectId: string; projectName: string }) {
  const router = useRouter();
  const [removing, setRemoving] = useState(false);

  async function handleClick(event: React.MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    if (removing) return;
    if (!window.confirm(`Remove "${projectName}" from the dashboard? This only stops tracking it here — the repo on GitHub is untouched.`)) {
      return;
    }
    setRemoving(true);
    try {
      const response = await fetch(`/api/projects/${projectId}`, { method: "DELETE" });
      if (response.ok) {
        router.refresh();
      } else {
        setRemoving(false);
      }
    } catch {
      setRemoving(false);
    }
  }

  return (
    <button
      type="button"
      className="project-card__remove"
      onClick={handleClick}
      disabled={removing}
      aria-label={`Remove ${projectName}`}
      title={`Remove ${projectName}`}
    >
      {removing ? "…" : "×"}
    </button>
  );
}

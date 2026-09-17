"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Links/unlinks a project to the AWS account a CUR upload represents (see
 * projects.billing_linked's schema comment). Unlinked projects are
 * deliberately skipped by the global CUR upload — this is the control for
 * saying "yes, this repo's billing actually runs through that account."
 */
export default function BillingLinkToggle({ projectId, linked }: { projectId: string; linked: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
    const next = event.target.checked;
    setPending(true);
    try {
      await fetch(`/api/projects/${projectId}/billing-link`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ linked: next }),
      });
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <label className="billing-link-toggle">
      <input type="checkbox" checked={linked} onChange={handleChange} disabled={pending} />
      Linked to this billing account — a CUR upload will correlate against this project
    </label>
  );
}

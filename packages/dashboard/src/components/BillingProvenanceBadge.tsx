export interface LatestBillingUpload {
  filename: string | null;
  recordCount: number;
  uploadedAt: string;
}

/**
 * Read-only provenance indicator for a project's cost/carbon numbers — CUR
 * upload itself happens org-wide on the dashboard home page (see
 * GlobalBillingUpload), since AWS issues one CUR per payer account, not per
 * repo. This just answers "where did this project's numbers come from"
 * without offering its own upload control.
 */
export default function BillingProvenanceBadge({
  latestUpload,
  hasEstimates,
}: {
  latestUpload: LatestBillingUpload | null;
  hasEstimates: boolean;
}) {
  if (latestUpload) {
    return (
      <p className="billing-provenance billing-provenance--real">
        ✓ Real CUR data — <strong>{latestUpload.filename}</strong> ({latestUpload.recordCount} usage records),
        uploaded {new Date(latestUpload.uploadedAt).toLocaleString()}
      </p>
    );
  }
  if (hasEstimates) {
    return (
      <p className="billing-provenance billing-provenance--unknown">
        ⚠ Cost/carbon estimates are from the last scan — this app can&apos;t confirm whether that used real billing
        data or the bundled sample fallback. Upload a CUR file from the dashboard home page to correlate with
        confirmed real data.
      </p>
    );
  }
  return <p className="billing-provenance billing-provenance--none">No billing data correlated yet.</p>;
}

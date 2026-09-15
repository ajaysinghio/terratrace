import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import AccountMenu from "../../components/AccountMenu";
import { isDbConfigured, dbListBillingUploads } from "../../lib/db";
import { isGithubActionsConfigured, listScanWorkflowRuns } from "../../lib/githubActions";
import { parseRole, ROLE_RANK } from "../../lib/role";
import { COOKIE_NAME, verifySessionCookieValue } from "../../lib/session";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  queued: "⏳ Queued",
  in_progress: "🔵 Running",
  completed: "✓ Completed",
};

const CONCLUSION_LABEL: Record<string, string> = {
  success: "✓ Success",
  failure: "✗ Failed",
  cancelled: "◻ Cancelled",
  skipped: "◻ Skipped",
};

function formatDuration(startedAt: string, updatedAt: string): string {
  const ms = new Date(updatedAt).getTime() - new Date(startedAt).getTime();
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

/**
 * Pipeline status/history — Manager/Engineer only, org-wide (not scoped to
 * one project, so it lives outside ProjectShell/SectionNav). Two feeds:
 * live GitHub Actions run status for scan-repo.yml (the actual CI record,
 * including in-flight and failed runs — the DB alone only ever stores each
 * project's latest scanned_at) and the org-wide CUR upload history from the
 * DB. Either feed degrades gracefully to an empty-state message if its
 * backing config (GITHUB_DISPATCH_TOKEN / DATABASE_URL) isn't set.
 */
export default async function PipelinePage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const { view } = await searchParams;
  const role = parseRole(view, "engineer");
  if (ROLE_RANK[role] < ROLE_RANK.manager) {
    redirect(`/dashboard?view=${role}`);
  }
  const session = process.env.GITHUB_OAUTH_CLIENT_ID
    ? verifySessionCookieValue((await cookies()).get(COOKIE_NAME)?.value)
    : null;

  const [runs, uploads] = await Promise.all([
    isGithubActionsConfigured() ? listScanWorkflowRuns() : Promise.resolve([]),
    isDbConfigured() ? dbListBillingUploads() : Promise.resolve([]),
  ]);

  return (
    <div className="dashboard">
      <header className="dashboard__header">
        <Link href={`/dashboard?view=${role}`} className="back-link">
          ← All projects
        </Link>
        <h1>Pipeline</h1>
        <p>Scan runs and CUR upload history across every registered project.</p>
      </header>
      <AccountMenu role={role} login={session?.login} landingHref="/pipeline" />

      <section className="card card--wide">
        <h2>Scan runs</h2>
        {!isGithubActionsConfigured() ? (
          <p className="card__hint">
            GITHUB_DISPATCH_TOKEN isn&apos;t configured, so live run status isn&apos;t available — check the{" "}
            <a
              href={`https://github.com/${process.env.GITHUB_SCANNER_REPO ?? "ajaysinghio/terratrace"}/actions`}
              target="_blank"
              rel="noopener noreferrer"
            >
              terratrace repo&apos;s Actions tab
            </a>{" "}
            directly instead.
          </p>
        ) : runs.length === 0 ? (
          <p className="empty-chart">No scan runs yet — add a repo from the dashboard home page to trigger one.</p>
        ) : (
          <div className="pipeline-table-wrap">
            <table className="pipeline-table">
              <thead>
                <tr>
                  <th>Run</th>
                  <th>Status</th>
                  <th>Started</th>
                  <th>Duration</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr key={run.id}>
                    <td>
                      <a href={run.htmlUrl} target="_blank" rel="noopener noreferrer">
                        #{run.runNumber} {run.title}
                      </a>
                    </td>
                    <td>
                      {run.status === "completed" && run.conclusion
                        ? CONCLUSION_LABEL[run.conclusion] ?? run.conclusion
                        : STATUS_LABEL[run.status] ?? run.status}
                    </td>
                    <td>{new Date(run.createdAt).toLocaleString()}</td>
                    <td>{formatDuration(run.createdAt, run.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card card--wide">
        <h2>CUR upload history</h2>
        {!isDbConfigured() ? (
          <p className="card__hint">DATABASE_URL isn&apos;t configured — no upload history to show.</p>
        ) : uploads.length === 0 ? (
          <p className="empty-chart">No CUR uploads yet — upload one from the dashboard home page.</p>
        ) : (
          <div className="pipeline-table-wrap">
            <table className="pipeline-table">
              <thead>
                <tr>
                  <th>Project</th>
                  <th>File</th>
                  <th>Records</th>
                  <th>Uploaded</th>
                  <th>Still live?</th>
                </tr>
              </thead>
              <tbody>
                {uploads.map((upload) => (
                  <tr key={upload.id}>
                    <td>{upload.projectName}</td>
                    <td>{upload.filename ?? "—"}</td>
                    <td>{upload.recordCount}</td>
                    <td>{new Date(upload.uploadedAt).toLocaleString()}</td>
                    <td>
                      {upload.findingsStillLinked > 0
                        ? `✓ ${upload.findingsStillLinked} finding(s)`
                        : "◻ superseded"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

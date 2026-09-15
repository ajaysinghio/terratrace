const SCANNER_REPO = process.env.GITHUB_SCANNER_REPO ?? "ajaysinghio/terratrace";

export interface ScanWorkflowRun {
  id: number;
  /** run-name from scan-repo.yml, e.g. "Scan owner/repo → project-id" — falls back to the workflow name if GitHub hasn't resolved it yet. */
  title: string;
  status: "queued" | "in_progress" | "completed" | string;
  conclusion: "success" | "failure" | "cancelled" | "skipped" | null;
  createdAt: string;
  updatedAt: string;
  htmlUrl: string;
  runNumber: number;
}

export function isGithubActionsConfigured(): boolean {
  return Boolean(process.env.GITHUB_DISPATCH_TOKEN);
}

/**
 * Recent scan-repo.yml runs, for the Pipeline page's live status/history —
 * this is the actual CI run record (queued/in_progress/success/failure),
 * which the DB alone can't show since it only ever stores each project's
 * latest scanned_at, not a history of attempts (including failed ones).
 * Uses the same token as the dispatch call (GITHUB_DISPATCH_TOKEN) since a
 * PAT with `repo` scope can read Actions runs as well as trigger them.
 */
export async function listScanWorkflowRuns(limit = 20): Promise<ScanWorkflowRun[]> {
  const token = process.env.GITHUB_DISPATCH_TOKEN;
  if (!token) return [];

  const response = await fetch(
    `https://api.github.com/repos/${SCANNER_REPO}/actions/workflows/scan-repo.yml/runs?per_page=${limit}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      cache: "no-store",
    }
  );
  if (!response.ok) return [];

  const body = (await response.json()) as {
    workflow_runs: Array<{
      id: number;
      display_title: string;
      name: string;
      status: string;
      conclusion: string | null;
      created_at: string;
      updated_at: string;
      html_url: string;
      run_number: number;
    }>;
  };

  return body.workflow_runs.map((run) => ({
    id: run.id,
    title: run.display_title || run.name,
    status: run.status as ScanWorkflowRun["status"],
    conclusion: run.conclusion as ScanWorkflowRun["conclusion"],
    createdAt: run.created_at,
    updatedAt: run.updated_at,
    htmlUrl: run.html_url,
    runNumber: run.run_number,
  }));
}

/**
 * Project ids with a scan-repo.yml run currently queued or in progress —
 * used to disable a project's Scan/Rescan button for the run's actual
 * duration, not just the moment it takes to dispatch it. Parses scan-repo.yml's
 * run-name ("Scan owner/repo → project-id") since the workflow_dispatch
 * inputs themselves aren't exposed on the runs list API.
 */
export async function getInProgressScanProjectIds(): Promise<Set<string>> {
  const runs = await listScanWorkflowRuns(20);
  const ids = new Set<string>();
  for (const run of runs) {
    if (run.status !== "queued" && run.status !== "in_progress") continue;
    const match = run.title.match(/→\s*(\S+)/);
    if (match) ids.add(match[1]);
  }
  return ids;
}

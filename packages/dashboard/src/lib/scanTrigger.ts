export const SCANNER_REPO = process.env.GITHUB_SCANNER_REPO ?? "ajaysinghio/terratrace";

export function parseGithubRepoUrl(input: string): { owner: string; repo: string; url: string } | null {
  const trimmed = input.trim();
  const match = trimmed.match(/^https?:\/\/github\.com\/([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/);
  if (!match) return null;
  const [, owner, repo] = match;
  return { owner, repo, url: `https://github.com/${owner}/${repo}` };
}

/**
 * Fires .github/workflows/scan-repo.yml in the terratrace repo via GitHub's
 * workflow_dispatch API — the actual scan runs there (checked-out target
 * repo, semgrep, ANTHROPIC_API_KEY, DATABASE_URL all centralized in that one
 * workflow; see its header comment). Returns true if the dispatch call
 * succeeded, false if it's not configured or GitHub rejected it. Used by
 * both the first scan (after registering a repo) and a rescan of an
 * already-registered one — same workflow either way, scan-repo.yml doesn't
 * distinguish "first" from "again".
 */
export async function triggerScanWorkflow(params: {
  repoOwner: string;
  repoName: string;
  projectId: string;
  projectName: string;
}): Promise<boolean> {
  const token = process.env.GITHUB_DISPATCH_TOKEN;
  if (!token) return false;

  try {
    const response = await fetch(
      `https://api.github.com/repos/${SCANNER_REPO}/actions/workflows/scan-repo.yml/dispatches`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        body: JSON.stringify({
          ref: "main",
          inputs: {
            repo_owner: params.repoOwner,
            repo_name: params.repoName,
            project_id: params.projectId,
            project_name: params.projectName,
          },
        }),
      }
    );
    return response.ok;
  } catch {
    return false;
  }
}

export function manualScanSteps(params: { repoUrl: string; repoName: string; projectId: string; projectName: string }): string[] {
  // fast-glob (the scan's file matcher) and git-remote detection both
  // resolve relative to process.cwd(), so the scan has to actually run with
  // the target repo as cwd — `pnpm --filter` can't do that since it needs
  // to run inside the terratrace workspace, hence pointing node at the
  // built CLI directly.
  return [
    `git clone ${params.repoUrl}.git && cd ${params.repoName}`,
    `node <path-to-terratrace>/packages/cli/dist/index.js "**/*.{py,java,tf}" ${params.projectId} "${params.projectName}"`,
    // The CLI writes ./scan-output/<id>.json relative to its cwd (the repo
    // just cloned above, not terratrace) — copy it over before importing.
    `cp scan-output/${params.projectId}.json <path-to-terratrace>/scan-output/`,
    `cd <path-to-terratrace> && node packages/dashboard/scripts/import-scan-output.mjs ${params.projectId}.json`,
  ];
}

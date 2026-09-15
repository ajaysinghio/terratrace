// Opens real GitHub PRs for findings that already have a validated
// suggestedFixDiff (computed during the scan step — no LLM call here).
// Run by .github/workflows/remediate-repo.yml, a deliberately separate,
// on-demand workflow from scan-repo.yml: a routine scan must never write to
// a target repo, but a human explicitly clicking "Create PR" is asking for
// exactly that.
//
// Applies each diff via GitHub's Contents/Git Data API (no local checkout
// needed — see commitPatchedFile below), mirroring
// packages/github-action/src/index.ts's maybeOpenFixPr, adapted to run
// standalone against an arbitrary target repo instead of the repo the
// Action is checked out in.
//
// Run with: node scripts/remediate.mjs <projectId> <repoOwner> <repoName> [findingId]
import { neon } from "@neondatabase/serverless";
import { Octokit } from "@octokit/rest";
import { applyPatch } from "diff";

const WONTFIX_LABEL = "terratrace:wontfix";

function isNotFoundError(err) {
  return typeof err === "object" && err !== null && err.status === 404;
}

function isAlreadyExistsError(err) {
  return typeof err === "object" && err !== null && err.status === 422;
}

async function findSkipReason(octokit, owner, repo, label) {
  const open = await octokit.rest.issues.listForRepo({ owner, repo, state: "open", labels: label, per_page: 5 });
  const openPr = open.data.find((issue) => issue.pull_request !== undefined);
  if (openPr) return { number: openPr.number, reason: "open" };

  const closedWontfix = await octokit.rest.issues.listForRepo({
    owner,
    repo,
    state: "closed",
    labels: `${label},${WONTFIX_LABEL}`,
    per_page: 5,
  });
  const closedPr = closedWontfix.data.find((issue) => issue.pull_request !== undefined);
  if (closedPr) return { number: closedPr.number, reason: "wontfix" };

  return undefined;
}

async function ensureLabel(octokit, owner, repo, label) {
  try {
    await octokit.rest.issues.createLabel({ owner, repo, name: label, color: "1f883d", description: "TerraTrace fix PR — idempotency key" });
  } catch (err) {
    if (!isAlreadyExistsError(err)) throw err;
  }
}

async function ensureBranch(octokit, owner, repo, branch, baseSha) {
  try {
    await octokit.rest.git.getRef({ owner, repo, ref: `heads/${branch}` });
  } catch (err) {
    if (!isNotFoundError(err)) throw err;
    await octokit.rest.git.createRef({ owner, repo, ref: `refs/heads/${branch}`, sha: baseSha });
  }
}

async function commitPatchedFile(octokit, { owner, repo, branch, filePath, patchedContent, ruleId }) {
  let existingSha;
  try {
    const { data } = await octokit.rest.repos.getContent({ owner, repo, path: filePath, ref: branch });
    if (!Array.isArray(data) && "sha" in data) existingSha = data.sha;
  } catch (err) {
    if (!isNotFoundError(err)) throw err;
  }

  await octokit.rest.repos.createOrUpdateFileContents({
    owner,
    repo,
    path: filePath,
    branch,
    message: `terratrace: fix ${ruleId} in ${filePath}`,
    content: Buffer.from(patchedContent, "utf-8").toString("base64"),
    sha: existingSha,
  });
}

function buildPrBody(finding) {
  return [
    `### TerraTrace fix: \`${finding.rule_id}\` at \`${finding.file_path}\``,
    "",
    finding.message,
    "",
    "This diff was validated during the scan (applied in-memory and re-analyzed — the finding cleared, no new finding appeared) before being stored; opening this PR didn't call an LLM again.",
    "",
    `_Not the fix you want? Close this PR and add the \`${WONTFIX_LABEL}\` label — TerraTrace won't re-open a PR for this finding on subsequent remediation runs._`,
    "",
    `<!-- terratrace-id: ${finding.idempotency_key ?? finding.id} -->`,
  ].join("\n");
}

async function main() {
  const [projectId, repoOwner, repoName, findingId] = process.argv.slice(2);
  if (!projectId || !repoOwner || !repoName) {
    console.error("Usage: node remediate.mjs <projectId> <repoOwner> <repoName> [findingId]");
    process.exit(1);
  }

  const databaseUrl = process.env.DATABASE_URL;
  const token = process.env.GITHUB_TOKEN;
  if (!databaseUrl) throw new Error("DATABASE_URL is not set.");
  if (!token) throw new Error("GITHUB_TOKEN is not set.");

  const sql = neon(databaseUrl);
  const octokit = new Octokit({ auth: token });

  const candidates = findingId
    ? await sql`
        select id, rule_id, file_path, message, suggested_fix_diff, idempotency_key
        from findings
        where project_id = ${projectId} and id = ${findingId}
          and suggested_fix_diff is not null and pr_url is null and remediated_at is null
      `
    : await sql`
        select id, rule_id, file_path, message, suggested_fix_diff, idempotency_key
        from findings
        where project_id = ${projectId}
          and suggested_fix_diff is not null and pr_url is null and remediated_at is null
      `;

  if (candidates.length === 0) {
    console.log(`No remediation candidates for project "${projectId}"${findingId ? ` (finding ${findingId})` : ""}.`);
    return;
  }

  const { data: repoData } = await octokit.rest.repos.get({ owner: repoOwner, repo: repoName });
  const defaultBranch = repoData.default_branch;
  const { data: refData } = await octokit.rest.git.getRef({ owner: repoOwner, repo: repoName, ref: `heads/${defaultBranch}` });
  const baseSha = refData.object.sha;

  let opened = 0;
  let skippedExisting = 0;
  let skippedWontfix = 0;
  let failed = 0;

  for (const finding of candidates) {
    const key = finding.idempotency_key ?? finding.id;
    const label = `terratrace:${key}`;
    const branch = `terratrace/${key}`;

    const skip = await findSkipReason(octokit, repoOwner, repoName, label);
    if (skip?.reason === "open") {
      console.log(`Existing fix PR #${skip.number} already tracks ${finding.file_path} (label ${label}) — leaving it alone.`);
      // A PR already exists on GitHub but our DB doesn't know its URL yet
      // (e.g. opened by an earlier run that crashed before writing back) —
      // backfill it so the dashboard shows it as in progress.
      const { data: pr } = await octokit.rest.pulls.get({ owner: repoOwner, repo: repoName, pull_number: skip.number });
      await sql`update findings set pr_url = ${pr.html_url}, pr_opened_at = coalesce(pr_opened_at, now()) where project_id = ${projectId} and id = ${finding.id}`;
      skippedExisting++;
      continue;
    }
    if (skip?.reason === "wontfix") {
      console.log(`Closed fix PR #${skip.number} for ${finding.file_path} is labelled '${WONTFIX_LABEL}' — not re-opening.`);
      skippedWontfix++;
      continue;
    }

    let original;
    try {
      const { data } = await octokit.rest.repos.getContent({ owner: repoOwner, repo: repoName, path: finding.file_path, ref: defaultBranch });
      if (Array.isArray(data) || !("content" in data)) throw new Error("not a file");
      original = Buffer.from(data.content, "base64").toString("utf-8");
    } catch (err) {
      console.error(`Couldn't fetch ${finding.file_path} from ${repoOwner}/${repoName}: ${err instanceof Error ? err.message : err}`);
      failed++;
      continue;
    }

    const patched = applyPatch(original, finding.suggested_fix_diff);
    if (typeof patched !== "string") {
      console.error(`Patch for ${finding.file_path} (${finding.rule_id}) no longer applies cleanly — the file has likely changed since the scan. Skipping.`);
      failed++;
      continue;
    }

    try {
      await ensureLabel(octokit, repoOwner, repoName, label);
      await ensureLabel(octokit, repoOwner, repoName, WONTFIX_LABEL);
      await ensureBranch(octokit, repoOwner, repoName, branch, baseSha);
      await commitPatchedFile(octokit, {
        owner: repoOwner,
        repo: repoName,
        branch,
        filePath: finding.file_path,
        patchedContent: patched,
        ruleId: finding.rule_id,
      });

      const { data: pr } = await octokit.rest.pulls.create({
        owner: repoOwner,
        repo: repoName,
        head: branch,
        base: defaultBranch,
        title: `terratrace: fix ${finding.rule_id} in ${finding.file_path}`,
        body: buildPrBody(finding),
      });
      await octokit.rest.issues.addLabels({ owner: repoOwner, repo: repoName, issue_number: pr.number, labels: [label] });

      await sql`update findings set pr_url = ${pr.html_url}, pr_opened_at = now() where project_id = ${projectId} and id = ${finding.id}`;
      console.log(`Opened fix PR #${pr.number} for ${finding.file_path} — ${pr.html_url}`);
      opened++;
    } catch (err) {
      console.error(`Failed to open a PR for ${finding.file_path}: ${err instanceof Error ? err.message : err}`);
      failed++;
    }
  }

  console.log(`Done. Opened ${opened}, existing ${skippedExisting}, wontfix ${skippedWontfix}, failed ${failed}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

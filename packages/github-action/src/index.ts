import { readFile } from "node:fs/promises";
import * as core from "@actions/core";
import * as github from "@actions/github";
import { applyPatch } from "diff";
import fg from "fast-glob";
import {
  PythonAnalyzer,
  AnthropicProvider,
  recommendFinding,
  type CodeFinding,
  type Recommendation,
} from "@terratrace/core";

interface FindingWithExplanation {
  finding: CodeFinding;
  explanation: string;
}

type Octokit = ReturnType<typeof github.getOctokit>;

const FIX_PR_EVENTS = new Set(["push", "schedule", "workflow_dispatch"]);
const SCAN_GLOB = "**/*.py";
const SCAN_IGNORE = ["**/node_modules/**", "**/.venv/**", "**/venv/**", "**/dist/**", "**/lib/**"];

async function run(): Promise<void> {
  const githubToken = core.getInput("github-token", { required: true });
  const anthropicApiKey = core.getInput("anthropic-api-key", { required: true });

  const context = github.context;
  const octokit = github.getOctokit(githubToken);
  const analyzer = new PythonAnalyzer();
  const llm = new AnthropicProvider(undefined, anthropicApiKey);

  if (context.eventName === "pull_request") {
    await runPullRequestFlow(octokit, analyzer, llm);
    return;
  }

  if (FIX_PR_EVENTS.has(context.eventName)) {
    await runFixPrFlow(octokit, analyzer, llm);
    return;
  }

  core.info(
    `terratrace: event ${context.eventName} is not one of pull_request/push/schedule/workflow_dispatch, skipping.`,
  );
}

async function runPullRequestFlow(
  octokit: Octokit,
  analyzer: PythonAnalyzer,
  llm: AnthropicProvider,
): Promise<void> {
  const context = github.context;
  const pullRequest = context.payload.pull_request;
  if (!pullRequest) {
    core.info("terratrace: no pull_request payload found, skipping.");
    return;
  }

  const { owner, repo } = context.repo;
  const prNumber = pullRequest.number;

  const { data: changedFiles } = await octokit.rest.pulls.listFiles({
    owner,
    repo,
    pull_number: prNumber,
  });

  const pythonFiles = changedFiles.filter(
    (file) => file.filename.endsWith(".py") && file.status !== "removed",
  );

  const results: FindingWithExplanation[] = [];

  for (const file of pythonFiles) {
    const sourceCode = await readFile(file.filename, "utf-8");
    const findings = await analyzer.analyzeFile(file.filename, sourceCode);

    for (const finding of findings) {
      const explanation = await llm.explainFinding({
        codeFinding: finding,
        gitContext: { prNumber, diffSnippet: file.patch },
      });
      results.push({ finding, explanation });
    }
  }

  if (results.length === 0) {
    core.info("terratrace: no findings in this PR's Python changes.");
    return;
  }

  const body = [
    "### 🌱 TerraTrace findings",
    "",
    ...results.map(
      ({ finding, explanation }) =>
        `**${finding.filePath}:${finding.startLine}** — \`${finding.ruleId}\` (${finding.severity})\n> ${explanation}`,
    ),
    "",
    "_Fix PRs are opened by the separate push/schedule trigger, not by this PR-scoped run._",
  ].join("\n\n");

  await octokit.rest.issues.createComment({
    owner,
    repo,
    issue_number: prNumber,
    body,
  });
}

async function runFixPrFlow(
  octokit: Octokit,
  analyzer: PythonAnalyzer,
  llm: AnthropicProvider,
): Promise<void> {
  const context = github.context;
  const { owner, repo } = context.repo;

  const { data: repoInfo } = await octokit.rest.repos.get({ owner, repo });
  const defaultBranch = repoInfo.default_branch;
  const { data: baseRef } = await octokit.rest.git.getRef({
    owner,
    repo,
    ref: `heads/${defaultBranch}`,
  });
  const baseSha = baseRef.object.sha;

  const files = await fg(SCAN_GLOB, { ignore: SCAN_IGNORE, dot: false });
  core.info(`terratrace: fix-pr flow scanning ${files.length} .py file(s).`);

  let opened = 0;
  let skippedExisting = 0;
  let skippedInvalid = 0;

  for (const filePath of files) {
    const sourceCode = await readFile(filePath, "utf-8");
    const findings = await analyzer.analyzeFile(filePath, sourceCode);
    if (findings.length === 0) continue;

    for (const finding of findings) {
      let recommendation: Recommendation;
      try {
        recommendation = await recommendFinding({
          finding,
          sourceCode,
          analyzer,
          llm,
          evidence: { codeFinding: finding },
        });
      } catch (err) {
        core.warning(
          `terratrace: recommendFinding threw for ${finding.filePath}:${finding.startLine}: ${errText(err)}`,
        );
        skippedInvalid++;
        continue;
      }

      if (!recommendation.validation.ok) {
        core.info(
          `terratrace: skipping ${finding.filePath}:${finding.startLine} — validation failed (${recommendation.validation.reason}) after ${recommendation.validation.attempts} attempt(s).`,
        );
        skippedInvalid++;
        continue;
      }

      const outcome = await maybeOpenFixPr({
        octokit,
        owner,
        repo,
        defaultBranch,
        baseSha,
        sourceCode,
        recommendation,
        llm,
      });

      if (outcome === "opened") opened++;
      else if (outcome === "existing") skippedExisting++;
      else skippedInvalid++;
    }
  }

  core.info(
    `terratrace: fix-pr flow done — opened ${opened}, skipped-existing ${skippedExisting}, skipped-invalid ${skippedInvalid}.`,
  );
}

interface OpenFixPrArgs {
  octokit: Octokit;
  owner: string;
  repo: string;
  defaultBranch: string;
  baseSha: string;
  sourceCode: string;
  recommendation: Recommendation;
  llm: AnthropicProvider;
}

async function maybeOpenFixPr(args: OpenFixPrArgs): Promise<"opened" | "existing" | "failed"> {
  const { octokit, owner, repo, defaultBranch, baseSha, sourceCode, recommendation, llm } = args;
  const key = recommendation.idempotencyKey;
  const label = `terratrace:${key}`;
  const branch = `terratrace/${key}`;

  const existing = await findOpenPrByLabel(octokit, owner, repo, label);
  if (existing) {
    core.info(
      `terratrace: existing fix PR #${existing.number} already tracks ${recommendation.finding.filePath}:${recommendation.finding.startLine} (label ${label}); leaving it alone.`,
    );
    return "existing";
  }

  const patched = applyPatchOrThrow(sourceCode, recommendation.fixDiff);
  if (patched === null) {
    core.warning(
      `terratrace: patched source could not be reconstructed for ${recommendation.finding.filePath}; skipping PR.`,
    );
    return "failed";
  }

  await ensureLabel(octokit, owner, repo, label);
  await ensureBranch(octokit, owner, repo, branch, baseSha);
  await commitPatchedFile(octokit, {
    owner,
    repo,
    branch,
    filePath: recommendation.finding.filePath,
    patchedContent: patched,
    ruleId: recommendation.finding.ruleId,
  });

  let explanation = recommendation.explanation;
  if (!explanation) {
    try {
      explanation = await llm.explainFinding({ codeFinding: recommendation.finding });
    } catch (err) {
      core.warning(`terratrace: explainFinding failed for PR body: ${errText(err)}`);
    }
  }

  const body = buildPrBody(recommendation, explanation);

  const { data: pr } = await octokit.rest.pulls.create({
    owner,
    repo,
    head: branch,
    base: defaultBranch,
    title: `terratrace: fix ${recommendation.finding.ruleId} in ${recommendation.finding.filePath}`,
    body,
  });

  await octokit.rest.issues.addLabels({
    owner,
    repo,
    issue_number: pr.number,
    labels: [label],
  });

  core.info(`terratrace: opened fix PR #${pr.number} for ${recommendation.finding.filePath}.`);
  return "opened";
}

async function findOpenPrByLabel(
  octokit: Octokit,
  owner: string,
  repo: string,
  label: string,
): Promise<{ number: number } | undefined> {
  const { data: issues } = await octokit.rest.issues.listForRepo({
    owner,
    repo,
    state: "open",
    labels: label,
    per_page: 5,
  });
  const pr = issues.find((issue) => issue.pull_request !== undefined);
  return pr ? { number: pr.number } : undefined;
}

async function ensureLabel(
  octokit: Octokit,
  owner: string,
  repo: string,
  label: string,
): Promise<void> {
  try {
    await octokit.rest.issues.createLabel({
      owner,
      repo,
      name: label,
      color: "1f883d",
      description: "TerraTrace fix PR — idempotency key",
    });
  } catch (err) {
    if (!isAlreadyExistsError(err)) throw err;
  }
}

async function ensureBranch(
  octokit: Octokit,
  owner: string,
  repo: string,
  branch: string,
  baseSha: string,
): Promise<void> {
  try {
    await octokit.rest.git.getRef({ owner, repo, ref: `heads/${branch}` });
  } catch (err) {
    if (!isNotFoundError(err)) throw err;
    await octokit.rest.git.createRef({
      owner,
      repo,
      ref: `refs/heads/${branch}`,
      sha: baseSha,
    });
  }
}

interface CommitArgs {
  owner: string;
  repo: string;
  branch: string;
  filePath: string;
  patchedContent: string;
  ruleId: string;
}

async function commitPatchedFile(octokit: Octokit, args: CommitArgs): Promise<void> {
  const { owner, repo, branch, filePath, patchedContent, ruleId } = args;

  let existingSha: string | undefined;
  try {
    const { data } = await octokit.rest.repos.getContent({
      owner,
      repo,
      path: filePath,
      ref: branch,
    });
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

function buildPrBody(recommendation: Recommendation, explanation?: string): string {
  const { finding, validation, idempotencyKey } = recommendation;
  const lines = [
    `### TerraTrace fix: \`${finding.ruleId}\` at \`${finding.filePath}:${finding.startLine}\``,
    "",
    explanation ?? "_(no explanation available)_",
    "",
    `**Validation**: OK after ${validation.attempts} attempt(s) — the diff applies cleanly, the finding is gone after re-analysis, and no new findings appeared.`,
    "",
    "<details><summary>Original finding</summary>",
    "",
    "```",
    finding.snippet,
    "```",
    "",
    "</details>",
    "",
    `<!-- terratrace-id: ${idempotencyKey} -->`,
  ];
  return lines.join("\n");
}

function applyPatchOrThrow(source: string, diff: string): string | null {
  const result = applyPatch(source, diff);
  return typeof result === "string" ? result : null;
}

function isNotFoundError(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { status?: number }).status === 404;
}

function isAlreadyExistsError(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { status?: number }).status === 422;
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

run().catch((error) => {
  core.setFailed(error instanceof Error ? error.message : String(error));
});

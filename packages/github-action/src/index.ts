import { readFile } from "node:fs/promises";
import * as core from "@actions/core";
import * as github from "@actions/github";
import { PythonAnalyzer, AnthropicProvider, type CodeFinding } from "@terratrace/core";

interface FindingWithExplanation {
  finding: CodeFinding;
  explanation: string;
}

async function run(): Promise<void> {
  const githubToken = core.getInput("github-token", { required: true });
  const anthropicApiKey = core.getInput("anthropic-api-key", { required: true });

  const context = github.context;
  if (context.eventName !== "pull_request") {
    core.info("terratrace: not a pull_request event, skipping.");
    return;
  }

  const pullRequest = context.payload.pull_request;
  if (!pullRequest) {
    core.info("terratrace: no pull_request payload found, skipping.");
    return;
  }

  const octokit = github.getOctokit(githubToken);
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

  const analyzer = new PythonAnalyzer();
  const llm = new AnthropicProvider(undefined, anthropicApiKey);

  const results: FindingWithExplanation[] = [];

  for (const file of pythonFiles) {
    // Assumes the workflow already checked out the PR head (actions/checkout
    // with ref: pull_request head sha) before this action runs.
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
  ].join("\n\n");

  await octokit.rest.issues.createComment({
    owner,
    repo,
    issue_number: prNumber,
    body,
  });
}

run().catch((error) => {
  core.setFailed(error instanceof Error ? error.message : String(error));
});

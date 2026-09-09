import { GITHUB_REPO_NAME, GITHUB_REPO_OWNER } from "../../lib/authConfig";

export default async function AccessDeniedPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const { reason } = await searchParams;
  const message =
    reason === "no-access"
      ? `Your GitHub account doesn't have access to ${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}.`
      : "Sign-in failed — please try again.";

  return (
    <main className="empty-state">
      <h1>🌱 TerraTrace</h1>
      <p>{message}</p>
      <p>
        Ask a maintainer to add you as a collaborator on{" "}
        <code>
          {GITHUB_REPO_OWNER}/{GITHUB_REPO_NAME}
        </code>
        , then <a href="/api/auth/login">sign in again</a>.
      </p>
    </main>
  );
}

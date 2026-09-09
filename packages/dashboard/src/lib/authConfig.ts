// The repo the dashboard gates access against — collaborators here (any
// permission level: read/triage/write/maintain/admin) are the "authorized
// users." Overridable via env for anyone forking this deploy against a
// different repo; defaults to this project's own private repo.
export const GITHUB_REPO_OWNER = process.env.GITHUB_REPO_OWNER ?? "ajaysinghio";
export const GITHUB_REPO_NAME = process.env.GITHUB_REPO_NAME ?? "terratrace";

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

export function appUrl(): string {
  return process.env.APP_URL ?? "http://localhost:3000";
}

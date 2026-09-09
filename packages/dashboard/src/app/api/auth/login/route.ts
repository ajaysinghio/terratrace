import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { appUrl, requireEnv } from "../../../../lib/authConfig";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const state = randomBytes(16).toString("hex");
  const redirectTo = new URL(request.url).searchParams.get("redirectTo") ?? "/";

  const authorizeUrl = new URL("https://github.com/login/oauth/authorize");
  authorizeUrl.searchParams.set("client_id", requireEnv("GITHUB_OAUTH_CLIENT_ID"));
  authorizeUrl.searchParams.set("redirect_uri", `${appUrl()}/api/auth/callback`);
  // `repo` (not `public_repo`) is required to check collaborator access on a
  // private repo — this only ever reads the signed-in user's own permission
  // level on GITHUB_REPO_OWNER/GITHUB_REPO_NAME, nothing is written.
  authorizeUrl.searchParams.set("scope", "repo");
  authorizeUrl.searchParams.set("state", state);

  const response = NextResponse.redirect(authorizeUrl);
  response.cookies.set("tt_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 10,
    path: "/",
  });
  response.cookies.set("tt_redirect_to", redirectTo, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 10,
    path: "/",
  });
  return response;
}

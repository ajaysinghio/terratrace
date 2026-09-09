import { NextResponse } from "next/server";
import { appUrl, GITHUB_REPO_NAME, GITHUB_REPO_OWNER, requireEnv } from "../../../../lib/authConfig";
import { COOKIE_NAME, createSessionCookieValue } from "../../../../lib/session";

export const dynamic = "force-dynamic";

function clearOauthCookies(response: NextResponse) {
  response.cookies.delete("tt_oauth_state");
  response.cookies.delete("tt_redirect_to");
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieState = request.headers
    .get("cookie")
    ?.split("; ")
    .find((c) => c.startsWith("tt_oauth_state="))
    ?.split("=")[1];
  const redirectTo =
    request.headers
      .get("cookie")
      ?.split("; ")
      .find((c) => c.startsWith("tt_redirect_to="))
      ?.split("=")[1] ?? "/";

  if (!code || !state || !cookieState || state !== cookieState) {
    const response = NextResponse.redirect(new URL("/access-denied?reason=state", appUrl()));
    clearOauthCookies(response);
    return response;
  }

  const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_id: requireEnv("GITHUB_OAUTH_CLIENT_ID"),
      client_secret: requireEnv("GITHUB_OAUTH_CLIENT_SECRET"),
      code,
      redirect_uri: `${appUrl()}/api/auth/callback`,
    }),
  });
  const tokenData = (await tokenResponse.json()) as { access_token?: string };
  if (!tokenData.access_token) {
    const response = NextResponse.redirect(new URL("/access-denied?reason=token", appUrl()));
    clearOauthCookies(response);
    return response;
  }

  const userResponse = await fetch("https://api.github.com/user", {
    headers: { Authorization: `Bearer ${tokenData.access_token}`, Accept: "application/vnd.github+json" },
  });
  if (!userResponse.ok) {
    const response = NextResponse.redirect(new URL("/access-denied?reason=user", appUrl()));
    clearOauthCookies(response);
    return response;
  }
  const user = (await userResponse.json()) as { login: string };

  // A 200 here means the signed-in user has at least read access to this
  // *private* repo — for a private repo that's exactly "is a collaborator."
  // (This check is meaningless as an access gate on a public repo, since
  // GitHub grants every user read access there by definition.)
  const repoResponse = await fetch(`https://api.github.com/repos/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}`, {
    headers: { Authorization: `Bearer ${tokenData.access_token}`, Accept: "application/vnd.github+json" },
  });

  if (!repoResponse.ok) {
    const response = NextResponse.redirect(new URL("/access-denied?reason=no-access", appUrl()));
    clearOauthCookies(response);
    return response;
  }

  const response = NextResponse.redirect(new URL(redirectTo, appUrl()));
  response.cookies.set(COOKIE_NAME, createSessionCookieValue(user.login), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 7,
    path: "/",
  });
  clearOauthCookies(response);
  return response;
}

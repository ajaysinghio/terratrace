import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { COOKIE_NAME, verifySessionCookieValue } from "./lib/session";

// Gates every page behind "is this GitHub user a collaborator on the repo"
// (see api/auth/callback/route.ts). Excludes /api/auth/* (the sign-in flow
// itself), /access-denied (must be reachable while signed out), and Next's
// own static/image assets and the tab icon (icon.svg must load while signed
// out too) — see the matcher's negative lookahead below.
export function proxy(request: NextRequest) {
  // No OAuth app configured (e.g. local dev) — behave exactly as before this
  // feature existed rather than forcing every contributor through GitHub
  // OAuth just to run `pnpm dev:dashboard`. The gate only activates once a
  // deploy sets GITHUB_OAUTH_CLIENT_ID (see README's Vercel deploy notes).
  if (!process.env.GITHUB_OAUTH_CLIENT_ID) return NextResponse.next();

  // "/" is the public landing page — it does its own session check to
  // redirect an already-signed-in visitor straight to /dashboard, and it's
  // also where /api/auth/logout sends people, so it must stay reachable
  // while signed out.
  if (request.nextUrl.pathname === "/") return NextResponse.next();

  const session = verifySessionCookieValue(request.cookies.get(COOKIE_NAME)?.value);
  if (session) return NextResponse.next();

  const loginUrl = new URL("/api/auth/login", request.url);
  loginUrl.searchParams.set("redirectTo", request.nextUrl.pathname + request.nextUrl.search);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!api/auth|access-denied|_next/static|_next/image|favicon.ico|icon.svg).*)"],
};

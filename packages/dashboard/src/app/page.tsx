import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_NAME, verifySessionCookieValue } from "../lib/session";

// Public landing page — reachable without a session. Local dev never shows
// it: with no GITHUB_OAUTH_CLIENT_ID configured, the gate in proxy.ts is a
// no-op anyway, so this just forwards straight to /dashboard, matching how
// the app behaved before the auth gate existed. On a hosted deploy, this is
// also where /api/auth/logout redirects back to, so signing out lands
// somewhere sane instead of bouncing straight into another GitHub login.
export const dynamic = "force-dynamic";

export default async function LandingPage() {
  if (!process.env.GITHUB_OAUTH_CLIENT_ID) {
    redirect("/dashboard");
  }

  const session = verifySessionCookieValue((await cookies()).get(COOKIE_NAME)?.value);
  if (session) {
    redirect("/dashboard");
  }

  return (
    <main className="landing">
      <div className="landing__card">
        <h1>🌱 TerraTrace</h1>
        <p className="landing__tagline">
          Carbon and cost impact scanning for your codebase — correlated with real AWS billing, not guesswork.
        </p>
        <a href="/api/auth/login?redirectTo=/dashboard" className="landing__cta">
          Sign in with GitHub
        </a>
        <p className="landing__hint">Access is limited to collaborators on this repo.</p>
      </div>
    </main>
  );
}

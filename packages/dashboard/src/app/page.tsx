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

const FEATURES = [
  {
    icon: "🔍",
    title: "Scan",
    body: "Detects N+1 queries, oversized instances, missing lifecycle policies, and more across Python, Java, and Terraform.",
  },
  {
    icon: "💵",
    title: "Correlate",
    body: "Ties every finding to real AWS billing usage — impact measured in $/mo and kgCO2e, not guesswork.",
  },
  {
    icon: "🛠️",
    title: "Fix",
    body: "Generates a validated fix diff grounded in your actual source, ready to open as a pull request.",
  },
];

export default async function LandingPage({
  searchParams,
}: {
  searchParams: Promise<{ preview?: string }>;
}) {
  const { preview } = await searchParams;

  // ?preview=1 shows this page even where it wouldn't normally render (no
  // OAuth configured, or an active session) — purely so it can be reviewed
  // locally without spinning up a real GitHub OAuth App first.
  if (preview !== "1") {
    if (!process.env.GITHUB_OAUTH_CLIENT_ID) {
      redirect("/dashboard");
    }
    const session = verifySessionCookieValue((await cookies()).get(COOKIE_NAME)?.value);
    if (session) {
      redirect("/dashboard");
    }
  }

  return (
    <main className="landing">
      <div className="landing__bg-icons" aria-hidden="true">
        <span className="landing__bg-icon" style={{ top: "4%", left: "2%", fontSize: "9rem", rotate: "-12deg" }}>
          🏭
        </span>
        <span className="landing__bg-icon" style={{ top: "10%", right: "0%", fontSize: "8rem", rotate: "9deg" }}>
          ☁️
        </span>
        <span
          className="landing__bg-icon"
          style={{ bottom: "16%", left: "4%", fontSize: "7.5rem", rotate: "6deg" }}
        >
          💵
        </span>
        <span
          className="landing__bg-icon"
          style={{ bottom: "4%", right: "6%", fontSize: "8.5rem", rotate: "-8deg" }}
        >
          🌳
        </span>
        <span className="landing__bg-icon" style={{ top: "44%", left: "-2%", fontSize: "7rem", rotate: "-5deg" }}>
          ⚡
        </span>
        <span className="landing__bg-icon" style={{ top: "38%", right: "-2%", fontSize: "7rem", rotate: "12deg" }}>
          📊
        </span>
        <span
          className="landing__bg-icon"
          style={{ bottom: "38%", left: "40%", fontSize: "6rem", rotate: "4deg" }}
        >
          🌍
        </span>
      </div>

      <nav className="landing__nav">
        <span className="landing__brand">🌱 TerraTrace</span>
        <div className="landing__nav-signin">
          <a href="/api/auth/login?redirectTo=/dashboard" className="landing__cta">
            Sign in with GitHub
          </a>
          <p className="landing__hint">Collaborators only</p>
        </div>
      </nav>

      <section className="landing__hero">
        <div className="landing__eyebrow">Carbon &amp; cost impact scanning</div>
        <h1 className="landing__headline">See what your code costs — in dollars and carbon.</h1>
        <p className="landing__tagline">
          TerraTrace scans your codebase for cost- and carbon-inefficient patterns, correlates every finding with
          real AWS billing data, and generates a validated fix — not a generic suggestion.
        </p>
      </section>

      <section className="landing__features">
        {FEATURES.map((f) => (
          <div key={f.title} className="landing__feature">
            <div className="landing__feature-icon">{f.icon}</div>
            <h2>{f.title}</h2>
            <p>{f.body}</p>
          </div>
        ))}
      </section>
    </main>
  );
}

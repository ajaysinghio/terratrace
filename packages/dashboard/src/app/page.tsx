import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import LandingIcon, { type LandingIconName } from "../components/LandingIcon";
import { COOKIE_NAME, verifySessionCookieValue } from "../lib/session";

// Public landing page — reachable without a session. Local dev never shows
// it: with no GITHUB_OAUTH_CLIENT_ID configured, the gate in proxy.ts is a
// no-op anyway, so this just forwards straight to /dashboard, matching how
// the app behaved before the auth gate existed. On a hosted deploy, this is
// also where /api/auth/logout redirects back to, so signing out lands
// somewhere sane instead of bouncing straight into another GitHub login.
export const dynamic = "force-dynamic";

const INPUT_STEPS = [
  {
    step: 1,
    icon: "search" as LandingIconName,
    title: "Scan",
    tag: "Repeatable",
    body: "Finds the patterns that waste money and energy.",
  },
  {
    step: 2,
    icon: "dollar" as LandingIconName,
    title: "Correlate",
    tag: "Auditable",
    body: "Turns each finding into dollars and carbon from your AWS bill.",
  },
];

const CORE_STEPS = ["Explain", "Fix", "Re-scan", "Open PR"];

const CORE_CHIPS = ["Evidence-grounded", "Checked before offered", "You trigger PRs"];

const BG_ICONS: Array<{ name: LandingIconName; style: React.CSSProperties }> = [
  { name: "factory", style: { top: "4%", left: "2%", width: "9rem", height: "9rem", rotate: "-8deg" } },
  { name: "cloud", style: { top: "10%", right: "0%", width: "8rem", height: "8rem", rotate: "6deg" } },
  { name: "dollar", style: { bottom: "16%", left: "4%", width: "7rem", height: "7rem", rotate: "6deg" } },
  { name: "sprout", style: { bottom: "4%", right: "6%", width: "8.5rem", height: "8.5rem", rotate: "-6deg" } },
  { name: "zap", style: { top: "44%", left: "-1%", width: "6.5rem", height: "6.5rem", rotate: "-5deg" } },
  { name: "chart", style: { top: "38%", right: "-1%", width: "7rem", height: "7rem", rotate: "8deg" } },
  { name: "globe", style: { bottom: "38%", left: "40%", width: "6rem", height: "6rem", rotate: "4deg" } },
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
        {BG_ICONS.map((icon) => (
          <span key={icon.name} className="landing__bg-icon" style={icon.style}>
            <LandingIcon name={icon.name} size="100%" strokeWidth={1} />
          </span>
        ))}
      </div>

      <nav className="landing__nav">
        <span className="landing__brand">
          <LandingIcon name="sprout" size={22} strokeWidth={2} style={{ color: "var(--accent)" }} /> TerraTrace
        </span>
        <div className="landing__nav-signin">
          <a href="/api/auth/login?redirectTo=/dashboard" className="landing__cta">
            Sign in with GitHub
          </a>
        </div>
      </nav>

      <section className="landing__hero">
        <div className="landing__eyebrow">Carbon &amp; cost impact scanning</div>
        <h1 className="landing__headline">See what your code emits — in carbon and dollars.</h1>
        <p className="landing__tagline">
          TerraTrace traces cloud cost and carbon to the line of code behind it, then writes a fix you can open as a
          pull request.
        </p>
      </section>

      <div className="landing__steps">
        <section className="landing__flow">
          <div className="landing__inputs">
            {INPUT_STEPS.map((f) => (
              <div key={f.title} className="landing__feature">
                <div className="landing__feature-head">
                  <span className="landing__step">{f.step}</span>
                  <span className="landing__feature-icon">
                    <LandingIcon name={f.icon} size={26} />
                  </span>
                  <span className="landing__tag">{f.tag}</span>
                </div>
                <h2>{f.title}</h2>
                <p>{f.body}</p>
              </div>
            ))}
          </div>

          <div className="landing__core">
            <div className="landing__feature-head">
              <span className="landing__step">3</span>
              <span className="landing__feature-icon">
                <LandingIcon name="wrench" size={26} />
              </span>
              <span className="landing__core-label">The core of TerraTrace</span>
              <span className="landing__tag landing__tag--ai">
                <LandingIcon name="sparkle" size={14} />
                GenAI
              </span>
            </div>
            <h2>Explain and fix</h2>
            <ol className="landing__core-steps">
              {CORE_STEPS.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>

            <div className="landing__diff" aria-label="Example fix for a planted N+1 query">
              <div className="landing__diff-head">Example fix: one query per customer becomes one query</div>
              <pre>
                <code>
                  <span className="landing__diff-del">- Order.objects.filter(customer_id=customer.id)</span>
                  {"\n"}
                  <span className="landing__diff-add">+ Order.objects.values("customer_id").annotate(total=Sum("amount"))</span>
                </code>
              </pre>
            </div>

            <div className="landing__chips">
              {CORE_CHIPS.map((chip) => (
                <span key={chip} className="landing__chip">
                  {chip}
                </span>
              ))}
            </div>
          </div>
        </section>

        <p className="landing__trust">
          <LandingIcon name="lock" size={16} />
          TerraTrace only reads your repo. It never writes to it unless you ask for fix PRs.
        </p>
      </div>

      <footer className="landing__footer">
        Built by Team Terra: Ajay Kumar Singh, Priya Srivastava, Ritu Baldwa
      </footer>
    </main>
  );
}

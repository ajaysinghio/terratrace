export type Theme = "light" | "dark";

const COOKIE_NAME = "tt_theme";

/** Executive/Manager default to light (FinOps-deck framing); Engineer
 * defaults to dark (matches the code-heavy, terminal-adjacent context they
 * spend most of their time in). Only meaningful until the user picks an
 * explicit override via the account menu's theme toggle. */
export function defaultThemeForRole(role: string | null | undefined): Theme {
  return role === "engineer" ? "dark" : "light";
}

export function readThemeOverride(): Theme | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(/(?:^|; )tt_theme=(light|dark)/);
  return match ? (match[1] as Theme) : null;
}

export function writeThemeOverride(theme: Theme) {
  document.cookie = `${COOKIE_NAME}=${theme}; path=/; max-age=${60 * 60 * 24 * 365}`;
  document.documentElement.setAttribute("data-theme", theme);
}

export function clearThemeOverride(fallback: Theme) {
  document.cookie = `${COOKIE_NAME}=; path=/; max-age=0`;
  document.documentElement.setAttribute("data-theme", fallback);
}

/**
 * Mirrors THEME_INIT_SCRIPT in app/layout.tsx (a raw string, since it has to
 * run as a blocking <script> before hydration to avoid a flash of the wrong
 * theme on a hard load/refresh). Keep the two in sync if this logic changes
 * — this version runs on every *client-side* navigation instead, since a
 * beforeInteractive script only ever runs once per hard page load and won't
 * re-fire when a role switch is just a router.push.
 */
export function applyThemeForRoute(pathname: string, view: string | null) {
  if (pathname === "/") {
    document.documentElement.setAttribute("data-theme", "dark");
    return;
  }
  const override = readThemeOverride();
  document.documentElement.setAttribute("data-theme", override ?? defaultThemeForRole(view));
}

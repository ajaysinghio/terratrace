import type { ReactNode } from "react";
import { Suspense } from "react";
import Script from "next/script";
import ThemeSync from "../components/ThemeSync";
import "./globals.css";

export const metadata = {
  title: "TerraTrace",
  description: "Code-level carbon and cost attribution findings",
};

// Mirrors lib/theme.ts's applyThemeForRoute — kept in sync manually (see the
// comment there). Runs as a blocking script so data-theme is set before the
// first paint; ThemeSync (a client component, below) takes over from there
// for client-side navigations, which this script never sees since it only
// runs once per hard page load.
const THEME_INIT_SCRIPT = `(function(){try{
  var d=document.documentElement;
  if(location.pathname==="/"){d.setAttribute("data-theme","dark");return;}
  var m=document.cookie.match(/(?:^|; )tt_theme=(light|dark)/);
  if(m){d.setAttribute("data-theme",m[1]);return;}
  var v=new URLSearchParams(location.search).get("view");
  d.setAttribute("data-theme", v==="engineer" ? "dark" : "light");
}catch(e){}})();`;

export default function RootLayout({ children }: { children: ReactNode }) {
  // suppressHydrationWarning below: THEME_INIT_SCRIPT deliberately sets
  // data-theme on <html> before hydration, which the server-rendered HTML
  // never has — React would otherwise log a mismatch warning for an
  // attribute we're intentionally letting a script own.
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <Script id="theme-init" strategy="beforeInteractive" dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <Suspense fallback={null}>
          <ThemeSync />
        </Suspense>
        {children}
      </body>
    </html>
  );
}

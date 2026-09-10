"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { applyThemeForRoute } from "../lib/theme";

/**
 * The blocking <script> in app/layout.tsx only runs once per hard page
 * load — it prevents a flash of the wrong theme on first paint, but a role
 * switch (or any Link click) is a client-side transition that never re-runs
 * it. This re-applies the theme on every route/query change so switching
 * role in the account menu actually changes the theme instead of leaving it
 * stuck at whatever the last hard load computed.
 */
export default function ThemeSync() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    applyThemeForRoute(pathname, searchParams.get("view"));
  }, [pathname, searchParams]);

  return null;
}

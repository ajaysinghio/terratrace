"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ROLE_RANK, type Role } from "../lib/role";

interface NavItem {
  id: string;
  icon: string;
  label: string;
  minRank: number;
  /** Appended to /projects/<id> — "" for the Overview/index route itself. */
  hrefSuffix: string;
}

// One real route per entry (not an anchor) — clicking a section item loads
// that page fresh, it doesn't scroll within a single giant component.
const NAV_ITEMS: NavItem[] = [
  { id: "overview", icon: "📊", label: "Overview", minRank: ROLE_RANK.executive, hrefSuffix: "" },
  { id: "domain", icon: "🗂️", label: "By domain", minRank: ROLE_RANK.manager, hrefSuffix: "/domain" },
  { id: "remediation", icon: "🔻", label: "Remediation", minRank: ROLE_RANK.manager, hrefSuffix: "/remediation" },
  {
    id: "recommendations",
    icon: "💡",
    label: "Recommendations",
    minRank: ROLE_RANK.manager,
    hrefSuffix: "/recommendations",
  },
  { id: "fixes", icon: "🔧", label: "Fixes in progress", minRank: ROLE_RANK.manager, hrefSuffix: "/fixes" },
  { id: "files", icon: "📄", label: "Findings by file", minRank: ROLE_RANK.engineer, hrefSuffix: "/files" },
];

export default function SectionNav({ projectId, role }: { projectId: string; role: Role }) {
  const pathname = usePathname();
  const rank = ROLE_RANK[role];
  const items = NAV_ITEMS.filter((item) => rank >= item.minRank);

  return (
    <nav className="side-nav" aria-label="Project sections">
      {items.map((item) => {
        const path = `/projects/${projectId}${item.hrefSuffix}`;
        const isActive = pathname === path;
        return (
          <Link
            key={item.id}
            href={`${path}?view=${role}`}
            className={`side-nav__item${isActive ? " side-nav__item--active" : ""}`}
          >
            <span className="side-nav__icon">{item.icon}</span>
            <span className="side-nav__label">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

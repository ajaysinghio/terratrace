"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ROLES, type Role } from "../lib/role";

export type { Role } from "../lib/role";

/**
 * Switches which role's view renders via the `?view=` search param, so the
 * choice is a plain server-rendered read (see parseRole in each page) rather
 * than client-only state — reload, share, or bookmark a link and you land on
 * the same role's view.
 */
export default function RoleTabs({ active }: { active: Role }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function selectRole(role: Role) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("view", role);
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="role-tabs">
      {ROLES.map((role) => (
        <button
          key={role.id}
          type="button"
          className={`role-tab${role.id === active ? " role-tab--active" : ""}`}
          onClick={() => selectRole(role.id)}
        >
          {role.label}
        </button>
      ))}
    </div>
  );
}

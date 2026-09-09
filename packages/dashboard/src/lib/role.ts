// Plain module (no "use client") — parseRole/ROLE_RANK need to be callable
// from Server Components (page.tsx). RoleTabs.tsx re-exports these for
// convenience but is itself a Client Component; a "use client" directive
// marks every export of a file as client-only, so these can't live there.

export type Role = "executive" | "manager" | "engineer";

export const ROLE_RANK: Record<Role, number> = { executive: 0, manager: 1, engineer: 2 };

export const ROLES: { id: Role; label: string }[] = [
  { id: "executive", label: "Executive" },
  { id: "manager", label: "Middle Management" },
  { id: "engineer", label: "Engineer" },
];

/** Parses the `?view=` search param into a Role, defaulting when absent/invalid. */
export function parseRole(value: string | undefined, fallback: Role): Role {
  return value === "executive" || value === "manager" || value === "engineer" ? value : fallback;
}

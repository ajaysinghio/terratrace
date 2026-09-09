"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ROLES, type Role } from "../lib/role";

interface AccountMenuProps {
  role: Role;
  /** Omitted when no GitHub OAuth session exists (local dev, or auth not
   * configured) — the menu still works for switching roles, it just skips
   * the identity/sign-out section. */
  login?: string;
}

export default function AccountMenu({ role, login }: AccountMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    function onClickOutside(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("click", onClickOutside);
    return () => document.removeEventListener("click", onClickOutside);
  }, []);

  function selectRole(next: Role) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("view", next);
    router.push(`${pathname}?${params.toString()}`);
    setOpen(false);
  }

  const activeLabel = ROLES.find((r) => r.id === role)?.label ?? role;

  return (
    <div className="account-menu" ref={ref}>
      <button
        type="button"
        className="account-menu__trigger"
        onClick={() => setOpen((prev) => !prev)}
        aria-label={login ? `Signed in as ${login} — account and view menu` : "View menu"}
      >
        {login ? (
          // github.com/<login>.png is GitHub's own stable avatar redirect —
          // no API call or token needed to render it.
          <img src={`https://github.com/${login}.png?size=64`} alt="" className="account-menu__avatar" />
        ) : (
          <span className="account-menu__avatar account-menu__avatar--placeholder">{activeLabel[0]}</span>
        )}
      </button>
      {open && (
        <div className="account-menu__dropdown">
          {login && (
            <p className="account-menu__login">
              Signed in as <strong>{login}</strong>
            </p>
          )}
          <p className="account-menu__section-label">View as</p>
          <div className="account-menu__roles">
            {ROLES.map((r) => (
              <button
                key={r.id}
                type="button"
                className={`account-menu__role${r.id === role ? " account-menu__role--active" : ""}`}
                onClick={() => selectRole(r.id)}
              >
                {r.label}
              </button>
            ))}
          </div>
          {login && (
            <a href="/api/auth/logout" className="account-menu__signout">
              Sign out
            </a>
          )}
        </div>
      )}
    </div>
  );
}

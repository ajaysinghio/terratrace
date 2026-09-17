import Link from "next/link";
import AccountMenu from "./AccountMenu";
import SectionNav from "./SectionNav";
import type { Role } from "../lib/role";

/**
 * Chrome shared by every /projects/[projectId]/* route: back-link + title,
 * the account/role menu, and the section nav — kept out of each page.tsx so
 * adding a new section route doesn't mean re-copying this markup. Plain
 * Server Component; the interactive pieces (AccountMenu, SectionNav) are
 * their own client islands.
 */
export default function ProjectShell({
  projectId,
  projectName,
  repoUrl,
  scannedAt,
  role,
  login,
  children,
}: {
  projectId: string;
  projectName: string;
  repoUrl?: string;
  scannedAt?: string;
  role: Role;
  login?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="dashboard">
      <header className="dashboard__header">
        <Link href={`/dashboard?view=${role}`} className="logo-link" aria-label="TerraTrace home">
          🌱 TerraTrace
        </Link>
        <Link href={`/dashboard?view=${role}`} className="back-link">
          ← All projects
        </Link>
        <h1>{projectName}</h1>
        <p>
          {repoUrl ? repoUrl.replace(/^https?:\/\//, "") : projectId}
          {scannedAt && ` · scanned ${new Date(scannedAt).toLocaleString()}`}
        </p>
      </header>
      <AccountMenu role={role} login={login} landingHref={`/projects/${projectId}`} />
      <div className="dashboard-layout">
        <SectionNav projectId={projectId} role={role} />
        <div className="dashboard-main">{children}</div>
      </div>
    </div>
  );
}

import type { CSSProperties } from "react";

export type LandingIconName =
  | "factory"
  | "cloud"
  | "dollar"
  | "sprout"
  | "zap"
  | "chart"
  | "globe"
  | "search"
  | "wrench"
  | "sparkle"
  | "lock";

// Stroke icons so the landing page looks the same on every OS — emoji render
// differently per platform. Paths follow Feather's open-source icon set.
const PATHS: Record<LandingIconName, React.ReactNode> = {
  factory: <path d="M3 21V12l6 4v-4l6 4V5h4v16zM3 21h18" />,
  cloud: <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" />,
  dollar: (
    <>
      <path d="M12 1v22" />
      <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </>
  ),
  sprout: (
    <>
      <path d="M12 22V12" />
      <path d="M12 12c0-5 4-8 8-8 0 5-3 8-8 8z" />
      <path d="M12 15c0-4-3-6-7-6 0 4 2 6 7 6z" />
    </>
  ),
  zap: <path d="M13 2 3 14h9l-1 8 10-12h-9z" />,
  chart: <path d="M18 20V10M12 20V4M6 20v-6" />,
  globe: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M2 12h20" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.35-4.35" />
    </>
  ),
  wrench: (
    <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94z" />
  ),
  sparkle: <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" fill="currentColor" />,
  lock: (
    <>
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </>
  ),
};

export default function LandingIcon({
  name,
  size = 24,
  strokeWidth = 1.6,
  style,
}: {
  name: LandingIconName;
  size?: number | string;
  strokeWidth?: number;
  style?: CSSProperties;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={style}
    >
      {PATHS[name]}
    </svg>
  );
}

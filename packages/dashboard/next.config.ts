import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // lib/projects.ts reads scan-output/*.json via a runtime-computed path
  // (path.join(cwd, "..", "..", "scan-output")), so Next's static file
  // tracing can't discover it by following imports. Without this, Vercel's
  // deployed function omits scan-output/ entirely and every project 404s.
  outputFileTracingIncludes: {
    "/**": ["../../scan-output/**"],
  },
};

export default nextConfig;

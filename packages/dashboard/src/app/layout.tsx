import type { ReactNode } from "react";

export const metadata = {
  title: "TerraTrace",
  description: "Code-level carbon and cost attribution findings",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

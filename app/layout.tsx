import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LUNA | Video saver",
  description: "Save available videos from TikTok and Instagram in a few simple steps.",
};

// Typed explicitly instead of relying on the generated `LayoutProps` type, which
// only exists after `next build` has written .next/types (clean-clone typecheck
// used to fail with TS2304).
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <Analytics />
      </body>
    </html>
  );
}

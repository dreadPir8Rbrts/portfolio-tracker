import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Ninjadex Ledger · Collection portfolio",
  description:
    "Shared collections. Clear ownership. Every dollar accounted for.",
  robots: { index: false, follow: false },
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

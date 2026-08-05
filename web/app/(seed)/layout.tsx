import type { Metadata } from "next";

/**
 * The Seed Tool half of the app: /join, /profile, /share, /done.
 *
 * Its link gets forwarded around parent group chats, so the whole group is kept
 * out of search — unlike the public marketing pages under (site), which are
 * meant to be found.
 */
export const metadata: Metadata = {
  title: { absolute: "Pando — Founding parents" },
  description:
    "Share the classes, camps, and caregivers you'd vouch for. About a minute, all taps.",
  robots: { index: false, follow: false },
  appleWebApp: { capable: true, title: "Pando", statusBarStyle: "default" },
};

export default function SeedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}

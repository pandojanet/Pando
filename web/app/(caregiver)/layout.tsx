import type { Metadata } from "next";

/**
 * 2C — the caregiver's own surface.
 *
 * Its own route group rather than a page inside `(seed)`, because it is a different
 * product for a different person: the Seed Tool's metadata calls the reader a
 * founding parent and describes sharing recommendations, which is the opposite of
 * what someone arriving here is doing.
 *
 * `noindex` for the same reason as the Seed Tool, and one more: the only way here is
 * an invite from a family who employed you. A caregiver profile that turned up in a
 * search result would be exactly the listing this flow exists to avoid creating.
 */
export const metadata: Metadata = {
  title: { absolute: "Pando — for caregivers" },
  description:
    "A family recommended you. Decide what, if anything, other families get to see.",
  robots: { index: false, follow: false },
  appleWebApp: { capable: true, title: "Pando", statusBarStyle: "default" },
};

export default function CaregiverLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}

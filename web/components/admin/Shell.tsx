"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { PandoMark } from "@/components/ui/Logo";
import { useEdgeFade } from "@/components/admin/ui";
import { signOut } from "@/lib/admin/client";

/**
 * Admin shell (estimate 2.1): navigation, and the frame every admin page renders in.
 *
 * Desktop-first, unlike the rest of the product: this is a tool for one or two
 * people at a laptop. Below `md` the sidebar becomes a scrolling row so it stays
 * usable on a phone without pretending to be a phone app.
 */

const NAV: Array<{ href: string; label: string; hint: string }> = [
  { href: "/admin", label: "Overview", hint: "Pilot numbers" },
  { href: "/admin/founding", label: "Founding queue", hint: "Approve people" },
  { href: "/admin/contributors", label: "Contributors", hint: "Profiles + transcripts" },
  { href: "/admin/activities", label: "Contributions", hint: "Review + confidence" },
  { href: "/admin/caregivers", label: "Caregivers", hint: "Consent + duplicates" },
  { href: "/admin/options", label: "Tap lists", hint: "Promote 'other'" },
  { href: "/admin/demand", label: "Asked for", hint: "The closing question" },
  { href: "/admin/flags", label: "Flags", hint: "Escalations" },
  { href: "/admin/audit", label: "Audit log", hint: "Who changed what" },
];

export function AdminShell({
  user,
  children,
}: {
  user: string;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const { ref: navRef, maskStyle } = useEdgeFade<HTMLElement>();

  return (
    <div className="min-h-dvh bg-paper text-ink md:flex">
      <aside className="border-b border-bark bg-card md:min-h-dvh md:w-[15rem] md:shrink-0 md:border-b-0 md:border-r">
        <div className="flex items-center justify-between gap-3 px-4 py-3 md:py-4">
          <Link href="/admin" className="flex min-h-9 items-center gap-2">
            <PandoMark className="h-5" />
            <span className="font-display text-[1.05rem] font-bold tracking-[-0.02em]">
              Pando admin
            </span>
          </Link>
        </div>

        <nav
          ref={navRef}
          aria-label="Admin sections"
          style={maskStyle}
          className="flex snap-x gap-1 overflow-x-auto px-2 pb-2 no-scrollbar md:flex-col md:overflow-visible md:px-2"
        >
          {NAV.map((item) => {
            const active =
              item.href === "/admin"
                ? pathname === "/admin"
                : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-9 shrink-0 snap-start items-center rounded-lg px-3 text-[13.5px] font-semibold transition-colors md:min-h-10",
                  active
                    ? "bg-green-wash text-green-deep"
                    : "text-ink-soft hover:bg-paper",
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="hidden border-t border-bark/70 px-4 py-3 md:block">
          <p className="text-[12px] text-muted">Signed in as</p>
          <p className="text-[13.5px] font-semibold">{user}</p>
          <button
            type="button"
            onClick={() => void signOut()}
            className="mt-1.5 min-h-9 text-[13px] font-semibold text-green-deep underline underline-offset-2"
          >
            Sign out
          </button>
        </div>
      </aside>

      <main className="min-w-0 flex-1 px-4 py-5 md:px-8 md:py-8">
        <div className="mx-auto w-full max-w-[76rem]">{children}</div>
        <div className="mt-8 flex items-center gap-3 md:hidden">
          <span className="text-[12.5px] text-muted">Signed in as {user}</span>
          <button
            type="button"
            onClick={() => void signOut()}
            className="min-h-9 text-[13px] font-semibold text-green-deep underline underline-offset-2"
          >
            Sign out
          </button>
        </div>
      </main>
    </div>
  );
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { PandoMark } from "@/components/ui/Logo";
import { useEdgeFade } from "@/components/admin/ui";
import { signOut } from "@/lib/admin/client";
import type { Overview } from "@/lib/admin/types";

/**
 * Admin shell (estimate 2.1): navigation, and the frame every admin page renders in.
 *
 * Desktop-first, unlike the rest of the product: this is a tool for one or two
 * people at a laptop. Below `md` the sidebar becomes a scrolling row so it stays
 * usable on a phone without pretending to be a phone app.
 *
 * The nav's job is not to list nine links — it is to answer "where is the work",
 * which is the question an admin actually arrives with. So each queue carries its
 * own length, and the sidebar reads as a worklist rather than a menu. Without that,
 * finding out whether anything needs doing means opening all nine pages.
 */

interface NavItem {
  href: string;
  label: string;
  /** Shown under the label when this is the page you're on. */
  hint: string;
  /** How many things are waiting here. Omitted for pages that aren't queues. */
  count?: (o: Overview) => number;
  /**
   * Of that count, how many are owed a person *today* rather than merely pending.
   * Drives the one red badge in the nav — see the `alert` token in globals.css.
   */
  urgent?: (o: Overview) => number;
}

const NAV: Array<{ group?: string; items: NavItem[] }> = [
  {
    items: [{ href: "/admin", label: "Overview", hint: "Where the pilot stands" }],
  },
  {
    group: "People",
    items: [
      {
        href: "/admin/founding",
        label: "Founding queue",
        hint: "Is this really who they say? Approve, or ask for an invite.",
        count: (o) => o.founding.pending,
      },
      {
        href: "/admin/contributors",
        label: "Contributors",
        hint: "Everyone who came through, and what each of them shared.",
      },
    ],
  },
  {
    group: "Waiting on you",
    items: [
      {
        href: "/admin/activities",
        label: "Contributions",
        hint: "Activities, places and tips. Low confidence first.",
        count: (o) => o.quality.pending_contributions,
      },
      {
        href: "/admin/caregivers",
        label: "Caregivers",
        hint: "The consent ladder, held cards, and the private notes behind them.",
        count: (o) => o.quality.review_holds,
      },
      {
        href: "/admin/claims",
        label: "Caregiver sign-ups",
        hint: "Match a caregiver who registered themselves to the family's nomination.",
        count: (o) => o.quality.pending_claims,
      },
      {
        href: "/admin/demand",
        label: "Asked for",
        hint: "What parents wanted at the end. Claims about a person, then health and safety.",
        count: (o) =>
          o.demand.ordinary +
          o.demand.peer_support +
          o.demand.high_stakes +
          o.demand.named_allegation,
        urgent: (o) => o.demand.high_stakes + o.demand.named_allegation,
      },
      {
        href: "/admin/flags",
        label: "Flags",
        hint: "Anything the app couldn't decide on its own.",
        count: (o) => o.quality.open_flags,
        urgent: (o) => o.quality.escalations,
      },
    ],
  },
  {
    group: "Records",
    items: [
      {
        href: "/admin/invites",
        label: "Invites",
        hint: "One link per group, and which group actually brought contributors.",
      },
      {
        href: "/admin/options",
        label: "Tap lists",
        hint: "Promote an 'other' answer so it can be matched on.",
        count: (o) => o.quality.pending_options,
      },
      {
        href: "/admin/consents",
        label: "Consent records",
        hint: "Who agreed to what, in which words. Exportable — this is the TCPA defence.",
      },
      {
        href: "/admin/audit",
        label: "Audit log",
        hint: "Who changed what, and when.",
      },
    ],
  },
];

const ITEMS = NAV.flatMap((section) => section.items);

function isActive(pathname: string, href: string): boolean {
  return href === "/admin" ? pathname === "/admin" : pathname.startsWith(href);
}

/**
 * The queue lengths, fetched once per page load rather than per navigation: this
 * component lives in the layout, so it survives every move between admin pages.
 * Re-read on navigation because approving something is exactly what changes them —
 * a count that goes stale the moment you act on it is worse than no count.
 *
 * Failure is silent on purpose. A number missing from the nav is a smaller problem
 * than an error banner on every page, and the page itself will report the same
 * outage properly.
 */
function useQueueCounts(pathname: string): Overview | null {
  const [overview, setOverview] = useState<Overview | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const res = await fetch("/api/admin/query", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ resource: "overview", params: {} }),
        });
        if (!res.ok) return;
        const data = (await res.json()) as { rows: Overview | null };
        if (live && data.rows) setOverview(data.rows);
      } catch {
        /* see above */
      }
    })();
    return () => {
      live = false;
    };
  }, [pathname]);

  return overview;
}

function CountBadge({ count, urgent }: { count: number; urgent: number }) {
  return (
    <span
      title={
        urgent > 0
          ? `${count} waiting, ${urgent} needing someone today`
          : `${count} waiting`
      }
      className={cn(
        "ml-auto inline-flex min-w-5 shrink-0 items-center justify-center rounded-full border px-1.5 text-[11px] font-bold tabular-nums",
        urgent > 0
          ? "border-alert-line bg-alert-wash text-alert"
          : "border-gold-line bg-gold-wash text-gold-ink",
      )}
    >
      {count}
    </span>
  );
}

export function AdminShell({
  user,
  children,
}: {
  user: string;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const { ref: navRef, maskStyle } = useEdgeFade<HTMLElement>();
  const counts = useQueueCounts(pathname);

  const current = ITEMS.find((item) => isActive(pathname, item.href));
  const waiting = counts
    ? ITEMS.reduce((sum, item) => sum + (item.count?.(counts) ?? 0), 0)
    : 0;

  return (
    <div className="min-h-dvh bg-paper text-ink md:flex">
      {/*
        Sticky and self-scrolling from `md`: the contributors table is long, and a
        sidebar that scrolls away with it means finding another section requires
        going back to the top first.
      */}
      <aside className="border-b border-bark bg-card md:sticky md:top-0 md:flex md:h-dvh md:w-[16rem] md:shrink-0 md:flex-col md:border-b-0 md:border-r">
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
          className="flex snap-x gap-1 overflow-x-auto px-2 pb-2 no-scrollbar md:min-h-0 md:flex-1 md:flex-col md:gap-0 md:overflow-y-auto md:overflow-x-visible"
        >
          {NAV.map((section, i) => (
            <div
              key={section.group ?? `section-${i}`}
              className="flex shrink-0 gap-1 md:mt-1 md:flex-col md:gap-0.5 md:first:mt-0"
            >
              {/* Group labels are a desktop affordance: on a phone the nav is one
                  scrolling row, and headings inside it would just eat the width. */}
              {section.group && (
                <p className="hidden px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[0.09em] text-muted md:block">
                  {section.group}
                </p>
              )}
              {section.items.map((item) => {
                const active = isActive(pathname, item.href);
                const count = counts ? (item.count?.(counts) ?? 0) : 0;
                const urgent = counts ? (item.urgent?.(counts) ?? 0) : 0;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      /*
                        44px on a phone, 40 from `md`. The admin is a denser
                        register than the parent flow and `min-h-9` (36px) was fine
                        for a cursor — but this row is the one thing here that gets
                        thumbed, and 36px misses the design system's 44px floor.
                      */
                      "flex min-h-11 shrink-0 snap-start items-center gap-2 rounded-lg px-3 text-[13.5px] font-semibold transition-colors md:min-h-10",
                      active
                        ? "bg-green-wash text-green-deep"
                        : "text-ink-soft hover:bg-paper",
                    )}
                  >
                    <span className="truncate">{item.label}</span>
                    {count > 0 && <CountBadge count={count} urgent={urgent} />}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        {/*
          One line about the page you are on, and only that page. A hint under all
          nine items is a wall of prose in a 16rem column; under the current one it
          answers "what am I looking at" for free.
        */}
        {current?.hint && (
          <p className="hidden border-t border-bark/70 px-4 py-3 text-[12.5px] leading-relaxed text-muted md:block">
            {current.hint}
          </p>
        )}

        <div className="hidden border-t border-bark/70 px-4 py-3 md:block">
          <p className="text-[12px] text-muted">Signed in as</p>
          <p className="text-[13.5px] font-semibold">{user}</p>
          {/* Stacked, not side by side: this column is 16rem wide and both labels
              are long enough that one row crowds them at the first name longer
              than "andrii". Two lines cost nothing here — the footer is the least
              busy part of the page. */}
          <div className="mt-1.5 flex flex-col items-start gap-0.5">
            <Link
              href="/admin/account"
              className="flex min-h-9 items-center text-[13px] font-semibold text-green-deep underline underline-offset-2"
            >
              Change password
            </Link>
            <button
              type="button"
              onClick={() => void signOut()}
              className="flex min-h-9 items-center text-[13px] font-semibold text-green-deep underline underline-offset-2"
            >
              Sign out
            </button>
          </div>
        </div>
      </aside>

      <main className="min-w-0 flex-1 px-4 py-5 md:px-8 md:py-8">
        <div className="mx-auto w-full max-w-[76rem]">
          {/*
            The one thing worth saying above every page: whether anything is
            waiting anywhere. Rendered only once the counts have arrived, and only
            when it has something to report — an empty bar teaching an admin to
            ignore that strip would defeat it.
          */}
          {counts && waiting === 0 && (
            <p className="mb-4 rounded-lg border border-green/25 bg-green-wash px-3 py-2 text-[13px] font-medium text-green-deep">
              Nothing waiting for review right now.
            </p>
          )}
          {children}
        </div>
        <div className="mt-8 flex flex-wrap items-center gap-3 md:hidden">
          <span className="text-[12.5px] text-muted">Signed in as {user}</span>
          <Link
            href="/admin/account"
            className="min-h-9 text-[13px] font-semibold text-green-deep underline underline-offset-2"
          >
            Change password
          </Link>
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

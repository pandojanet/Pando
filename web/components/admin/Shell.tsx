"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import {
  BadgeCheck,
  CreditCard,
  Megaphone,
  CalendarClock,
  ClipboardList,
  Flag,
  Gauge,
  Heart,
  IdCard,
  Link2,
  ListChecks,
  MessageSquareReply,
  Send,
  ScrollText,
  Search,
  Tags,
  Users,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { HintProvider } from "@/components/admin/kit";
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
  /**
   * One icon per section, from `lucide-react`.
   *
   * Not decoration: sixteen text links in a 16rem column is a wall a reader has
   * to *read* every time, and an admin who visits this nav twenty times a day
   * navigates by shape long before they navigate by word. It also gives the
   * phone row — where the labels are the only thing there is — something to
   * anchor on while it scrolls.
   */
  icon: LucideIcon;
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
    items: [
      {
        href: "/admin",
        icon: Gauge,
        label: "Overview",
        hint: "Where the pilot stands",
      },
    ],
  },
  {
    group: "People",
    items: [
      {
        href: "/admin/founding",
        icon: BadgeCheck,
        label: "Founding queue",
        hint: "Is this really who they say? Approve, or ask for an invite.",
        count: (o) => o.founding.pending,
      },
      {
        href: "/admin/contributors",
        icon: Users,
        label: "Contributors",
        hint: "Everyone who came through: what each of them shared, and what they agreed to.",
      },
    ],
  },
  {
    group: "Waiting on you",
    items: [
      {
        href: "/admin/activities",
        icon: ClipboardList,
        label: "Contributions",
        hint: "Everything parents have recommended, newest first.",
        count: (o) => o.quality.pending_contributions,
      },
      {
        href: "/admin/caregivers",
        icon: Heart,
        label: "Caregivers",
        hint: "Who a family put forward, who has said yes, and what's being held back.",
        count: (o) => o.quality.review_holds,
      },
      {
        href: "/admin/claims",
        icon: IdCard,
        label: "Caregiver sign-ups",
        hint: "A caregiver signed up herself — which family put her forward?",
        count: (o) => o.quality.pending_claims,
      },
      {
        href: "/admin/demand",
        icon: ListChecks,
        label: "What parents asked for",
        hint: "The questions parents asked. Anything about a named person comes first.",
        count: (o) =>
          o.demand.ordinary +
          o.demand.peer_support +
          o.demand.high_stakes +
          o.demand.named_allegation,
        urgent: (o) => o.demand.high_stakes + o.demand.named_allegation,
      },
      {
        /* 7.6. In "Waiting on you" and it DOES carry a count: unlike the
           matching harness or the delivery gauge, this is a queue — every row is
           a parent who answered and is waiting to hear that it mattered. */
        /* 14.2. A queue, so it counts — and during the pilot it counts every
           answer, because 19 says every one is read by a person. */
        href: "/admin/answers",
        icon: Send,
        label: "Answers to send",
        hint: "What Pando would reply, waiting for you to read it. Nothing goes out unread.",
      },
      {
        /**
         * 14.3. In "Waiting on you" and it counts, unlike the matching harness
         * or the delivery gauge: the default view is Asks that are still open,
         * and every one of those is a parent waiting — several of them having
         * paid. The count is the open ones rather than all of them, because a
         * fulfilled Ask is a record you look up, not work.
         */
        href: "/admin/blasts",
        icon: Megaphone,
        label: "Network Asks",
        hint: "Questions parents paid Pando to ask. Preview the pool, see the replies, mark them answered.",
        count: (o) => o.blasts?.open ?? 0,
        urgent: (o) => o.blasts?.refunds_owed ?? 0,
      },
      {
        href: "/admin/responses",
        icon: MessageSquareReply,
        label: "Network answers",
        hint: "Replies to Network Asks. Rate them, and decide what enters the knowledge base.",
      },
      {
        /**
         * 14.9. **A queue, so it counts** — unlike the conversation record or
         * the matching harness. Every row is a decision nobody has taken: a
         * contributor said a record is no longer worth recommending, and until
         * somebody retires it or keeps it, Pando keeps answering with it.
         *
         * The number is the open `recommendation_withdrawn` flags, which is a
         * subset of `open_flags` below — so the two badges overlap by design,
         * the same way the flags row and the escalation row already do. What
         * would be wrong is showing it *only* in the flags total, where
         * "resolve" means "I have read this" and leaves the record untouched.
         */
        href: "/admin/freshness",
        icon: Flag,
        label: "Withdrawn recommendations",
        hint: "A contributor said one of these is no longer worth recommending. Retire it, or keep it marked old.",
        count: (o) => o.quality.withdrawn_records,
      },
      {
        href: "/admin/flags",
        icon: Flag,
        label: "Flags",
        hint: "Anything a parent wrote that you should read before Pando uses it.",
        count: (o) => o.quality.open_flags,
        urgent: (o) => o.quality.escalations,
      },
    ],
  },
  {
    group: "Records",
    items: [
      {
        /**
         * 14.5. Under Records because it is mostly a ledger you consult — but
         * with a **red** count for refunds owed, which is the one thing here
         * that is somebody's outstanding task and involves money. Gold would be
         * wrong: this is not "pending", it is owed.
         */
        href: "/admin/payments",
        icon: CreditCard,
        label: "Payments",
        hint: "What parents paid for an Ask, and what Pando owes back.",
        count: (o) => o.blasts?.refunds_owed ?? 0,
        urgent: (o) => o.blasts?.refunds_owed ?? 0,
      },
      {
        href: "/admin/invites",
        icon: Link2,
        label: "Invites",
        hint: "One link per group, and which group actually brought contributors.",
      },
      {
        href: "/admin/options",
        icon: Tags,
        label: "Names & places",
        hint: "A parent typed something new — add it to the lists everyone picks from.",
        count: (o) => o.quality.pending_options,
      },
      {
        /**
         * 6.7. Under Records rather than "Waiting on you", and with **no count**:
         * the nav's numbers mean "there is something here for you to clear" (10
         * Aug), and this is a tool you open when you want it, not a queue that
         * fills. A badge here would make the nav cry wolf.
         */
        href: "/admin/matching",
        icon: Search,
        label: "Who Pando would ask",
        hint: "Try a question against the real data: who Pando would go to, and why. Nothing is sent.",
      },
      {
        /**
         * 12.5. No count, same reason as the matching harness: the sidebar's
         * numbers mean "something here is waiting for you", and a delivery rate
         * is a gauge rather than a queue. The alarm for a bad one is the
         * container log, which fires the minute it happens.
         */
        href: "/admin/delivery",
        icon: CalendarClock,
        label: "Message delivery",
        hint: "Did the texts arrive? The rate, and the carrier errors worth acting on.",
      },
      {
        /**
         * 14.1. **No count**, on the 10 Aug rule: a number in this sidebar means
         * "something here is waiting for you", and this is a record you open
         * rather than a queue that fills. The one view that *is* queue-shaped
         * ("they spoke last") is not a queue Pando owes an answer to either —
         * `/admin/answers` is, and it already carries the badge.
         */
        href: "/admin/conversations",
        icon: MessageSquareReply,
        label: "Conversations",
        hint: "Who Pando has messaged, whether it arrived, and who replied. No message text is kept.",
      },
      {
        /**
         * 14.6. **No count**, and the reason is the page's own subject: the
         * number worth acting on is "a yes whose contributors are unthanked",
         * which the weekly `thanks_delivery` batch is supposed to clear on its
         * own. A badge would read as a queue for a person to work, and the
         * honest reading of a non-zero one is "the job is not running" — which
         * is a different alarm, and belongs in the container log rather than in
         * a sidebar that cries wolf.
         */
        href: "/admin/impact",
        icon: Heart,
        label: "Thanks and impact",
        hint: "Did the answers help, and have the parents behind them heard about it?",
      },
      {
        href: "/admin/audit",
        icon: ScrollText,
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

  const waiting = counts
    ? ITEMS.reduce((sum, item) => sum + (item.count?.(counts) ?? 0), 0)
    : 0;

  return (
    /* One provider for every `Hint` on every admin page: a shared open delay,
       and only one tooltip on screen at a time. */
    <HintProvider>
      <div className="min-h-dvh bg-paper text-ink md:flex">
        {/* Eighteen nav links plus two footer controls sit before the content on
            every page, at both breakpoints. `tabIndex={-1}` on `<main>` is what
            makes this actually move focus rather than only scroll — without it
            the next Tab goes straight back into the nav that was just skipped. */}
        <a
          href="#admin-main"
          className="sr-only rounded-lg border border-bark bg-card px-3 py-2 text-[13.5px] font-semibold text-green-deep focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50"
        >
          Skip to the page
        </a>
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
                      /* The hint is worth having *before* you click; on the page
                       you are already on, the page's own intro says it. */
                      title={item.hint}
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
                      <item.icon
                        aria-hidden="true"
                        className={cn(
                          "h-4 w-4 shrink-0",
                          active ? "text-green-deep" : "text-muted",
                        )}
                      />
                      <span className="truncate">{item.label}</span>
                      {count > 0 && (
                        <CountBadge count={count} urgent={urgent} />
                      )}
                    </Link>
                  );
                })}
              </div>
            ))}
          </nav>

          {/*
          The hint used to be *rendered* here, for the current page only. It read
          as a helpful line and was pure duplication: every page has a `PageHead`
          intro saying the same thing, so the sidebar and the page said it twice,
          side by side, on every single visit. It lives on the nav link's `title`
          now — which is where it is actually useful, because there you have not
          yet arrived and the page's own intro has not answered you.
        */}
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

        <main
          id="admin-main"
          tabIndex={-1}
          className="min-w-0 flex-1 px-4 py-5 md:px-8 md:py-8"
        >
          <div className="mx-auto w-full max-w-[76rem]">
            {/*
            The "Nothing waiting for review right now." bar was here, above
            **every** page. On a quiet `/admin/flags` that read: this bar →
            PageHead → "Nothing urgent" → "Nothing waiting" — four ways of saying
            the same thing before any content. Its legitimate home already exists
            and is the page whose whole job is that question: the Overview
            worklist's own "every queue is clear". Nothing is lost either, because
            a sidebar with no badges on it says the same thing continuously.
          */}
            {children}
          </div>
          <div className="mt-8 flex flex-wrap items-center gap-3 md:hidden">
            <span className="text-[12.5px] text-muted">
              Signed in as {user}
            </span>
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
    </HintProvider>
  );
}

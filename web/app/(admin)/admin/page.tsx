"use client";

import Link from "next/link";
import {
  Card,
  ErrorNote,
  NotConfigured,
  PageHead,
  SampleBanner,
  Stat,
} from "@/components/admin/ui";
import { useAdminRows } from "@/lib/admin/client";
import type { Overview } from "@/lib/admin/types";

/**
 * Estimate 2.2 — the first screen.
 *
 * Rebuilt on 19 Aug, and the shape is the change. It used to open with eleven
 * stat tiles and four cards of breakdowns, fifteen rows in all, each with a
 * paragraph under it explaining a rule — so the answer to the only question
 * somebody opens this page with, *is there anything for me to do*, was somewhere
 * in the middle of a wall of numbers.
 *
 * Now it answers that first and once. **Waiting on you** lists only the queues
 * that are not empty; when they all are, it says so in a sentence. Everything
 * below it is context, in the order it gets asked for: how the pilot is going,
 * then what has been collected, then the breakdowns — with the explanatory
 * paragraphs gone, because each of them explained a rule the page cannot break.
 */
export default function AdminOverviewPage() {
  const { rows, configured, sample, demo, setDemo, loading, error } =
    useAdminRows<Overview | null>("overview");

  const o = rows;
  const completion =
    o && o.contributors.total > 0
      ? Math.round((o.contributors.completed / o.contributors.total) * 100)
      : null;
  const twoPlus =
    o && o.contributors.completed > 0
      ? Math.round((o.contributors.with_two_plus / o.contributors.completed) * 100)
      : null;

  /**
   * The worklist, most urgent first.
   *
   * **The urgency is in the words, not in a badge.** This carried a red "TODAY"
   * chip on the right, which nobody could read without being told what it meant
   * — the first thing the client asked about it was what it was. A row that says
   * "waiting to hear from you today" needs no legend.
   *
   * **And the counts must not overlap, or contradict the page they link to.**
   * `open_flags` includes the escalation flags, so listing both a total and the
   * sensitive questions separately showed eleven pieces of work where there were
   * nine. The first fix subtracted them but pointed the two rows at two
   * different pages, which was worse in a quieter way: the sidebar badge said 10
   * and this list said 8 about the same queue. Both rows now point at the read
   * queue and split it exactly the way that page does — urgent first, then
   * "other" — so 2 + 8 is the 10 the badge shows, and no number here disagrees
   * with any number there.
   */
  const readQueue = o
    ? Math.max(0, o.quality.open_flags - o.quality.escalations)
    : 0;

  const todo = o
    ? [
        {
          label: "need you today — a parent is waiting",
          n: o.quality.escalations,
          href: "/admin/flags",
          urgent: true,
        },
        {
          label: "other flags to read",
          n: readQueue,
          href: "/admin/flags",
          urgent: false,
        },
        {
          label: "recommendations to look at",
          n: o.quality.pending_contributions,
          href: "/admin/activities",
          urgent: false,
        },
        {
          label: "contributors to confirm",
          n: o.founding.pending,
          href: "/admin/founding",
          urgent: false,
        },
        {
          label: "caregivers held for you",
          n: o.quality.review_holds,
          href: "/admin/caregivers",
          urgent: false,
        },
        {
          label: "caregiver sign-ups to match",
          n: o.quality.pending_claims,
          href: "/admin/claims",
          urgent: false,
        },
        {
          label: "new names to approve",
          n: o.quality.pending_options,
          href: "/admin/options",
          urgent: false,
        },
      ].filter((t) => t.n > 0)
    : [];

  return (
    <>
      <PageHead
        title="Overview"
        intro="Where the pilot stands."
      />

      {error && <ErrorNote>{error}</ErrorNote>}
      {sample && <SampleBanner />}

      {loading && !o ? (
        <Card>
          <div className="px-4 py-10 text-center text-[13.5px] text-muted">
            Loading…
          </div>
        </Card>
      ) : !configured && !o ? (
        <Card>
          <NotConfigured demo={demo} onDemo={setDemo} />
        </Card>
      ) : o ? (
        <div className="space-y-6">
          <Card
            title="Waiting on you"
            className={
              todo.some((t) => t.urgent) ? "border-alert-line" : undefined
            }
          >
            {todo.length === 0 ? (
              <p className="px-4 py-4 text-[14px] text-ink-soft">
                Nothing right now — every queue is clear.
              </p>
            ) : (
              <ul className="divide-y divide-bark/50">
                {todo.map((t) => (
                  <li key={t.href + t.label}>
                    <Link
                      href={t.href}
                      className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-paper/70"
                    >
                      <span
                        className={`font-display text-[1.35rem] font-bold tabular-nums ${
                          t.urgent ? "text-alert" : "text-ink"
                        }`}
                      >
                        {t.n}
                      </span>
                      <span
                        className={`text-[14.5px] ${
                          t.urgent ? "font-medium text-alert" : "text-ink-soft"
                        }`}
                      >
                        {t.label}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              label="Contributors"
              value={o.contributors.total}
              hint={`${o.contributors.completed} finished`}
            />
            <Stat
              label="Finished the profile"
              value={completion === null ? "—" : `${completion}%`}
              hint="Of everyone who started"
              tone={completion !== null && completion < 50 ? "warn" : "plain"}
            />
            <Stat
              label="Shared two or more"
              value={twoPlus === null ? "—" : `${twoPlus}%`}
              hint="What the pilot is judged on"
              tone={twoPlus !== null && twoPlus >= 50 ? "good" : "plain"}
            />
            <Stat
              label="Earned the thank-you"
              value={o.reward.eligible}
              hint={`${o.reward.none} left nothing`}
              tone={o.reward.eligible > 0 ? "good" : "plain"}
            />
          </div>

          {/* What has come in — one line rather than four tiles, because these
              four numbers are only ever read against each other. */}
          <Card title="What parents have shared">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 px-4 py-3.5 text-[14px] sm:grid-cols-4">
              <Count label="Activities & camps" n={o.submissions.activities} />
              <Count label="Caregivers" n={o.submissions.caregivers} />
              <Count label="Places" n={o.submissions.places} />
              <Count label="Tips" n={o.submissions.tips} />
            </dl>
            <p className="border-t border-bark/70 px-4 py-2.5 text-[13px] text-muted">
              <Link
                href="/admin/activities?filter=golden"
                className="font-semibold text-green-deep underline underline-offset-2"
              >
                {o.answer_ready}
              </Link>{" "}
              of them are good enough to answer a question with on their own.
            </p>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Where the caregivers are">
              <ul className="divide-y divide-bark/50 text-[14px]">
                <Row label="Put forward by a family" value={o.caregivers.mentioned} />
                <Row label="Sent an invite" value={o.caregivers.invited} />
                <Row label="Said yes" value={o.caregivers.consented} />
                <Row label="Said no" value={o.caregivers.declined} />
              </ul>
            </Card>

            <Card title="What parents asked about">
              <ul className="divide-y divide-bark/50 text-[14px]">
                <Row label="Ordinary questions" value={o.demand.ordinary} />
                <Row label="Wanting to hear from others" value={o.demand.peer_support} />
                <Row label="Health, legal or safety" value={o.demand.high_stakes} />
                <Row label="About a named person" value={o.demand.named_allegation} />
              </ul>
            </Card>
          </div>

          {/* The funnel, only when there is one. It used to render as an empty
              card with a line about PostHog under it, which is a card that says
              nothing occupying half the screen. */}
          {o.drop_off.length > 0 && (
            <Card title="Where people stop">
              <ul className="divide-y divide-bark/50">
                {o.drop_off.map((row, i) => {
                  const first = o.drop_off[0]?.reached || 1;
                  const pct = Math.round((row.reached / first) * 100);
                  const lost = i > 0 ? o.drop_off[i - 1].reached - row.reached : 0;
                  return (
                    <li key={row.step} className="px-4 py-2.5">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="text-[14px]">{row.step}</span>
                        <span className="shrink-0 text-[13px] tabular-nums text-muted">
                          {row.reached}
                          {lost > 0 && (
                            <span className="ml-2 text-gold-ink">−{lost}</span>
                          )}
                        </span>
                      </div>
                      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-bark">
                        <div
                          className="h-full rounded-full bg-green"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
              {o.posthog_url && (
                <p className="border-t border-bark/70 px-4 py-2.5 text-[12.5px]">
                  <a
                    href={o.posthog_url}
                    target="_blank"
                    rel="noopener"
                    className="font-semibold text-green-deep underline underline-offset-2"
                  >
                    See the full funnel →
                  </a>
                </p>
              )}
            </Card>
          )}
        </div>
      ) : null}
    </>
  );
}

function Count({ label, n }: { label: string; n: number }) {
  return (
    <div>
      <dt className="text-[12.5px] text-muted">{label}</dt>
      <dd className="font-display text-[1.35rem] font-bold tabular-nums">{n}</dd>
    </div>
  );
}

function Row({ label, value }: { label: string; value: number }) {
  return (
    <li className="flex items-center justify-between gap-3 px-4 py-2.5">
      <span>{label}</span>
      <span className="font-display text-[1.05rem] font-bold tabular-nums">
        {value}
      </span>
    </li>
  );
}

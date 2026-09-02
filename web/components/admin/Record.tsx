"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * Record cards — the admin's second layout, for the queues a table cannot hold.
 *
 * ## Why this exists
 *
 * The admin is desktop-first and table-shaped on purpose (CLAUDE.md), and for
 * most of it that is right: `/admin/options` is six short columns, reads at a
 * glance, and every action fits on its row. But three queues are not lists of
 * short values — they are **records**: eight to ten attributes, several of them
 * whole sentences a parent wrote, plus three or four actions each.
 *
 * Forced into a table, that produces exactly what it produced. Walked in a
 * browser at 1440px, `/admin/activities` rendered a "Counts toward Founding"
 * cell as six lines of one word each — *"Not yet — they didn't say how old
 * their child was, who it suits, whether there's a catch"* down a 90px column —
 * beside an actions column where **"Add to Pando" wrapped mid-phrase across
 * three lines**. `/admin/demand` was worse in a way that is not even cosmetic:
 * its primary button read **"I've dealt with this…"**, an ellipsis truncating
 * the label of the button an admin is meant to press.
 *
 * A table's contract is that a column means the same thing on every row and can
 * be scanned down. Once a cell holds a sentence, that contract is void — the
 * column is just a narrow box with prose in it. So these queues become cards,
 * where the same facts get a line each and the actions get their full labels.
 *
 * ## What is deliberately *not* here
 *
 * A "card view" toggle. Two layouts for one queue means two things to keep
 * right, and the reason a row is a card is a property of the data rather than a
 * preference — `/admin/contributors` is a table because its values are short,
 * and it stays one.
 */

/**
 * A vertical list of records inside a `Card`, with a real divider between them.
 *
 * The divider is the whole point. `/admin/flags` rendered six flag blocks into
 * one white card with nothing between them, so a reader could not tell where
 * one flag ended and the next began — three uppercase micro-labels repeating
 * down the page with no structure to hang them on.
 */
export function RecordList({ children }: { children: ReactNode }) {
  return <div className="divide-y divide-bark/60">{children}</div>;
}

/**
 * A run of records that share a reason, with the reason said **once**.
 *
 * This is the third time the same fault has been fixed on this surface, so it
 * gets a component. CLAUDE.md records the first two: the Flags page printing
 * both the specific reason and the generic meaning of that kind of flag on
 * every card ("twelve cards each explaining themselves twice"), and the nav
 * hint duplicating each page's own intro. The version that survived both passes
 * is subtler — the card shows the specific reason *or* the generic one, which
 * is correct per card and still means that when no specific reason exists, the
 * identical paragraph appears on all twelve.
 *
 * A heading is where a fact that is true of many rows belongs. What is left on
 * the card is what differs between them.
 */
export function RecordGroup({
  title,
  count,
  meaning,
  children,
}: {
  title: string;
  count: number;
  /** What this kind of thing is, in one sentence, for the whole run. */
  meaning?: string | null;
  children: ReactNode;
}) {
  return (
    <section className="border-b border-bark/60 last:border-b-0">
      <header className="bg-paper/60 px-4 py-2.5">
        <h3 className="text-[13px] font-semibold text-ink">
          {title}
          <span className="ml-2 font-normal tabular-nums text-muted">{count}</span>
        </h3>
        {meaning && (
          <p className="mt-0.5 max-w-[80ch] text-[12.5px] leading-relaxed text-muted">
            {meaning}
          </p>
        )}
      </header>
      <div className="divide-y divide-bark/60">{children}</div>
    </section>
  );
}

/**
 * One record: what it is, what is known about it, what a parent wrote, and what
 * you can do about it.
 *
 * The header is the part that has to work hardest — it is what a reader scans
 * down the page — so the title is display-weight, the kind and status sit
 * beside it as badges, and everything else waits below.
 *
 * `tone` shades the whole card rather than adding a stripe: on `/admin/demand`
 * the alert rows genuinely are "owed a person today", and the section banner
 * above them says so once. A wash on every row is what made that page uniformly
 * pink — so `tone` is for the exception, and the default is a plain card.
 */
export function RecordCard({
  title,
  kind,
  badges,
  aside,
  children,
  actions,
  tone = "plain",
}: {
  title: ReactNode;
  /** A short type word — "activity", "place", "night / newborn". */
  kind?: ReactNode;
  /** Status and provenance pills. Kept out of `children` so they stay on line one. */
  badges?: ReactNode;
  /** The right-hand corner: who it came from, when. Secondary by definition. */
  aside?: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  tone?: "plain" | "urgent" | "pending";
}) {
  return (
    <article
      className={cn(
        "px-4 py-4",
        tone === "urgent" && "bg-alert-wash/50",
        tone === "pending" && "bg-gold-wash/40",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1 basis-[18rem]">
          <h3 className="font-display text-[1.05rem] font-semibold leading-snug tracking-[-0.01em]">
            {title}
            {kind && (
              <span className="ml-2 align-middle text-[11.5px] font-semibold uppercase tracking-[0.08em] text-muted">
                {kind}
              </span>
            )}
          </h3>
          {badges && <div className="mt-1.5 flex flex-wrap gap-1.5">{badges}</div>}
        </div>
        {aside && (
          /* Right-aligned only while it is actually in the right-hand corner.
             Once the header wraps on a phone the aside is a line of its own, and
             right-aligned text there reads as a layout mistake — "Tessa
             Nakamura" flush left over "Aug 1" adrift in the middle. */
          <p className="shrink-0 text-[12.5px] leading-relaxed text-muted sm:text-right">
            {aside}
          </p>
        )}
      </div>

      {children && <div className="mt-3.5">{children}</div>}

      {actions && (
        <div className="mt-4 flex flex-wrap items-center gap-2">{actions}</div>
      )}
    </article>
  );
}

/**
 * The short facts, as label-over-value pairs that reflow instead of squeezing.
 *
 * `auto-fit` with a `14rem` floor rather than a fixed column count: the same
 * card holds four facts on a laptop and two on a phone with no breakpoint to
 * maintain, and — the part a table could not do — **a fact never gets narrower
 * than a readable line**, because the grid drops a column instead.
 */
export function FactGrid({ children }: { children: ReactNode }) {
  return (
    <dl className="grid gap-x-6 gap-y-3 [grid-template-columns:repeat(auto-fit,minmax(14rem,1fr))]">
      {children}
    </dl>
  );
}

/**
 * One fact. The label is the question the parent was asked, in the words the
 * screen already uses; the value is their answer.
 *
 * An empty value renders an em dash rather than nothing, so a card with a gap
 * in it reads as "they skipped this" and not as a layout bug.
 */
export function Fact({
  label,
  children,
  hint,
}: {
  label: string;
  children?: ReactNode;
  /** One line under the value — a sub-answer, never an explanation of the label. */
  hint?: ReactNode;
}) {
  const empty = children === null || children === undefined || children === "";
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-semibold uppercase tracking-[0.07em] text-muted">
        {label}
      </dt>
      <dd className="mt-0.5 text-[13.5px] leading-snug text-ink">
        {empty ? <span className="text-muted">—</span> : children}
      </dd>
      {hint && <dd className="mt-0.5 text-[12.5px] leading-snug text-muted">{hint}</dd>}
    </div>
  );
}

/**
 * The other shape of label-and-value: a spec sheet, label beside value.
 *
 * `FactGrid` and this are both right, for different data, and the difference is
 * worth stating so the next page picks rather than copies. A **grid** suits a
 * handful of facts of mixed length that a reader scans across — six on a
 * contribution card. A **list** suits a long run of short values that a reader
 * scans *down* and compares between records — the ten answers a caregiver gave
 * about herself, where a grid would scatter them across three columns and make
 * two sign-ups impossible to compare side by side.
 *
 * It exists as a component because `/admin/claims` had already written it
 * locally, which made it the fourth private implementation of "label, value" on
 * this surface. The label column is fixed-width on purpose: a ragged left edge
 * is what stops a column of ten values from reading as a column.
 */
export function SpecList({ children }: { children: ReactNode }) {
  return <dl className="space-y-2.5 text-[13.5px]">{children}</dl>;
}

export function Spec({ label, children }: { label: string; children?: ReactNode }) {
  const empty = children === null || children === undefined || children === "";
  return (
    <div className="flex gap-2">
      <dt className="w-[9.5rem] shrink-0 text-[11px] font-semibold uppercase tracking-[0.07em] text-muted">
        {label}
      </dt>
      <dd className="min-w-0">
        {empty ? <span className="text-muted">—</span> : children}
      </dd>
    </div>
  );
}

/**
 * A parent's own words, marked as theirs.
 *
 * Not styling for its own sake: invariant 8 turns on the difference between
 * what a parent wrote and what the system says about it, and a reviewer reading
 * a queue has to be able to tell those apart without checking. Italic quoted
 * prose against a green rule is the one treatment reserved for it — the admin's
 * own sentences are never rendered this way.
 */
export function Quote({
  label,
  children,
}: {
  /** What this text answers — "Know first", "What they liked". */
  label?: string;
  children: ReactNode;
}) {
  return (
    <figure className="border-l-2 border-green/30 pl-3">
      {label && (
        <figcaption className="text-[11px] font-semibold uppercase tracking-[0.07em] text-muted">
          {label}
        </figcaption>
      )}
      <blockquote className="mt-0.5 text-[13.5px] italic leading-relaxed text-ink-soft">
        {children}
      </blockquote>
    </figure>
  );
}

/**
 * A stack of quotes and notes under the facts, spaced so two of them do not
 * read as one paragraph.
 */
export function RecordNotes({ children }: { children: ReactNode }) {
  return <div className="mt-3.5 space-y-2.5">{children}</div>;
}

/**
 * The panel an action opens inside a card — the edit form, the hold question.
 *
 * Inset on `paper` rather than floating: it belongs to the record above it, and
 * a modal for a two-field edit would take the reader off a queue they are
 * working down.
 */
export function RecordDrawer({
  title,
  children,
}: {
  title?: string;
  children: ReactNode;
}) {
  return (
    <div className="mt-4 rounded-xl border border-bark bg-paper/70 p-3.5">
      {title && (
        <p className="mb-2.5 text-[11.5px] font-semibold uppercase tracking-[0.07em] text-muted">
          {title}
        </p>
      )}
      {children}
    </div>
  );
}

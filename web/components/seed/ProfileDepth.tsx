"use client";

import Link from "next/link";
import { Panel } from "@/components/ui/Panel";
import type { ProfileDepth } from "@/lib/questions";

/**
 * How full a parent's profile is, and why filling it in is worth their time.
 *
 * The developer, 16 Sep: show a parent when they save that they should fill the
 * profile in as fully as possible for the quality of the answers they get back,
 * on the save screen and at the top of `/share`, with a bar for how far along
 * they are.
 *
 * ## The one thing this must not say
 *
 * ⚠⚠ **It never promises access.** The client's own appendix is that P14 — the
 * participation level — is the only thing that gates Community Access, and
 * `profileCompleteness` has carried the comment *"informational only; it never
 * gates anything"* since it was written. So the copy is about **relevance**,
 * which is true and is measurable: a parent who taps Continue at the fork
 * produces two affinity edges and two relevance rows that deliberately score
 * zero (measured through the real derivation, 10 Sep), so their answers really
 * are matched on less.
 *
 * ⚠ And it never nags. There is no red, no "incomplete", no warning tone: gold
 * in this app means *pending or needs care* and `alert` never appears in the
 * parent flow at all. A profile at 14% is not a mistake somebody made, it is a
 * parent who answered what was asked of them — the optional questions are
 * optional, which is the whole of the 10 Sep round.
 */
export function DepthBar({
  depth,
  className,
}: {
  depth: ProfileDepth;
  className?: string;
}) {
  return (
    <div className={className}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-semibold uppercase text-eyebrow tracking-eyebrow text-muted">
          Profile filled in
        </span>
        <span className="font-semibold text-control text-green-deep tabular-nums">
          {depth.percent}%
        </span>
      </div>
      {/**
       * `role="progressbar"` with the real numbers on it, because the bar is
       * the whole of the information: without them a screen reader gets a
       * decorative div and the percentage beside it has no relationship to it.
       * The visible figure is the accessible name's own text, so the two
       * cannot drift.
       */}
      <div
        role="progressbar"
        aria-valuenow={depth.percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`Profile filled in: ${depth.percent}%, ${depth.answered} of ${depth.total} questions answered`}
        className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-bark/30"
      >
        <div
          className="h-full rounded-full bg-green transition-[width] duration-500"
          style={{ width: `${Math.max(depth.percent, 2)}%` }}
        />
      </div>
    </div>
  );
}

/**
 * The bar with the reason beside it.
 *
 * `tone="positive"` rather than gold: this is an invitation, and the green
 * register is the one this flow uses for reassurance. A parent who has filled
 * everything in is told so and is not offered a link to a screen with nothing
 * left on it.
 */
export function DepthBanner({
  depth,
  href,
  className,
}: {
  depth: ProfileDepth;
  /** Where "add more" goes. Omitted on the profile itself, where they are already there. */
  href?: string;
  className?: string;
}) {
  const done = depth.answered >= depth.total;
  return (
    <Panel tone="positive" size="inset" className={className}>
      <DepthBar depth={depth} />
      <p className="mt-3 leading-relaxed text-help text-muted">
        {done
          ? "That is everything — Pando has the full picture, so the parents it asks for you are the ones whose lives really overlap with yours."
          : "Every answer sharpens what Pando sends back — it matches you on what your family really has in common with other parents. Nothing here is required; add more whenever you like."}
      </p>
      {!done && href && (
        <Link
          href={href}
          className="mt-2.5 inline-flex min-h-11 items-center text-control font-semibold text-green-deep underline underline-offset-4"
        >
          Add more detail
        </Link>
      )}
    </Panel>
  );
}

"use client";

import { InlineAction } from "@/components/ui/TextAction";
import { cn } from "@/lib/cn";
import { profileBannerShows, type ProfileDepth } from "@/lib/questions";

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

/**
 * The review page's header bar (16 Sep): *"Replace the '3 left' display with a
 * percentage-based progress bar … organically with the other bars, for example
 * the bar of a question."* So it is the question screens' bar in every
 * dimension — the same 4px track, the same `bg-bark` ground and `bg-green`
 * fill, the same header slot — with one continuous fill instead of segments,
 * because on the review page every step is done and what is still open is how
 * much of the profile is filled in.
 */
export function ProfilePercentBar({ depth }: { depth: ProfileDepth }) {
  return (
    <div
      role="progressbar"
      aria-valuenow={depth.percent}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={`Profile ${depth.percent}% done, ${depth.answered} of ${depth.total} questions answered`}
      className="h-1 w-full overflow-hidden rounded-full bg-bark"
    >
      <div
        className="h-full rounded-full bg-green transition-[width] duration-500"
        style={{ width: `${depth.percent}%` }}
      />
    </div>
  );
}

/** The header's right-hand label, in the slot and type "3 left" uses. */
export function ProfilePercentLabel({ depth }: { depth: ProfileDepth }) {
  return (
    <span className="px-1 font-medium text-muted text-dock tabular-nums">
      {depth.percent}% done
    </span>
  );
}

/**
 * The question screens' header (21 Sep): *"on this progress bar also add a
 * number/banner — how many percent of the profile is filled in"*. It sits
 * beside "3 left" rather than replacing it, and the two answer different
 * questions — how many screens remain in this walk, and how much of the whole
 * profile is filled in — so the pill names its subject and what the number
 * measures ("Profile 60% complete"), or the two read as one measure said twice
 * and disagreeing. "Profile 60%" alone was reported (21 Sep) as not saying
 * what the 60% was of. Green, never gold: a thin profile is not something
 * pending or wrong.
 *
 * ⚠ **Solid, not a wash** (21 Sep, the developer: *"він зливається з
 * контентом"*). Green-wash on the paper header measured as one surface, so
 * the one number meant to be noticed was the easiest thing on the screen to
 * miss. White on green-deep is ~8:1 and reads as a badge rather than a tint.
 */
export function ProfilePercentPill({ depth }: { depth: ProfileDepth }) {
  return (
    <span
      className="whitespace-nowrap rounded-full bg-green-deep px-2.5 py-1 font-semibold text-white text-dock tabular-nums shadow-sm"
      aria-label={`Profile ${depth.percent}% filled in`}
    >
      Profile {depth.percent}% complete
    </span>
  );
}

/**
 * A banner pinned in the header of every screen a parent with a saved profile
 * meets, until the profile is full enough (21 Sep, three instructions in one
 * day: make the pop-up a banner; put it on the recommendations screen and the
 * others; *"це має бути закріплено в хедері"*).
 *
 * ⚠ It replaces `ProfileToast` — a pop-up in the corner, eight seconds,
 * dismissible — which could not be there when a parent came back to the
 * screen and wondered what was left, and only ever appeared on one of the
 * five screens they walk.
 *
 * ## Why it is one line and not the paragraph it started as
 *
 * ⚠⚠ **Pinning is what decided the copy, and it was measured rather than
 * argued.** As a three-line block in `ScreenHeader`'s `below` slot the
 * header came to **181px on a 375×812 phone — 22% of the window, permanently**,
 * on a screen that also carries a sticky dock. So the explanatory sentence
 * (*"Fill in the rest and Pando can match you…"*) is **gone from the
 * product**, which is a real loss and hers to place somewhere if she wants
 * it: what is pinned is the figure, the count and the way in.
 *
 * ## The threshold is the product's own number, not a new one
 *
 * *"Потрібний відсоток"* is `FOUNDING_MIN_PROFILE_DEPTH` — 80, the profile bar
 * the Founding queue decides on (16 Sep). 100 was measured on the live cohort
 * at **one parent in twelve**, so a banner that waited for it would be
 * permanent for everybody who took the flow's own shortest path, which is the
 * client's own 10 Sep design. Tying it to the existing constant also means the
 * two cannot drift: the day she moves the Founding bar, the nagging stops at
 * the same place.
 *
 * ⚠⚠ **It promises relevance and never access.** P14 alone gates Community
 * Access and the Founding reward needs two approved contributions as well, so
 * naming either would be a claim this number cannot keep. The threshold
 * decides when this stops appearing and nothing else.
 *
 * ⚠ Green, never gold: a profile under the bar is a parent who answered what
 * was asked of them, not something pending or wrong.
 *
 * ⚠ **Not dismissible, which is the instruction and has a cost**: this file's
 * own rule is that the depth never nags, and a strip a parent cannot send
 * away is the closest this app comes to it. It is one row for that reason,
 * and it disappears the moment it is no longer true.
 */
export function ProfileBanner({
  depth,
  className,
  onProfile,
}: {
  depth: ProfileDepth;
  className?: string;
  /**
   * ⚠ Set on the review page, where the link is dropped: a parent is
   * standing on `/profile`, so *Add more* would be a control that visibly
   * does nothing — and the fold on that screen lists every question the
   * percentage counts, each with its own **Add**. That is the same reasoning
   * that took *Complete your profile* off it on 17 Sep.
   */
  onProfile?: boolean;
}) {
  if (!profileBannerShows(depth)) return null;
  return (
    <div
      className={cn(
        "mt-2 rounded-xl border border-green/25 bg-green-wash px-3 py-2",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <p className="min-w-0 truncate font-semibold text-green-deep text-dock">
          Profile {depth.percent}% complete
          <span className="font-medium text-green-deep/70">
            {" · "}
            {depth.answered} of {depth.total}
          </span>
        </p>
        {!onProfile && (
          <InlineAction href="/profile" className="shrink-0">
            Add more
          </InlineAction>
        )}
      </div>
      {/**
       * ⚠ The bar is here and **not** on the review's header as well: that
       * screen used to draw its own under the step counter, and two 4px
       * tracks a few pixels apart are one measure drawn twice.
       */}
      <div className="mt-1.5">
        <ProfilePercentBar depth={depth} />
      </div>
    </div>
  );
}

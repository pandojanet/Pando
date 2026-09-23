"use client";

import Link from "next/link";
import { cn } from "@/lib/cn";
import { profileReminderShows, type ProfileDepth } from "@/lib/questions";

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
 * ⚠ And it never nags in words. There is no "incomplete" and no warning copy:
 * a profile at 14% is not a mistake somebody made, it is a parent who answered
 * what was asked of them — the optional questions are optional, which is the
 * whole of the 10 Sep round. ⚠ The reminder's **bar** is coloured red, yellow or
 * green by how full the profile is since 23 Sep, on the developer's instruction;
 * that is the one place `alert` appears in the parent flow — see `reminderFill`.
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
export function ProfilePercentBar({
  depth,
  fill = "bg-green",
}: {
  depth: ProfileDepth;
  /** The fill's colour class. The reminder passes `reminderFill`. */
  fill?: string;
}) {
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
        className={cn("h-full rounded-full transition-[width] duration-500", fill)}
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
 * The bar's colour, from how full the profile is (23 Sep): *"червоний 0–50%,
 * жовтий 50–70%, зелений 70–100%"*.
 *
 * ⚠ Boundaries read as half-open ranges — under 50 red, 50 to 69 yellow, 70 and
 * over green — so a profile at exactly 50 is yellow and at exactly 70 is green.
 * The reminder stops showing at 80 (`FOUNDING_MIN_PROFILE_DEPTH`), so green is
 * only ever seen between 70 and 79.
 *
 * ⚠⚠ **This puts `alert` red in the parent flow, which this app has kept out of
 * it on purpose**: the token's own rule is that red means *owed a person today*,
 * and "a thin profile is not a mistake somebody made" is the first thing this
 * file says. It is the developer's explicit instruction, so it is here — and it
 * is one class in one function, so reverting it is a one-line change.
 */
export function reminderFill(percent: number): string {
  if (percent < 50) return "bg-alert";
  if (percent < 70) return "bg-gold";
  return "bg-green";
}

/**
 * The profile reminder — a strip inside the header, on every screen a parent
 * with a saved profile meets, until the profile is full enough.
 *
 * ## Read the instructions in order, because most of them are reversals
 *
 * 1. Replace the review page's *"N questions still to answer…"* paragraph with
 *    a pop-up saying how much is left (21 Sep).
 * 2. Put that pop-up in the bottom-right corner.
 * 3. Make it a permanent banner on five screens — then pin it in the header,
 *    as a strip with the figure, a count, a bar and a link.
 * 4. The client did not want the strip: bring back the corner pop-up.
 * 5. On a phone that corner is the middle of the screen: move it up, one line.
 * 6. Under the header it covered the first message: put it *in* the header.
 * 7. Only on a phone; the laptop keeps the corner card (22 Sep).
 * 8. **"змісти банер вгору і зроби все що описано на цьому скріншоті"** (23 Sep)
 *    — the screenshot is (3)'s strip, annotated: spacing below the logo row,
 *    the bar coloured by how full the profile is, "10 out of 20", and a
 *    smaller, lighter "Add more". So it is the strip, in the header, at every
 *    width, and the corner card is gone.
 *
 * ⚠ **It pushes rather than paints.** It is ordinary content in
 * `ScreenHeader`'s `below` slot, which is `sticky top-0`, so it travels with
 * the scroll by being part of the thing that already does, and it covers
 * nothing — the complaint every floating version earned.
 *
 * ⚠ **It cannot be sent away**, which is instruction (4) in so many words. What
 * keeps it honest is that it is small and gone the moment it stops being true.
 *
 * ## The threshold is the product's own number, not a new one
 *
 * `FOUNDING_MIN_PROFILE_DEPTH` — 80, the profile bar the Founding queue
 * decides on (16 Sep). 100 was measured on the live cohort at one parent in
 * twelve, so a reminder waiting for it would be permanent for everybody who took
 * the flow's own shortest path.
 *
 * ⚠⚠ **It promises relevance and never access.** P14 alone gates Community
 * Access and the Founding reward needs two approved contributions as well.
 */
export function ProfileReminder({
  depth,
  onProfile,
}: {
  depth: ProfileDepth;
  /**
   * ⚠ Set on the review page, where the link is dropped: a parent is standing
   * on `/profile`, so *Add more* would be a control that visibly does nothing.
   */
  onProfile?: boolean;
}) {
  if (!profileReminderShows(depth)) return null;
  return (
    <div className="mt-3 rounded-xl border border-green/25 bg-green-wash px-3 py-2">
      <div className="flex items-center justify-between gap-3">
        <p className="min-w-0 truncate font-semibold text-green-deep text-dock tabular-nums">
          Profile {depth.percent}% complete
          <span className="font-medium text-green-deep/70">
            {` · ${depth.answered} out of ${depth.total}`}
          </span>
        </p>
        {!onProfile && (
          /* Smaller and lighter than the other quiet actions, on the
             screenshot's "задуже велике і жирне": it is the figure's aside,
             not the screen's next step. The negative margin keeps the hit area
             taller than the 12.5px line without moving it. */
          <Link
            href="/profile"
            className="-my-2 shrink-0 py-2 font-medium text-dock text-green-deep underline underline-offset-2 hover:text-green"
          >
            Add more
          </Link>
        )}
      </div>
      <div className="mt-1.5">
        <ProfilePercentBar depth={depth} fill={reminderFill(depth.percent)} />
      </div>
    </div>
  );
}

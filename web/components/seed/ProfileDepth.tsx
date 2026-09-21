"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
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
 * The profile reminder: a card in the bottom-right corner that travels with
 * the scroll and stays until the profile is full enough.
 *
 * ## Read the four instructions in order, because three of them are reversals
 *
 * 1. Replace the review page's *"N questions still to answer…"* paragraph
 *    with a pop-up saying how much is left (21 Sep).
 * 2. Put that pop-up in the bottom-right corner, *"де якраз пустий кут"*.
 * 3. Make it a permanent banner, on the recommendations screen and the
 *    others too, until the profile reaches the needed percentage — so it
 *    became an in-flow green block, then a strip pinned in the header.
 * 4. **The client did not want that** (*"обриганство"*): bring back the
 *    pop-up's look and its place, and make it permanent there — *"щоб він не
 *    зникав і був разом з прокруткою на всіх сторінках"*.
 *
 * So the appearance of (2) is back, with (3)'s two properties on it: it is on
 * **five** screens rather than one, and it has **no timer and no X**. What
 * went with the header strip is the strip's own compromise — the explanatory
 * sentence is back, because a floating card has room for it where 22% of a
 * pinned header did not.
 *
 * ## Four rules, and the first is the one that breaks silently
 *
 * - **Portalled to `body`.** It is `position: fixed`, and these screens sit
 *   inside animated wrappers — a filled animation makes its element the
 *   containing block for `fixed` (the 5 Aug bug), so a card rendered in place
 *   would be clipped to its column and simply not appear where it was asked
 *   to be.
 * - **Held clear of the dock, measured rather than guessed.**
 *   `window.innerHeight - dock.top`, clamped at zero, is the dock's height
 *   while it is pinned at the foot of a phone, zero while it is static and
 *   below the fold on a laptop, and its visible part on a laptop scrolled to
 *   the end — one expression for all three, off the `data-screen-dock` marker
 *   `OptionPicker` already measures. Re-measured on scroll and resize, eased
 *   over 300ms so it glides. ⚠ Covering the dock's primary control — **Save
 *   my profile**, **Continue** — is the one thing this must never do.
 * - **It cannot be sent away**, which is instruction (4) in so many words, and
 *   it is why there is no X: a control that hides it would make *не зникав*
 *   false. ⚠ The cost is real and this file's own rule is that the depth
 *   never nags — what keeps it honest is that it is small, it is green rather
 *   than gold, and it goes the moment it stops being true.
 * - **Ordinary content, not a live region.** The 8-second version needed an
 *   `sr-only role="status"` because a portal that mounts with its message
 *   announces nothing; a permanent card is just text a reader reaches.
 *
 * ## The threshold is the product's own number, not a new one
 *
 * `FOUNDING_MIN_PROFILE_DEPTH` — 80, the profile bar the Founding queue
 * decides on (16 Sep). 100 was measured on the live cohort at **one parent in
 * twelve**, so a reminder waiting for it would be permanent for everybody who
 * took the flow's own shortest path, which is the client's own 10 Sep design.
 *
 * ⚠⚠ **It promises relevance and never access.** P14 alone gates Community
 * Access and the Founding reward needs two approved contributions as well, so
 * naming either would be a claim this number cannot keep.
 */
const REMINDER_GAP = 12;

export function ProfileReminder({
  depth,
  onProfile,
}: {
  depth: ProfileDepth;
  /**
   * ⚠ Set on the review page, where the link is dropped: a parent is standing
   * on `/profile`, so *Add more* would be a control that visibly does
   * nothing — and the fold on that screen lists every question the percentage
   * counts, each with its own **Add**. Same reasoning as 17 Sep.
   */
  onProfile?: boolean;
}) {
  const [floor, setFloor] = useState(REMINDER_GAP);
  const shows = profileReminderShows(depth);

  useEffect(() => {
    if (!shows) return;
    /**
     * ⚠⚠ **Scroll and resize are not enough, and the shortfall was measured.**
     * On `/done/ask` the dock grows from 73px to 81 once `/verify/status`
     * answers and the screen learns which control to show — no scroll, no
     * resize, so the floor stayed at 85 and the gap came out at **4px instead
     * of 12**. So the thing being avoided is what is watched: a
     * `ResizeObserver` on the dock itself, **plus `document.body`**, because
     * React can replace the dock element rather than resize it and an
     * observer bound to a node that is gone reports nothing — the body's
     * height changes either way, which brings `measure` back round to re-bind.
     *
     * ⚠ **Unverified in a real browser, and the reason is worth knowing.** A
     * hidden document does not run the rendering steps that deliver a
     * `ResizeObserver` callback, so in the Browser pane that 4px stands: the
     * same family as the frozen animations and the scroll that fires no
     * event. What *was* proved there is that the arithmetic is right —
     * dispatching a `resize` by hand corrects it to `bottom: 93px` and a gap
     * of exactly 12.
     */
    let observed: Element | null = null;
    const measure = () => {
      const dock = document.querySelector("[data-screen-dock]");
      if (dock !== observed) {
        if (observed) ro.unobserve(observed);
        if (dock) ro.observe(dock);
        observed = dock;
      }
      const box = dock?.getBoundingClientRect();
      const covered = box ? window.innerHeight - box.top : 0;
      setFloor(REMINDER_GAP + Math.max(0, covered));
    };
    const ro = new ResizeObserver(() => measure());
    ro.observe(document.body);
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, { passive: true });
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure);
    };
  }, [shows]);

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!shows || !mounted) return null;

  return createPortal(
    <div
      className="pointer-events-none fixed inset-x-3 z-50 flex justify-end transition-[bottom] duration-300 ease-out sm:inset-x-auto sm:right-4"
      style={{ bottom: floor }}
    >
      <div className="pointer-events-auto flex w-full max-w-[23rem] animate-rise flex-col rounded-2xl bg-green-deep px-4 py-3 text-white shadow-card">
        <p className="font-semibold leading-snug text-control tabular-nums">
          Your profile is {depth.percent}% complete — {100 - depth.percent}% to
          go.
        </p>
        <p className="mt-1 leading-snug text-help text-white/85">
          Fill in the rest and Pando can match you with parents whose
          experience is closest to yours.
          {!onProfile && (
            <>
              {" "}
              <Link
                href="/profile"
                className="font-semibold text-white underline underline-offset-2"
              >
                Add more
              </Link>
            </>
          )}
        </p>
      </div>
    </div>,
    document.body,
  );
}

"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
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
 * The bar's colour, from how full the profile is — *"<40% red, 40-70% yellow,
 * 70%+ green"* (23 Sep, second pass; the first said 50/70).
 *
 * ⚠ Boundaries read as half-open ranges — under 40 red, 40 to 69 yellow, 70 and
 * over green — so a profile at exactly 40 is yellow and at exactly 70 is green.
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
  if (percent < REMINDER_RED_BELOW) return "bg-alert";
  if (percent < REMINDER_YELLOW_BELOW) return "bg-gold";
  return "bg-green";
}

/** The two thresholds, once, so the bar and the pop-up cannot disagree. */
export const REMINDER_RED_BELOW = 40;
export const REMINDER_YELLOW_BELOW = 70;

/**
 * The pop-up's colours — the same three ranges as the bar (23 Sep: *"той попап
 * має бути в кольорі відповідно до відсотка заповненості профіля"*).
 *
 * ⚠ **Yellow carries dark text, and that is contrast rather than taste**:
 * white on `gold` (#d9a31c) is about 2.3:1 and fails, ink on it passes. Red
 * (`alert`) and green (`green-deep`) both carry white comfortably.
 */
export function reminderTone(percent: number): {
  card: string;
  soft: string;
  link: string;
} {
  if (percent < REMINDER_RED_BELOW) {
    return { card: "bg-alert text-white", soft: "text-white/85", link: "text-white" };
  }
  if (percent < REMINDER_YELLOW_BELOW) {
    return { card: "bg-gold text-ink", soft: "text-ink/80", link: "text-ink" };
  }
  return { card: "bg-green-deep text-white", soft: "text-white/85", link: "text-white" };
}

/**
 * Whether this device has closed the pop-up (23 Sep).
 *
 * A per-device convenience, so `localStorage` — and every read and write is
 * wrapped, because a private window or blocked site data throws, and the
 * reminder must still render (it falls back to the pop-up). Components on one
 * page hear each other through an event, so the review header and the reminder
 * in it change together when the X is pressed.
 */
const CLOSED_KEY = "pando.profile-reminder.closed";
const CLOSED_EVENT = "pando:profile-reminder-closed";

function readClosed(): boolean {
  try {
    return window.localStorage.getItem(CLOSED_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * `[mounted, closed, close]`. Before mount nothing is known — the server has
 * no `localStorage` — so callers render the neutral state until then rather
 * than guess and change under the reader.
 */
export function useReminderClosed(): [boolean, boolean, () => void] {
  const [mounted, setMounted] = useState(false);
  const [closed, setClosed] = useState(false);
  useEffect(() => {
    setClosed(readClosed());
    setMounted(true);
    const sync = () => setClosed(readClosed());
    window.addEventListener(CLOSED_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(CLOSED_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  const close = () => {
    try {
      window.localStorage.setItem(CLOSED_KEY, "1");
    } catch {
      /* Blocked storage: it closes for this page view, which is what was asked. */
    }
    setClosed(true);
    window.dispatchEvent(new Event(CLOSED_EVENT));
  };
  return [mounted, closed, close];
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
 * ⚠ **The strip cannot be sent away; the pop-up can** (instruction 9, 23 Sep).
 * Closing the pop-up is what brings the strip, so a parent always has one of
 * the two until the profile clears the bar.
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
  const [mounted, closed, close] = useReminderClosed();
  if (!profileReminderShows(depth) || !mounted) return null;
  /**
   * ⚠⚠ **9. The pop-up comes back first, and the strip is what closing it
   * leaves** (23 Sep): *"поверни той попап, що показував відсотки, як він був
   * до того, але перемісти його вверх … з можливістю його закрити (хрестиком).
   * Після закриття цей банер стає таким, як є зараз."* So until this device
   * presses the X, the reminder is (4)'s card in the **top**-right corner; after
   * it, the strip below. One reminder at a time, never both.
   */
  if (!closed) {
    return <FloatingReminder depth={depth} onProfile={onProfile} onClose={close} />;
  }
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

/**
 * (4)'s corner card, in the **top**-right corner this time, with an X.
 *
 * ⚠ **Portalled to `body`**: it is `position: fixed`, and these screens sit
 * inside animated wrappers — a filled animation makes its element the
 * containing block for `fixed` (the 5 Aug bug), so a card rendered in place
 * would be clipped to its column.
 *
 * ⚠ **Just under the header, measured rather than guessed**: the header is
 * sticky, so its bottom edge is where the free space starts, and it changes
 * height (the review's bar, the safe-area inset) — hence a `ResizeObserver` on
 * it rather than a constant. On a phone the card spans the width under the
 * header, because a 375px screen has no empty corner; the X is what makes that
 * acceptable, and the strip it leaves covers nothing.
 */
function FloatingReminder({
  depth,
  onProfile,
  onClose,
}: {
  depth: ProfileDepth;
  onProfile?: boolean;
  onClose: () => void;
}) {
  const [top, setTop] = useState(80);
  useEffect(() => {
    const header = document.querySelector("[data-screen-header]");
    const measure = () => {
      const box = header?.getBoundingClientRect();
      setTop((box ? Math.max(0, box.bottom) : 68) + 12);
    };
    measure();
    const ro = header ? new ResizeObserver(measure) : null;
    if (header) ro?.observe(header);
    window.addEventListener("resize", measure);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  const tone = reminderTone(depth.percent);
  return createPortal(
    <div
      className="pointer-events-none fixed inset-x-3 z-40 flex justify-end sm:inset-x-auto sm:right-4"
      style={{ top }}
    >
      <aside
        aria-label="How full your profile is"
        className={cn(
          "pointer-events-auto relative w-full max-w-[23rem] animate-rise rounded-2xl py-3 pl-4 pr-12 shadow-card",
          tone.card,
        )}
      >
        <p className="font-semibold leading-snug text-control tabular-nums">
          {`Your profile is ${depth.percent}% complete — ${100 - depth.percent}% to go.`}
        </p>
        <p className={cn("mt-1 leading-snug text-help", tone.soft)}>
          Fill in the rest and Pando can match you with parents whose experience
          is closest to yours.
          {!onProfile && (
            <>
              {" "}
              <Link
                href="/profile"
                className={cn("font-semibold underline underline-offset-2", tone.link)}
              >
                Add more
              </Link>
            </>
          )}
        </p>
        {/* 44px, named, and the one way to send it away; what it leaves is the
            strip in the header, which covers nothing. */}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close — keep it as a line in the header"
          className="absolute right-1 top-1 flex h-11 w-11 items-center justify-center rounded-full hover:bg-black/10"
        >
          <X aria-hidden="true" className="h-4 w-4" />
        </button>
      </aside>
    </div>,
    document.body,
  );
}

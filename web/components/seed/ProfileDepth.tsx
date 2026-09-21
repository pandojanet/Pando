"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { usePresence } from "@/lib/use-presence";
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
 * A pop-up on arriving at the review page: how far the profile is from full,
 * to get a parent to fill in the rest (21 Sep). It replaced the paragraph that
 * sat under "Does this look right?" — *"6 questions still to answer. Pando
 * matches you on…"* — which the developer had removed in full.
 *
 * ⚠⚠ **It promises relevance and never access.** The client's appendix is that
 * P14 alone gates Community Access, and `profileCompleteness` has carried
 * *"informational only — it never gates anything"* since it was written.
 *
 * Four rules:
 *
 * - **Portalled to `body`.** It is `position: fixed`, and the review page sits
 *   inside an animated wrapper — a filled animation makes its element the
 *   containing block for `fixed` (the 5 Aug bug), so a toast rendered in place
 *   would be clipped to the review column.
 * - **Announced through a region that is already in the document.** The
 *   portal mounts together with its text, and a region that arrives with its
 *   message announces nothing (`TypingDots`, `CopyButton`) — so an in-flow
 *   `sr-only` status line carries the words and the visual toast is hidden
 *   from the accessibility tree.
 * - **Decided once, on arrival.** Whether it shows is read at mount; editing
 *   an answer and coming back is a new arrival and it shows again, which is
 *   the moment a parent is deciding whether they are done.
 * - **It leaves on its own and can be sent away.** Eight seconds, or the X —
 *   a message that cannot be dismissed is a banner that covers the header.
 */
export function ProfileToast({ depth }: { depth: ProfileDepth }) {
  const [open, setOpen] = useState(false);
  const shown = usePresence(open, 220);
  const initial = useRef(depth);
  const { percent } = initial.current;
  const complete = initial.current.total === 0 || percent >= 100;

  useEffect(() => {
    if (complete) return;
    const show = window.setTimeout(() => setOpen(true), 450);
    const hide = window.setTimeout(() => setOpen(false), 8450);
    return () => {
      window.clearTimeout(show);
      window.clearTimeout(hide);
    };
  }, [complete]);

  if (complete) return null;
  const message = `Your profile is ${percent}% complete — ${100 - percent}% to go.`;
  const why =
    "Fill in the rest and Pando can match you with parents whose experience is closest to yours.";

  return (
    <>
      <p className="sr-only" role="status">
        {open ? `${message} ${why}` : ""}
      </p>
      {shown &&
        createPortal(
          <div className="pointer-events-none fixed inset-x-0 top-3 z-50 flex justify-center px-4">
            <div
              aria-hidden="true"
              className={`pointer-events-auto flex w-full max-w-[26rem] items-start gap-2 rounded-2xl bg-green-deep py-3 pl-4 pr-1 text-white shadow-card ${
                open ? "animate-rise" : "animate-fade-out"
              }`}
            >
              <div className="min-w-0 flex-1">
                <p className="font-semibold leading-snug text-control tabular-nums">{message}</p>
                <p className="mt-1 leading-snug text-help text-white/85">{why}</p>
              </div>
              <button
                type="button"
                tabIndex={-1}
                onClick={() => setOpen(false)}
                className="grid size-11 shrink-0 place-items-center rounded-full text-white/85 hover:text-white"
              >
                <X size={18} aria-hidden />
                <span className="sr-only">Dismiss</span>
              </button>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

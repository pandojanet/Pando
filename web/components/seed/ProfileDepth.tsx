"use client";

import { TextAction } from "@/components/ui/TextAction";
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
 * *"20% done — the stronger your profile, the better your matches,"* with a
 * direct path to complete it (16 Sep). One line and one action, so it fits the
 * review page's minimal-text rule and the top of `/share` alike.
 *
 * Exactly one of `onComplete` (the review page, which can jump straight to the
 * first unanswered question) or `href` (anywhere else). Renders nothing at 100%:
 * a reminder that cannot be acted on is chrome.
 *
 * ⚠ **`part` splits the sentence from the control, and only the review page
 * uses it** (16 Sep, the developer: *"Complete your profile перенесемо теж під
 * Save your profile"*). There the two halves end up on different parts of one
 * screen — the argument above the answers it is about, the action in the dock
 * beside Save — so they cannot be one block. Measured whole in the dock it cost
 * **235px of an 812px phone**, and its first clause repeated the *"N% done"*
 * already in the header bar two inches above.
 *
 * ⚠ The 100% rule is checked once, here, for both halves — a build that
 * rendered the sentence and hid the control, or the reverse, is the fault this
 * split most easily introduces.
 */
export function DepthReminder({
  depth,
  onComplete,
  href,
  part = "both",
  className,
}: {
  depth: ProfileDepth;
  onComplete?: () => void;
  href?: string;
  part?: "both" | "note" | "action";
  className?: string;
}) {
  if (depth.total === 0 || depth.answered >= depth.total) return null;
  return (
    <div className={className}>
      {part !== "action" && (
        <p className="leading-relaxed text-help text-muted">
          <span className="font-semibold text-green-deep tabular-nums">
            {depth.percent}% done
          </span>
          {" — the stronger your profile, the better your matches."}
        </p>
      )}
      {part !== "note" &&
        (href ? (
          <TextAction href={href}>Complete your profile</TextAction>
        ) : (
          <TextAction onClick={onComplete}>Complete your profile</TextAction>
        ))}
    </div>
  );
}

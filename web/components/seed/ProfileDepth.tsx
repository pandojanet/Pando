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
 * ## `part`, and what each value is for
 *
 * `both` is `/share`: the percentage, the argument and the way back to the
 * questions, in one block above the thread.
 *
 * `lead` is the review screen, and it carries **no percentage and no control**.
 * ⚠⚠ **Both absences are deliberate and each reverses something.** The number
 * is on that screen twice already — `ProfilePercentLabel` in the header slot
 * and `ProfilePercentBar` under it — so a third saying of it was the one thing
 * the 16 Sep dock note had already complained about, and spending the line on
 * the argument instead is what the developer asked for on 17 Sep: *"більше
 * акценту на тому, що потрібно заповнити профіль, можливо доповни текст"*. And
 * the control is gone from that screen entirely — see `action` below.
 *
 * `action` is the control alone. It has no caller since 17 Sep and is kept:
 * the day a surface wants the reminder split across a screen again, this is the
 * half that goes in the dock, and `/share` proves the other half still works.
 *
 * ⚠ The 100% rule is checked once, here, for every part — a build that rendered
 * the sentence and hid the control, or the reverse, is the fault this split
 * most easily introduces.
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
  part?: "both" | "lead" | "action";
  className?: string;
}) {
  if (depth.total === 0 || depth.answered >= depth.total) return null;
  return (
    <div className={className}>
      {part === "lead" ? (
        /**
         * Body size rather than help size, because this is the argument the
         * screen is making and not a footnote to it — 16.5px against 14px, the
         * step the design system calls body.
         *
         * ⚠ **It counts what is left rather than what is done**, which is the
         * same fact said as something to act on: "14 questions still to
         * answer" names the work, where "30% done" names a score, and the
         * score is already in the header twice.
         *
         * ⚠⚠ **It promises relevance and never access.** The client's own
         * appendix is that P14 is the only thing gating Community Access, and
         * `profileCompleteness` has carried *"informational only — it never
         * gates anything"* since it was written. Everything claimed here is
         * what `matchesFor` literally scores: the area, the children's ages,
         * the shared connections, then life relevance.
         */
        <p className="leading-relaxed text-body">
          <span className="font-semibold text-green-deep tabular-nums">
            {depth.total - depth.answered} question
            {depth.total - depth.answered === 1 ? "" : "s"} still to answer.
          </span>{" "}
          Pando matches you on what it knows about your family — your area, your
          children&apos;s ages, what you have already navigated. Each answer you add
          brings back parents whose experience is closer to yours.
        </p>
      ) : (
        part !== "action" && (
          <p className="leading-relaxed text-help text-muted">
            <span className="font-semibold text-green-deep tabular-nums">
              {depth.percent}% done
            </span>
            {" — the stronger your profile, the better your matches."}
          </p>
        )
      )}
      {/**
        * ⚠ **"Add optional details", and the rename is the whole point of it**
        * (17 Sep, the developer: *"спробуй її переназвати, бо вона співзвучна з
        * Save Profile"*). It read *"Complete your profile"* and sat directly
        * under **Save my profile** — two controls a syllable apart, one of them
        * ending the flow and the other opening fourteen more questions.
        *
        * The new words are **not new copy**: they are the label the optional
        * fork itself carries (`detailLabel` in `questions.ts`, the client's own
        * 10 Sep round), and this control does literally that — it sets
        * `wants_detail` and walks the optional screens. So the two places a
        * parent is offered the same act now offer it in the same words.
        */}
      {part !== "lead" &&
        (href ? (
          <TextAction href={href}>Add optional details</TextAction>
        ) : (
          <TextAction onClick={onComplete}>Add optional details</TextAction>
        ))}
    </div>
  );
}

"use client";

import { useId } from "react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * A tick beside a sentence somebody is agreeing to.
 *
 * ## Why this is a component, and it is not tidiness
 *
 * The rule it makes structural was written out as a paragraph-long comment in
 * two files and remembered in two more: **the `<label>` wraps only the sentence
 * being agreed to, and the carrier disclosure sits outside it, tied by
 * `aria-describedby`.** With the whole registered text inside the label, a tap
 * anywhere in ~230px of legal copy toggles consent — and an accidental opt-in is
 * the worst failure this control has anywhere in the product. `qa-checklist.md`
 * calls that check "the one that matters". A comment cannot enforce it; four
 * copies of a comment enforce it four times until somebody writes a fifth
 * control from memory.
 *
 * ## What the four copies had already lost
 *
 * `bg-paper p-3.5` on `/join`, `bg-card p-3.5` on the profile, `bg-card p-4` in
 * the caregiver flow, and `mt-0.5` against `mt-1` on the box itself — so the tick
 * sat on the first line of text in three places and slightly below it in the
 * fourth. The caregiver flow also put its disclosure *outside* the bordered box,
 * which reads as an unrelated footnote rather than as part of what was agreed.
 *
 * And one real defect: the profile separated its two links with an inline `" · "`
 * while `/join` used a wrapping flex row — with a comment on `/join` explaining
 * exactly why, because at 375px the row always wraps and an inline separator is
 * left dangling at the end of a line. The fix existed and had not travelled.
 *
 * ## The checkbox stays 20px, deliberately
 *
 * The `<label>` is the target and it is several lines tall, so it clears any tap
 * floor on its own. Growing the box to 44px would be enlarging the wrong element
 * and would break the optical alignment of the tick with the first line of text.
 * Do not "fix" it.
 */
export function Consent({
  checked,
  onChange,
  children,
  title,
  detail,
  links,
  reflects,
  note,
  disabled,
  on = "paper",
  className,
  id: givenId,
}: {
  checked: boolean;
  onChange: (on: boolean) => void;
  /** The sentence being agreed to. This, and only this, is inside the label. */
  children: ReactNode;
  /** A bold line above the sentence — the three caregiver permissions have one. */
  title?: string;
  /**
   * The carrier disclosure or equivalent. Rendered **outside** the `<label>` and
   * linked with `aria-describedby`, which is the whole point of the component.
   */
  detail?: ReactNode;
  /**
   * Privacy Policy · Terms. A wrapping flex row, never inline separators — see
   * the header.
   */
  links?: ReactNode;
  /**
   * Wash the box green when ticked. The caregiver permissions do; the two SMS
   * ticks do not, because there the box is the question rather than a state.
   */
  reflects?: boolean;
  /** Why it is inert, under the sentence. */
  note?: ReactNode;
  disabled?: boolean;
  /** Which surface the box sits **on**, so the box can be the other one. */
  on?: "paper" | "card";
  /** Spacing only. */
  className?: string;
  id?: string;
}) {
  const auto = useId();
  const id = givenId ?? auto;
  const detailId = detail ? `${id}-detail` : undefined;

  return (
    <div
      className={cn(
        "rounded-2xl border p-4",
        // Selected, never appended: `cn()` is a plain join.
        disabled
          ? "border-bark bg-paper opacity-60"
          : reflects && checked
            ? "border-green/40 bg-green-wash"
            : on === "card"
              ? "border-bark bg-paper"
              : "border-bark bg-card",
        className,
      )}
    >
      <label className="flex gap-3">
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
          aria-describedby={detailId}
          /* 20px, and `mt-0.5` to sit on the first line of the sentence rather
             than above it. Not a tap target — the label is. */
          className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--color-green-deep)]"
        />
        <span className="leading-relaxed text-ink-soft text-help">
          {title && (
            <span className="mb-1 block font-semibold text-ink text-control">
              {title}
            </span>
          )}
          {children}
        </span>
      </label>

      {/* `pl-8` on both: the tick's 20px plus the 12px gap, so everything under
          the sentence lines up with it rather than with the box edge. */}
      {links && (
        <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 pl-8 leading-relaxed text-help">
          {links}
        </p>
      )}
      {detail && (
        <p
          id={detailId}
          className="mt-2 pl-8 leading-relaxed text-muted text-help"
        >
          {detail}
        </p>
      )}
      {note && (
        <p className="mt-1.5 pl-8 text-muted text-dock">{note}</p>
      )}
    </div>
  );
}

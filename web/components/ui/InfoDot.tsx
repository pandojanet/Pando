"use client";

/**
 * ⚠ **Zero importers, and it is parked rather than dead. Do not delete it.**
 *
 * It is the built implementation of the client's 24 Aug request for footnotes on
 * the Founding Status points. Those points came off `/join` on 3 Sep on her own
 * instruction, and that decision records where they go if she asks for them
 * back: *"the place is a tooltip on the badge rather than a page."* This is that
 * tooltip, already built to the rules that make it reachable — a real 44px
 * button, `aria-expanded`/`aria-controls`, inline rather than `position: fixed`
 * so it cannot be clipped by an animated ancestor.
 *
 * Deleting it means rebuilding it, and rebuilding it means rediscovering all
 * three of those rules.
 */

import { useId, useState } from "react";
import { cn } from "@/lib/cn";

interface Props {
  /** What the "i" explains. One or two sentences — it is a footnote, not a page. */
  children: React.ReactNode;
  /** Read out in place of "more about this". Name the point it belongs to. */
  label: string;
  className?: string;
}

/**
 * A small "i" that reveals a sentence, for a promise that needs one.
 *
 * The client asked for this next to each Founding Status point (24 Aug): a
 * parent reads "a reserved place in the pilot" and reasonably wants to know what
 * that means before handing over a phone number.
 *
 * ## Three decisions worth not undoing
 *
 * **It reveals inline; it is not a tooltip.** `title` alone is invisible on a
 * phone, and this product's design target is a phone. A hover-only affordance
 * would mean the explanation exists for the client on her laptop and for nobody
 * in the pilot.
 *
 * **It is not `position: fixed`.** CLAUDE.md records why: every `animate-*`
 * keyframe here ends at `transform: none`, and a *filled* animation still
 * computes to a transform, which makes the wrapper the containing block for a
 * fixed child — so a "full-screen" overlay ends up clipped to the paragraph it
 * sits in. Anything fixed has to portal to `body` (see `OtherSheet`); an inline
 * disclosure needs neither.
 *
 * **The dot is 44px of tap target around an 18px circle.** The design system's
 * floor applies to a control this small more than to anything else — the visible
 * circle is the affordance, the padding is what makes it hittable with a thumb.
 */
export function InfoDot({ children, label, className }: Props) {
  const [open, setOpen] = useState(false);
  const id = useId();

  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        aria-label={open ? `Hide what "${label}" means` : `What does "${label}" mean?`}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          /* The negative margin keeps the 44px hit area from pushing the line it
             sits in apart — the target is bigger than the ink, which is the
             point, but it must not change the typography around it. */
          "-my-3 -mr-2 inline-flex h-11 w-11 items-center justify-center align-middle",
          className,
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            "flex h-[18px] w-[18px] items-center justify-center rounded-full border text-[11px] font-bold leading-none transition-colors",
            open
              ? "border-green-deep bg-green-deep text-white"
              : "border-bark bg-card text-muted",
          )}
        >
          i
        </span>
      </button>
      {open && (
        <span
          id={id}
          className="mt-1.5 block rounded-xl border border-bark bg-paper px-3 py-2 text-help leading-relaxed text-ink-soft animate-rise"
        >
          {children}
        </span>
      )}
    </>
  );
}

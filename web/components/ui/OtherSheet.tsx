"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "./Button";
import { fieldShell } from "./Field";
import { cn } from "@/lib/cn";
import { usePresence } from "@/lib/use-presence";

interface Props {
  open: boolean;
  title: string;
  onClose: () => void;
  onSubmit: (value: string) => void;
}

/**
 * The "other" fallback (spec §8.1 → pending_options).
 *
 * Two shapes, one component. On a phone it is a bottom sheet: the input lands
 * right above the keyboard, where the thumb already is. From `md` it is an
 * ordinary centred web dialog — a sheet climbing out of the bottom edge of a
 * laptop window is a phone gesture with nothing behind it, and the drag handle
 * suggests an affordance a mouse doesn't have.
 *
 * It renders through a portal into `document.body`, and that is load-bearing
 * rather than tidiness: `ChipGroup` sits inside the screen's `animate-step-in`
 * wrapper, whose keyframes end at `transform: none` — but a *filled* animation
 * computes to the identity matrix, not to `none`, and any transform other than
 * `none` makes that element the containing block for `position: fixed`
 * descendants. So the "fixed" overlay was being clipped to the question block
 * for the life of the screen: full-width on a phone by luck, and on a laptop a
 * half-width sheet anchored to the bottom of the text.
 */
export function OtherSheet({ open, title, onClose, onSubmit }: Props) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!open) return;

    setValue("");

    /* Whatever had focus gets it back on close. On a phone the sheet is the whole
       world and nobody notices; with a keyboard, losing your place in a 20-chip
       list is the difference between usable and not. Read before focusing the
       input, or the element we save is the input we are about to unmount. */
    const opener = document.activeElement as HTMLElement | null;

    /* Twice, on purpose. The synchronous call keeps the focus inside the tap that
       opened the sheet, which is what iOS wants before it will raise a keyboard; the
       rAF call re-asserts it after paint, for the case where the field wasn't mounted
       yet. rAF alone is not enough — it is throttled to nothing in a hidden tab. */
    inputRef.current?.focus();
    const raf = requestAnimationFrame(() => inputRef.current?.focus());

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      // A dialog that lets Tab wander into the page behind it isn't modal.
      if (e.key !== "Tab" || !formRef.current) return;
      /* The full focusable list, not `"input, button:not([disabled])"`. Nothing
         in this sheet is a link or a select *today*, which is exactly what made
         the old selector a trap: the next person to add one gets a modal that
         quietly leaks focus to the page behind, and nothing on screen says so. */
      const focusable = formRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), ' +
          'select:not([disabled]), textarea:not([disabled]), ' +
          '[tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      }
    };
    document.addEventListener("keydown", onKey);

    /* Locking the body also removes the desktop scrollbar, which shifts the page
       under the scrim. Pay its width back as padding so nothing moves. */
    const previousOverflow = document.body.style.overflow;
    const previousPadding = document.body.style.paddingRight;
    const scrollbar = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = "hidden";
    if (scrollbar > 0) document.body.style.paddingRight = `${scrollbar}px`;

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
      document.body.style.paddingRight = previousPadding;
      opener?.focus?.();
    };
  }, [open, onClose]);

  /* Mounted for the length of the exit keyframe after `open` goes false. */
  const present = usePresence(open, 220);
  if (!present || typeof document === "undefined") return null;

  const trimmed = value.trim();

  return createPortal(
    /**
     * The sheet can *leave* now. Until this pass it was `if (!open) return null`
     * — it slid up over a quarter of a second and then vanished between two
     * frames, the most abrupt moment in the parent flow.
     *
     * `usePresence` holds it mounted for the exit keyframe; the keyframes
     * themselves are in `globals.css` beside the entrances they mirror. **No
     * `motion` here**, deliberately: this sheet is reached from the chat as well
     * as the profile, and the library is confined to `/profile` because it
     * measured at 44 KB gzipped in the eager payload.
     *
     * The exit mirrors whichever entrance actually ran — `sheet-down` against
     * `animate-sheet-up` on a phone, `sink` against `md:animate-rise` on a
     * laptop, where a centred dialog is nowhere near an edge to slide off.
     */
    <div className="fixed inset-0 z-50 flex flex-col justify-end md:items-center md:justify-center md:p-6">
      {/* Inert, not a `<button aria-label="Close">`.
          As a button it sat **before** the dialog in DOM order and **outside**
          `formRef`, so the trap above could not see it: Tab from the scrim
          escaped straight into the page behind, and Shift+Tab from the input
          landed on an invisible full-screen control. Escape already closes
          (above) and there is a real Cancel button, so the keyboard path is
          complete without it. ⚠ One tab stop is removed. */}
      <div
        aria-hidden="true"
        onClick={onClose}
        className={cn(
          "absolute inset-0 bg-moss/40",
          open ? "animate-fade" : "animate-fade-out",
        )}
      />
      <form
        ref={formRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onSubmit={(e) => {
          e.preventDefault();
          if (trimmed) onSubmit(trimmed);
        }}
        className={cn(
          "relative w-full rounded-t-3xl border-t border-bark bg-card",
          "px-5 pt-5 pb-[max(1rem,env(safe-area-inset-bottom))]",
          "md:max-w-[27rem] md:rounded-3xl md:border md:p-7 md:shadow-card",
          open
            ? "animate-sheet-up md:animate-rise"
            : "animate-sheet-down md:animate-sink",
        )}
      >
        {/* Grab handle: a phone affordance, so it stays on the phone. */}
        <div
          className="mx-auto mb-4 h-1 w-10 rounded-full bg-bark md:hidden"
          aria-hidden="true"
        />
        <label
          htmlFor="other-value"
          className="block font-display text-card-title font-semibold"
        >
          {title}
        </label>
        <p className="mt-1 text-help text-muted">
          We&apos;ll add it to the list for your area once we&apos;ve checked it.
        </p>
        {/* `fieldShell`, not `Field`: the sheet's own heading is already a real
            `<label htmlFor="other-value">`, and a second one would make the
            input's accessible name the two of them concatenated. This is the
            case that prop exists for — a composite that owns its own labelling.
            The sheet is `bg-card`, so the field is paper. */}
        <input
          id="other-value"
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value.slice(0, 80))}
          autoComplete="off"
          enterKeyHint="done"
          className={cn(fieldShell({ on: "card" }), "mt-4 px-4 py-3.5 text-ink")}
          placeholder="Type it the way you'd say it"
        />
        <div className="mt-4 flex gap-2 md:mt-6 md:justify-end">
          <Button
            type="button"
            variant="secondary"
            onClick={onClose}
            className="md:min-w-[6.5rem]"
          >
            Cancel
          </Button>
          <Button type="submit" full disabled={!trimmed} className="md:w-auto md:min-w-[8rem]">
            Add
          </Button>
        </div>
      </form>
    </div>,
    document.body,
  );
}

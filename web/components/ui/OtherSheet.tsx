"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "./Button";

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
      const focusable = formRef.current.querySelectorAll<HTMLElement>(
        "input, button:not([disabled])",
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

  if (!open || typeof document === "undefined") return null;

  const trimmed = value.trim();

  return createPortal(
    <div className="fixed inset-0 z-50 flex flex-col justify-end md:items-center md:justify-center md:p-6">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 animate-fade bg-moss/40"
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
        className={
          "relative w-full animate-sheet-up rounded-t-3xl border-t border-bark bg-card " +
          "px-5 pt-5 pb-[max(1rem,env(safe-area-inset-bottom))] " +
          "md:max-w-[27rem] md:animate-rise md:rounded-3xl md:border md:p-7 md:shadow-card"
        }
      >
        {/* Grab handle: a phone affordance, so it stays on the phone. */}
        <div
          className="mx-auto mb-4 h-1 w-10 rounded-full bg-bark md:hidden"
          aria-hidden="true"
        />
        <label
          htmlFor="other-value"
          className="block font-display text-[1.15rem] font-semibold"
        >
          {title}
        </label>
        <p className="mt-1 text-[14px] text-muted">
          We&apos;ll add it to the list for your area once we&apos;ve checked it.
        </p>
        <input
          id="other-value"
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value.slice(0, 80))}
          autoComplete="off"
          enterKeyHint="done"
          className="mt-4 w-full rounded-2xl border border-bark bg-paper px-4 py-3.5 text-ink outline-none placeholder:text-muted/70 focus:border-green"
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

"use client";

import { cn } from "@/lib/cn";

interface ChipProps {
  label: string;
  hint?: string;
  selected: boolean;
  onToggle: () => void;
  mode: "single" | "multi";
  /** Square-ish chip used by the age grid. */
  compact?: boolean;
  /**
   * Inert because the question is full, not because the option is wrong. It
   * stays on screen and stays readable: a parent has to be able to see what they
   * did *not* pick, or "why can't I choose that one" has no answer.
   */
  disabled?: boolean;
  className?: string;
}

export function Chip({
  label,
  hint,
  selected,
  onToggle,
  mode,
  compact,
  disabled,
  className,
}: ChipProps) {
  return (
    <button
      type="button"
      role={mode === "single" ? "radio" : undefined}
      aria-checked={mode === "single" ? selected : undefined}
      aria-pressed={mode === "multi" ? selected : undefined}
      disabled={disabled}
      onClick={onToggle}
      className={cn(
        // 48px minimum: the smallest target a thumb hits reliably every time.
        "inline-flex min-h-12 select-none items-center gap-2 rounded-full border text-left",
        "text-control font-medium leading-snug",
        "transition-[transform,background-color,border-color,color,box-shadow] duration-150",
        /* Conditional rather than overridden later in the string: two
           `active:scale-*` utilities live in the same layer, so which one wins is
           Tailwind's ordering, not this file's. */
        !disabled && "active:scale-[0.97]",
        // Uniform width so a wrapped, centred row of ages still reads as a grid.
        compact ? "min-w-12 justify-center px-3 py-2" : "px-4 py-2.5",
        selected
          ? "border-green-deep bg-green-deep text-white"
          : disabled
            ? "cursor-not-allowed border-bark/50 bg-card text-muted opacity-55"
            : "border-bark bg-card text-ink hover:border-green/50",
        className,
      )}
    >
      {mode === "multi" && !compact && <Tick selected={selected} />}
      <span className="flex min-w-0 flex-col">
        <span>{label}</span>
        {hint && (
          <span
            className={cn(
              "text-dock font-normal",
              selected ? "text-white/70" : "text-muted",
            )}
          >
            {hint}
          </span>
        )}
      </span>
    </button>
  );
}

/** Empty circle → check. Signals "you can pick more than one" before any tap. */
function Tick({ selected }: { selected: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full border transition-colors duration-150",
        selected ? "border-white bg-white" : "border-bark bg-paper",
      )}
    >
      <svg viewBox="0 0 12 12" className="h-[11px] w-[11px]" fill="none">
        <path
          d="M2 6.4 4.6 9 10 3.2"
          stroke={selected ? "var(--color-green-deep)" : "transparent"}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

/** A parent-typed value that isn't in the canonical list yet. */
export function CustomChip({
  label,
  onRemove,
  tone = "gold",
}: {
  label: string;
  onRemove: () => void;
  /**
   * Gold for a value the parent typed, green for one they picked.
   *
   * Not decoration: gold means *pending* in this design system, and a typed
   * answer is exactly that — unmatchable until an admin promotes it into
   * `market_options` (invariant 9). A record chosen from the directory is
   * already canonical, so it wears the same green a selected chip does.
   */
  tone?: "gold" | "green";
}) {
  const green = tone === "green";
  return (
    <span
      className={cn(
        "inline-flex min-h-12 items-center gap-1 rounded-full border pl-4 pr-1.5 text-control font-medium",
        green
          ? "border-green-deep bg-green-deep text-white"
          : "border-gold-line bg-gold-wash text-gold-ink",
      )}
    >
      {label}
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${label}`}
        /**
         * 44px, not 36 — raised 9 Sep after walking the whole flow.
         *
         * It was the smallest target in the onboarding, and what changed is not
         * the button but its job: since the long lists became dropdowns, a
         * green chip is the **only** way to undo an answer. The options behind
         * it are hidden, so a parent who mistapped has this × and nothing else.
         * 36px was survivable while every answer was also a chip you could tap
         * off; it is not survivable as the sole exit.
         *
         * It fits: the chip is `min-h-12`, so 44 leaves 2px either side.
         */
        className={cn(
          "grid h-11 w-11 place-items-center rounded-full transition-colors",
          green
            ? "text-white/75 hover:bg-white/20 hover:text-white"
            : "text-gold-ink/70 hover:bg-gold-line/50 hover:text-gold-ink",
        )}
      >
        <svg viewBox="0 0 14 14" className="h-3.5 w-3.5" fill="none">
          <path
            d="M3 3l8 8M11 3l-8 8"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </span>
  );
}

/**
 * The `+` on this control is drawn once, and the label is where it was drawn twice.
 *
 * The client's 1 Sep instruction named the copy verbatim — *"Keep only
 * '+ Something else,' which opens a short optional field"* — so `SOMETHING_ELSE`
 * in `questions.ts` carries a literal plus, and this control draws its own glyph
 * beside it. Each is right on its own; together they render **two** pluses, an
 * outer icon and an inner character, which is what the client reported.
 *
 * The glyph wins, because it is the affordance: it is the same mark on every one
 * of these controls, including the eight whose labels never carried a plus
 * ("Another school", "Another camp"). Stripping it from the *text* leaves her
 * wording intact where it is stored, stops the screen saying it twice, and fixes
 * an accessible name that read "plus Something else".
 *
 * In the primitive rather than at the five call sites, so a future question that
 * copies her label cannot bring the duplicate back — and the "Other" sheet's own
 * heading takes it too, because that heading is the same string.
 */
export function otherActionLabel(label: string): string {
  return label.replace(/^\s*\+\s*/, "");
}

export function AddOtherChip({
  label,
  onClick,
  disabled,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex min-h-12 items-center gap-2 rounded-full border border-dashed bg-transparent px-4 text-control font-medium transition-colors duration-150",
        /* A typed answer is still an answer, so the cap has to cover this too —
           otherwise "one per child" is a rule the Other sheet walks straight past. */
        disabled
          ? "cursor-not-allowed border-bark/50 text-muted opacity-55"
          : "border-bark text-muted hover:border-green/60 hover:text-green-deep active:scale-[0.97]",
      )}
    >
      <svg viewBox="0 0 14 14" className="h-3.5 w-3.5" fill="none" aria-hidden="true">
        <path
          d="M7 2v10M2 7h10"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      </svg>
      {otherActionLabel(label)}
    </button>
  );
}

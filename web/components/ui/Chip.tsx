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
  className?: string;
}

export function Chip({
  label,
  hint,
  selected,
  onToggle,
  mode,
  compact,
  className,
}: ChipProps) {
  return (
    <button
      type="button"
      role={mode === "single" ? "radio" : undefined}
      aria-checked={mode === "single" ? selected : undefined}
      aria-pressed={mode === "multi" ? selected : undefined}
      onClick={onToggle}
      className={cn(
        // 48px minimum: the smallest target a thumb hits reliably every time.
        "inline-flex min-h-12 select-none items-center gap-2 rounded-full border text-left",
        "text-[15px] font-medium leading-snug",
        "transition-[transform,background-color,border-color,color,box-shadow] duration-150",
        "active:scale-[0.97]",
        // Uniform width so a wrapped, centred row of ages still reads as a grid.
        compact ? "min-w-12 justify-center px-3 py-2" : "px-4 py-2.5",
        selected
          ? "border-green-deep bg-green-deep text-white"
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
              "text-[12.5px] font-normal",
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
}: {
  label: string;
  onRemove: () => void;
}) {
  return (
    <span className="inline-flex min-h-12 items-center gap-1 rounded-full border border-gold-line bg-gold-wash pl-4 pr-1.5 text-[15px] font-medium text-gold-ink">
      {label}
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${label}`}
        className="grid h-9 w-9 place-items-center rounded-full text-gold-ink/70 transition-colors hover:bg-gold-line/50 hover:text-gold-ink"
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

export function AddOtherChip({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex min-h-12 items-center gap-2 rounded-full border border-dashed border-bark bg-transparent px-4 text-[15px] font-medium text-muted transition-colors duration-150 hover:border-green/60 hover:text-green-deep active:scale-[0.97]"
    >
      <svg viewBox="0 0 14 14" className="h-3.5 w-3.5" fill="none" aria-hidden="true">
        <path
          d="M7 2v10M2 7h10"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      </svg>
      {label}
    </button>
  );
}

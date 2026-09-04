import { cn } from "@/lib/cn";

/** The Pando mark: an aspen leaf over three dots — a message, and a root system. */
export function PandoMark({
  className,
  tone = "dark",
  pulse,
}: {
  className?: string;
  /** "light" for use on the moss brand panel. */
  tone?: "dark" | "light";
  /** Ticks the three dots like a typing indicator — used on the public site. */
  pulse?: boolean;
}) {
  const leaf = tone === "light" ? "var(--color-gold)" : "var(--color-green)";
  const dots = tone === "light" ? "var(--color-paper)" : "var(--color-ink)";
  const dot = (delay: number) =>
    pulse
      ? {
          animation: "dot-tick 1.4s ease-in-out infinite",
          animationDelay: `${delay}s`,
        }
      : undefined;

  return (
    <svg
      viewBox="0 0 26 29"
      className={cn("h-7 w-auto", className)}
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M13 2C9 6.5 7.5 9.5 7.5 12.5C7.5 16 10 18.5 13 18.5C16 18.5 18.5 16 18.5 12.5C18.5 9.5 17 6.5 13 2Z"
        fill={leaf}
      />
      <path d="M13 17.2V22" stroke={leaf} strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="7.4" cy="25.4" r="1.55" fill={dots} style={dot(0)} />
      <circle cx="13" cy="25.4" r="1.55" fill={dots} style={dot(0.2)} />
      <circle cx="18.6" cy="25.4" r="1.55" fill={dots} style={dot(0.4)} />
    </svg>
  );
}

/**
 * The mark and the word, locked up. The **only** place that pairing is written.
 *
 * It had been hand-drawn twice more — `BrandPanel` at `1.1rem`, the site header
 * at `1.4rem` with a `1.8rem` mark — so the logo existed in three sizes that no
 * single decision had chosen. A logo is the one element in a product that must
 * not be approximate.
 *
 * `size` **selects** both halves rather than letting a caller append a height:
 * the old `markClassName` prop put `h-6` and the override in the same Tailwind
 * layer, where output order decides and the string does not (the `cn()` trap
 * `Chip.tsx` documents). No caller ever used it, so it was a loaded gun with
 * nothing pointing at it — removed rather than fixed.
 */
export function Wordmark({
  className,
  tone = "dark",
  size = "default",
  pulse,
}: {
  className?: string;
  tone?: "dark" | "light";
  /** `lead` is the site header, where the logo is the page's own masthead. */
  size?: "default" | "lead";
  pulse?: boolean;
}) {
  const lead = size === "lead";
  return (
    <span className={cn("flex items-center gap-2", lead && "gap-2.5", className)}>
      <PandoMark
        className={lead ? "h-[1.8rem]" : "h-6"}
        tone={tone}
        pulse={pulse}
      />
      <span
        className={cn(
          "font-display font-bold tracking-[-0.02em]",
          lead ? "text-[1.4rem]" : "text-card-title",
        )}
      >
        Pando
      </span>
    </span>
  );
}

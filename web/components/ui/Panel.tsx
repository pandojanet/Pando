import type { ElementType, ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * A block on a flow screen — the card the screen is about, a reassurance, a
 * warning.
 *
 * ## Why this is a component
 *
 * The admin has had `Card` since it was written. The parent flow never got one,
 * so the same box was hand-written **fourteen times** across `DemandQuestion`,
 * `FinishAsks`, `InviteLanding`, `Thanks`, `ProfileFlow`, `VerifyPhone` and
 * `CaregiverFlow` — and every site re-decided three things independently.
 *
 * **Two branches of one slot disagreed.** On `/join`, the founding card was
 * `p-5 shadow-card` and the anonymous card directly replacing it was `p-5` with
 * no shadow: switch route and the same box on the same screen changes
 * elevation. Nothing intended that — it is two writings of one box.
 *
 * **The heading's colour has to match the panel's, and did so by memory.** A
 * green-wash panel takes a `text-green-deep` heading, a gold one `text-gold-ink`
 * — correct in all eight places, but only because each remembered. `title`
 * derives it from `tone`, so it cannot come apart, and it settles the 1.1 /
 * 1.15rem split the copies had (both are inside the design system's
 * "Card heading 1.1–1.15rem", which is how they drifted unnoticed).
 *
 * ## The tones are what the box means, not how it looks
 *
 * `card` is neutral — the thing being asked or shown. `positive` is the
 * reassurance register (green-wash: "your answers are saved", "you're in").
 * `warning` is gold, which in Pando means *pending or needs care*, never
 * danger — red is reserved for what is owed a person today and never appears in
 * the parent flow at all.
 *
 * `raised` is separate from tone on purpose, because the design system's rule is
 * elevation for **the one card the screen is about** — everything else earns its
 * edge from a border. Making it a prop keeps that a decision per screen rather
 * than a property of a colour.
 */
type Tone = "card" | "positive" | "warning" | "quiet";
type Size = "default" | "inset";

const TONES: Record<Tone, { box: string; title: string }> = {
  card: { box: "border-bark bg-card", title: "text-ink" },
  positive: { box: "border-green/25 bg-green-wash", title: "text-green-deep" },
  warning: { box: "border-gold-line bg-gold-wash", title: "text-gold-ink" },
  /**
   * The register that already existed and had no name. `ProfileFlow`'s footnote
   * carried the argument in a comment before this tone did: *"Neutral styling,
   * deliberately. In green it reads as reassurance and in gold as a warning; it
   * is neither, it is the honest limit."*
   */
  quiet: { box: "border-bark bg-paper", title: "text-ink" },
};

export function Panel({
  children,
  tone = "card",
  size = "default",
  raised = false,
  flush = false,
  title,
  as: Tag = "div",
  className,
}: {
  children: ReactNode;
  tone?: Tone;
  /**
   * `inset` is the nested or footnote box: `rounded-2xl p-4` with a plain
   * heading, against `default`'s `rounded-3xl p-5` and display heading.
   *
   * It exists because `Panel` could not absorb the twelve hand-written boxes
   * without it — every one of them is `p-4`, and **five sit inside another
   * `Panel`** (`VerifyPhone`'s `Blocked()` lives in a `tone="positive"` one). A
   * `p-5` card inside a `p-5` card is a heavier screen, not a calmer one.
   *
   * `rounded-2xl` is the design system's input radius, so a box at input scale
   * takes it. Not a new step.
   */
  size?: Size;
  /** `shadow-card`. The one card the screen is about — see the note above. */
  raised?: boolean;
  /**
   * Drops the padding and clips the corners, for a panel whose children are a
   * divided list and supply their own — a recap's rows, the review screen's
   * definition list.
   */
  flush?: boolean;
  /** Rendered in the tone's own ink, so the pairing can't drift. */
  title?: ReactNode;
  /** `dl` for the review screen's definition list; `div` otherwise. */
  as?: ElementType;
  /** Spacing, and nothing else. The box itself is not overridable. */
  className?: string;
}) {
  const t = TONES[tone];
  const inset = size === "inset";
  return (
    <Tag
      className={cn(
        "border",
        /* Radius and padding each come from **one** expression, never from two
           appended utilities: `cn()` is a plain join, so two `rounded-*` in the
           same layer are resolved by Tailwind's output order and not by this
           string. Same trap `Chip.tsx` documents for `active:scale-*`. */
        inset ? "rounded-2xl" : "rounded-3xl",
        flush ? "overflow-hidden" : inset ? "p-4" : "p-5",
        t.box,
        raised && "shadow-card",
        className,
      )}
    >
      {title && (
        <h2
          className={cn(
            "font-semibold",
            inset ? "text-control" : "font-display text-card-title",
            t.title,
          )}
        >
          {title}
        </h2>
      )}
      {children}
    </Tag>
  );
}

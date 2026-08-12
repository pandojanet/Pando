"use client";

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * Admin primitives. Same Pando tokens as the parent-facing app, but a denser
 * register: this is a desktop work tool, not a phone flow — smaller type, tables
 * instead of cards, less rounding. It still has to work on a phone, so every table
 * scrolls inside its own container rather than pushing the page sideways.
 */

const FADE_PX = 16;

function edgeMaskFor(start: boolean, end: boolean): string {
  if (!start && !end) return "none";
  const left = start ? `transparent, black ${FADE_PX}px` : "black";
  const right = end ? `black calc(100% - ${FADE_PX}px), transparent` : "black";
  return `linear-gradient(to right, ${left}, ${right})`;
}

/**
 * Attach to a horizontally scrollable element to get a `maskImage` that fades
 * only the edge that actually hides content, and updates live as the user
 * scrolls or the content changes.
 *
 * A fade that's on for both edges regardless of scroll position looks fine on
 * a quiet background, but on a filled control (a selected filter's solid
 * green, a table row) it softens that edge into the page colour even at rest,
 * with nothing there to reveal — it reads as a smudge, and it's dishonest:
 * it implies hidden content on a side where none exists.
 */
export function useEdgeFade<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [edges, setEdges] = useState({ start: false, end: false });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    /* Threshold matches the fade width itself, not a bare "!== 0". A snapped,
       padded row (the admin nav) settles a few px off true zero — its own
       leading padding, not hidden content — so a strict >0 check would show a
       left fade at rest there. Being within one fade-width of an edge reads as
       "there" regardless. */
    const update = () =>
      setEdges({
        start: el.scrollLeft > FADE_PX,
        end: el.scrollLeft + el.clientWidth < el.scrollWidth - FADE_PX,
      });
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    /* Belt and suspenders: a container that switches from a horizontal scroll
       strip to a wrapped/vertical layout at a breakpoint (the admin nav at
       `md`) changes size for CSS reasons, not because anything scrolled — the
       resize listener catches that transition promptly even if it lands in
       the same tick a browser might otherwise coalesce or defer the observer
       callback. */
    window.addEventListener("resize", update);
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
      window.removeEventListener("resize", update);
    };
  }, []);

  const mask = edgeMaskFor(edges.start, edges.end);
  return { ref, maskStyle: { maskImage: mask, WebkitMaskImage: mask } };
}

export function PageHead({
  title,
  intro,
  right,
}: {
  title: string;
  intro?: ReactNode;
  right?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="font-display text-[1.5rem] font-bold tracking-[-0.02em]">
          {title}
        </h1>
        {intro && (
          <p className="mt-1.5 max-w-[70ch] text-[14px] leading-relaxed text-muted">
            {intro}
          </p>
        )}
      </div>
      {right && <div className="flex shrink-0 items-center gap-2">{right}</div>}
    </div>
  );
}

export function Card({
  children,
  className,
  title,
  right,
}: {
  children: ReactNode;
  className?: string;
  title?: ReactNode;
  right?: ReactNode;
}) {
  return (
    <section
      className={cn("rounded-xl border border-bark bg-card", className)}
    >
      {(title || right) && (
        <header className="flex items-center justify-between gap-3 border-b border-bark/70 px-4 py-2.5">
          <h2 className="text-[12.5px] font-semibold uppercase tracking-[0.08em] text-muted">
            {title}
          </h2>
          {right}
        </header>
      )}
      {children}
    </section>
  );
}

export function Stat({
  label,
  value,
  hint,
  tone = "plain",
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: "plain" | "warn" | "good";
}) {
  return (
    <div
      className={cn(
        "rounded-xl border p-4",
        tone === "warn"
          ? "border-gold-line bg-gold-wash"
          : tone === "good"
            ? "border-green/25 bg-green-wash"
            : "border-bark bg-card",
      )}
    >
      <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-muted">
        {label}
      </p>
      <p className="mt-1 font-display text-[1.7rem] font-bold leading-none">{value}</p>
      {hint && <p className="mt-1.5 text-[12.5px] leading-snug text-muted">{hint}</p>}
    </div>
  );
}

type BadgeTone = "neutral" | "green" | "gold" | "red" | "muted";

export function Badge({
  children,
  tone = "neutral",
  title,
}: {
  children: ReactNode;
  tone?: BadgeTone;
  title?: string;
}) {
  const tones: Record<BadgeTone, string> = {
    neutral: "border-bark bg-paper text-ink-soft",
    green: "border-green/30 bg-green-wash text-green-deep",
    gold: "border-gold-line bg-gold-wash text-gold-ink",
    red: "border-alert-line bg-alert-wash text-alert",
    muted: "border-bark bg-transparent text-muted",
  };
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[11.5px] font-semibold",
        tones[tone],
      )}
    >
      {children}
    </span>
  );
}

/**
 * Tables scroll inside themselves — the page never scrolls sideways.
 *
 * `.no-scrollbar` + the edge fade replace the bare OS scrollbar (grey track,
 * click-to-page arrows) that `overflow-x-auto` renders on its own — the same
 * fix as the admin nav (`Shell.tsx`), because a table is the one place on this
 * page that's expected to scroll, not the whole surface reaching for attention.
 */
export function TableWrap({ children }: { children: ReactNode }) {
  const { ref, maskStyle } = useEdgeFade<HTMLDivElement>();
  return (
    <div ref={ref} className="overflow-x-auto no-scrollbar" style={maskStyle}>
      <table className="w-full min-w-[46rem] border-collapse text-left text-[14px]">
        {children}
      </table>
    </div>
  );
}

export function Th({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <th
      className={cn(
        "border-b border-bark/70 bg-paper/60 px-3 py-2 text-[11.5px] font-semibold uppercase tracking-[0.07em] text-muted",
        className,
      )}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  className,
  colSpan,
  title,
}: {
  children?: ReactNode;
  className?: string;
  colSpan?: number;
  /** Hover explanation — used where a number needs one word of context. */
  title?: string;
}) {
  return (
    <td
      colSpan={colSpan}
      title={title}
      className={cn("border-b border-bark/50 px-3 py-2.5 align-top", className)}
    >
      {children}
    </td>
  );
}

export function Button({
  children,
  onClick,
  tone = "secondary",
  disabled,
  type = "button",
  className,
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  tone?: "primary" | "secondary" | "danger" | "ghost";
  disabled?: boolean;
  type?: "button" | "submit";
  className?: string;
  /** For a control whose label has to stay short — this table is dense on purpose. */
  title?: string;
}) {
  const tones = {
    primary: "bg-green-deep text-white hover:bg-ink",
    secondary: "border border-bark bg-card text-ink hover:border-green/60",
    danger: "border border-alert-line bg-alert-wash text-alert hover:border-alert/45",
    ghost: "text-muted hover:text-green-deep",
  };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        "inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg px-3 text-[13.5px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        tones[tone],
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="block text-[12px] font-semibold uppercase tracking-[0.07em] text-muted">
        {label}
      </span>
      <span className="mt-1 block">{children}</span>
      {hint && <span className="mt-1 block text-[12px] text-muted">{hint}</span>}
    </label>
  );
}

export const inputClass =
  "w-full rounded-lg border border-bark bg-card px-3 py-2 text-[14px] outline-none focus:border-green";

export function Empty({
  title,
  body,
  action,
}: {
  title: string;
  body?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="px-4 py-10 text-center">
      <p className="font-display text-[1.05rem] font-semibold">{title}</p>
      {body && (
        <p className="mx-auto mt-1.5 max-w-[52ch] text-[13.5px] leading-relaxed text-muted">
          {body}
        </p>
      )}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

/**
 * Shown whenever a page is displaying invented rows. Sample data is only available
 * while there is no backend at all, and it must never be mistakable for real data.
 */
export function SampleBanner() {
  return (
    <div className="mb-4 rounded-xl border border-gold-line bg-gold-wash px-4 py-2.5 text-[13px] font-medium text-gold-ink">
      Sample data — invented rows for reviewing the layout. Nothing here is real, and
      no action you take is stored.
    </div>
  );
}

export function NotConfigured({
  demo,
  onDemo,
}: {
  demo: boolean;
  onDemo: (on: boolean) => void;
}) {
  return (
    <Empty
      title="No database connected yet"
      body={
        <>
          This page reads from the database, and <code>DATABASE_URL</code> isn&apos;t
          set. Until then there is nothing to show — you can switch on sample rows
          to review the layout.
        </>
      }
      action={
        <Button tone="secondary" onClick={() => onDemo(!demo)}>
          {demo ? "Hide sample data" : "Show sample data"}
        </Button>
      }
    />
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <div className="mb-4 rounded-xl border border-alert-line bg-alert-wash px-4 py-2.5 text-[13.5px] font-medium text-alert">
      {children}
    </div>
  );
}

/* ── Shared value formatters ──────────────────────────────────────────────── */

export function slugLabel(value: string): string {
  return value.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function ageList(ages: number[]): string {
  if (ages.length === 0) return "—";
  return ages
    .map((a) => (a === -1 ? "expecting" : a === 0 ? "under 1" : String(a)))
    .join(", ");
}

export function when(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? "—"
    : /* Pinned to en-US rather than the reader's locale. The admin is an
         English-only tool for a California market, and `undefined` meant the same
         row read "Jul 30" for the client and "30 лип." for whoever was testing —
         which makes screenshots and bug reports disagree about the data. */
      date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function ProvenanceBadge({ provenance }: { provenance: string }) {
  if (provenance === "parent_submitted") {
    return <Badge tone="green" title="A real parent submitted this">Parent</Badge>;
  }
  if (provenance === "admin_entered") {
    return (
      <Badge tone="gold" title="Entered by an admin — can never carry a parent-vouched label">
        Admin-entered
      </Badge>
    );
  }
  return <Badge tone="muted">{slugLabel(provenance)}</Badge>;
}

export function ConfidenceBadge({ value }: { value: number | null }) {
  if (value === null) {
    return <Badge tone="muted" title="No extraction run yet (estimate 1.8)">—</Badge>;
  }
  const pct = Math.round(value * 100);
  return (
    <Badge tone={value < 0.6 ? "gold" : value < 0.85 ? "neutral" : "green"}>
      {pct}%
    </Badge>
  );
}

/**
 * The option value a promoted "other" answer gets. Matching keys on this, so it is
 * created deliberately at the moment of promotion rather than derived later by a
 * workflow that might slugify differently.
 */
export function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/** Birth years read plainly; an empty list is a dash, not "0". */
export function yearList(years: number[]): string {
  return years.length ? years.join(" · ") : "—";
}

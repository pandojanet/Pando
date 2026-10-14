"use client";

import { useEffect, useId, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { InlineAction } from "@/components/ui/TextAction";
import { REWARD_OFFER } from "@/lib/rewards";

/**
 * The pieces of `/join`'s front screen that are not the form (14 Oct, the
 * client's join mockup): the live line, the three facts, the footer. The form
 * and every decision about it stay in `InviteLanding`.
 *
 * Sizes are the mockup's own (`pando_join_mockup (3).html`), in the theme's
 * colours: where its rem values sit between two steps of the scale they are
 * kept as written, because the developer asked for the mockup, not for an
 * approximation of it.
 */

/**
 * The mockup's `.wrap` — a 460px column with 22px gutters — on a phone. From
 * `md` it follows the flow's desktop column step for step — `Container`'s
 * 40 → 46 → 52 → 62rem — so `/join` is as wide as every other screen at every
 * window (14 Oct, the developer: *"widen it as on the other pages"*; 40rem
 * alone was still narrow on a wide screen, where the others had grown).
 */
export const JOIN_WRAP =
  "mx-auto w-full max-w-[460px] px-[22px] md:max-w-[40rem] md:px-8 xl:max-w-[46rem] 2xl:max-w-[52rem] 3xl:max-w-[62rem]";

/**
 * "A South Pasadena parent just recommended a class · today" — real, recent and
 * de-identified (`lib/recent-activity.ts`), or nothing at all. It is fetched
 * after the page paints rather than awaited by it: the first screen a forwarded
 * link opens must not wait on the database (the same rule `recordInviteOpen`
 * follows), and a line that never arrives simply never shows.
 *
 * It turns over every 4.5s, and not at all under reduced motion. Not a live
 * region: a sentence that changes on a timer would talk over the form.
 */
export function RecentLine({ marketId }: { marketId: string }) {
  const [lines, setLines] = useState<string[]>([]);
  const [index, setIndex] = useState(0);
  const [fading, setFading] = useState(false);

  useEffect(() => {
    let live = true;
    fetch(`/api/public/recent?market_id=${encodeURIComponent(marketId)}`)
      .then((r) => (r.ok ? r.json() : { lines: [] }))
      .then((body: { lines?: unknown }) => {
        if (!live || !Array.isArray(body.lines)) return;
        setLines(body.lines.filter((l): l is string => typeof l === "string").slice(0, 6));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [marketId]);

  useEffect(() => {
    if (lines.length < 2) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let swap: number | undefined;
    const turn = window.setInterval(() => {
      setFading(true);
      swap = window.setTimeout(() => {
        setIndex((i) => (i + 1) % lines.length);
        setFading(false);
      }, 400);
    }, 4500);
    return () => {
      window.clearInterval(turn);
      if (swap) window.clearTimeout(swap);
    };
  }, [lines.length]);

  if (lines.length === 0) return null;
  return (
    <p className="mt-4 flex min-h-7 items-center gap-2.5 text-[0.92rem] text-paper/90 md:mt-2">
      <span
        aria-hidden="true"
        className="size-2 flex-none rounded-full bg-gold shadow-[0_0_0_4px_color-mix(in_oklab,var(--color-gold)_18%,transparent)]"
      />
      <span className={cn("transition-opacity duration-400", fading && "opacity-0")}>{lines[index]}</span>
    </p>
  );
}

const TILE = "rounded-[14px] border border-bark bg-card px-1.5 py-[11px] text-center";
const TILE_VALUE =
  "block font-display text-[1.1rem] font-extrabold leading-[1.1] tracking-[-0.02em] text-green-deep";
const TILE_LABEL = "mt-1 block text-[0.76rem] leading-[1.3] text-muted";

/** The three facts above the form — the mockup's tiles and words. */
export function JoinFacts() {
  return (
    <div role="list" aria-label="What to expect" className="mb-3.5 grid grid-cols-3 gap-2">
      <div role="listitem" className={TILE}>
        <b className={TILE_VALUE}>10–15 min</b>
        <span className={TILE_LABEL}>On your phone</span>
      </div>
      <div role="listitem" className="relative">
        <RewardFact />
      </div>
      <div role="listitem" className={TILE}>
        <b className={TILE_VALUE}>Jan 2027</b>
        <span className={TILE_LABEL}>Pilot opens</span>
      </div>
    </div>
  );
}

/**
 * The $10 tile, and what the $10 is for (14 Oct, the developer: *"make the
 * thank-you text better on hover, and make it clear to the user that it can be
 * hovered"*).
 *
 * The tile reads exactly as the mockup — "$10 · A thank-you" — plus the one
 * thing that says there is more: an ⓘ beside the label and a dotted underline,
 * the convention for "this explains itself". The explanation is `REWARD_OFFER`,
 * the same sentence the invite carries, so the page and the invite cannot
 * disagree about the conditions (two recommendations and a complete profile —
 * `meetsFoundingRequirements`), the deadline or the amount.
 *
 * ⚠ **Hover alone would hide it from everybody on a phone**, which is most of
 * the people who open this page — so it is a button: hover opens it where there
 * is a pointer that hovers, a tap or Enter toggles it everywhere, Escape and a
 * tap elsewhere close it. Never a `title` attribute (design system: invisible
 * until hovered, unreachable by touch).
 */
function RewardFact() {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const id = useId();
  const canHover = useRef(false);

  useEffect(() => {
    canHover.current = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  }, []);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  return (
    <div
      ref={wrap}
      className="h-full"
      onMouseEnter={() => canHover.current && setOpen(true)}
      onMouseLeave={() => canHover.current && setOpen(false)}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        /* Where hover already opened it, a click must not close it again under
           the pointer; on touch a tap is the only way in, so it toggles. */
        onClick={() => setOpen((o) => (canHover.current ? true : !o))}
        className={cn(
          TILE,
          "group h-full w-full cursor-pointer transition-colors hover:border-gold-line hover:bg-gold-wash",
          open && "border-gold-line bg-gold-wash",
        )}
      >
        <b className={TILE_VALUE}>$10</b>
        <span className={cn(TILE_LABEL, "flex items-center justify-center gap-1")}>
          <span className="underline decoration-muted/60 decoration-dotted underline-offset-[3px] group-hover:decoration-gold-ink">
            A thank-you
          </span>
          <InfoIcon />
          <span className="sr-only">— what it is for</span>
        </span>
      </button>

      {open && (
        /* `pt-2` rather than a margin, so the pointer crossing the gap from the
           tile to the card never leaves the wrapper and closes it. */
        <div className="absolute left-1/2 top-full z-30 w-[min(17.5rem,calc(100vw-2.5rem))] -translate-x-1/2 pt-2 animate-rise">
          <div
            id={id}
            role="note"
            className="rounded-2xl border border-gold-line bg-card p-4 text-left shadow-card"
          >
            <p className="font-display text-card-title font-bold leading-tight text-ink">
              Your $10 thank-you
            </p>
            <p className="mt-1.5 text-help leading-relaxed text-ink-soft">{REWARD_OFFER}</p>
            <p className="mt-2 text-help">
              <a
                href="/terms"
                target="_blank"
                rel="noopener"
                className="font-semibold text-green-deep underline underline-offset-2"
              >
                Terms
              </a>
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function InfoIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      className="size-3.5 flex-none text-muted group-hover:text-gold-ink"
      fill="none"
    >
      <circle cx="8" cy="8" r="6.6" stroke="currentColor" strokeWidth="1.4" />
      <path d="M8 7.2v3.9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="8" cy="4.9" r="0.95" fill="currentColor" />
    </svg>
  );
}

/**
 * `/join`'s footer: the mockup's words in the flow's format (14 Oct, the
 * developer — *"I meant the format; the text and what it carries stay as in
 * the mockup"*). So it is `ScreenFooter`'s box — the hairline, centred, help
 * size, muted, `pb-safe` — around the mockup's facts and its line about who
 * vouches for a provider.
 *
 * Its links open in a new tab, as the consent box's do: nothing is saved until
 * the code, and leaving the page here would lose a typed name and number.
 */
export function JoinFooter() {
  return (
    <footer className="border-t border-bark/50 px-5 pt-3 text-center text-help text-muted pb-safe">
      <p className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
        <span>© 2026 Pando Systems, Inc</span>
        <InlineAction href="/privacy" external>
          Privacy policy
        </InlineAction>
        <InlineAction href="/terms" external>
          Text messaging terms
        </InlineAction>
        <InlineAction href="mailto:hello@pando.is">hello@pando.is</InlineAction>
        <span>Pasadena, CA</span>
      </p>
      <p className="mx-auto mt-1.5 max-w-[30rem] pb-3 leading-relaxed md:max-w-none">
        Recommendations come from the parents who made them. Pando doesn&apos;t vet, employ or
        guarantee any provider.
      </p>
    </footer>
  );
}

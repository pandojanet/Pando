import type { ElementType, ReactNode } from "react";
import { cn } from "@/lib/cn";
import { BrandPanel } from "./BrandPanel";

/**
 * The one page skeleton every Seed Tool screen uses.
 *
 * Phone (default): full dynamic viewport height, the window scrolls, header and
 * dock are sticky. This is the design target and it is untouched.
 *
 * md and up: a real desktop layout, not a phone in a frame. The content column
 * widens to 40rem and the window scrolls normally — no simulated device, no
 * nested scrollbar, no 27rem ribbon to read through.
 *
 * lg and up: the moss panel becomes a full-height sidebar carrying context for
 * the current step (BrandPanel), so the app reads as a two-pane tool.
 */
export function Screen({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    /**
     * No `MotionProvider` here, and that is measured rather than cautious.
     *
     * It was here first, because every flow surface renders a `Screen`. Then the
     * eager payload of `/profile` was measured at **335 KB gz against 291 KB**
     * without the library — 44 KB, more than the 34 KB the admin's Radix removal
     * saved, and `LazyMotion` does not defer it (`m` and `AnimatePresence` are
     * imported statically, so the bundler pulls the feature set in with the
     * route). Putting that on `/join` — a first-time contributor's very first
     * request, on a phone — to animate nothing was the wrong trade.
     *
     * So the provider lives in `ProfileFlow` alone: seventeen screens with a
     * direction is the one place the library earns its weight. Everything else,
     * including the sheet reached from inside those screens, uses
     * `usePresence` + CSS.
     */
    <div className="min-h-dvh bg-paper lg:flex lg:items-stretch">
      <SkipLink />
      <BrandPanel />
      <div
        className={cn(
          "flex min-h-dvh flex-col bg-paper lg:min-w-0 lg:flex-1",
          className,
        )}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * The first thing a keyboard reaches, and the first thing this app never had.
 *
 * Without it, every step of the flow starts by tabbing through the header, and
 * on `lg` through the whole `BrandPanel` behind it — on *every* screen, of which
 * the profile alone has seventeen.
 *
 * It is the first child of the outer div and deliberately **not** inside
 * anything animated: a filled keyframe ending at `transform: none` still
 * computes to the identity matrix, which makes its element the containing block
 * for `position: fixed` — the 5 Aug bug, and this is the one element in the app
 * that has to be able to escape its own flow when focused.
 *
 * ⚠ The wording is new user-facing copy and is on the list for the client.
 */
export function SkipLink({ href = "#main" }: { href?: string }) {
  return (
    <a
      href={href}
      className="sr-only rounded-full border border-bark bg-card px-4 py-3 font-semibold text-green-deep text-help focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50"
    >
      Skip to the questions
    </a>
  );
}

/**
 * The measure for everything in the app column: comfortable on a phone, and wide
 * enough on a laptop that a list of neighborhoods doesn't need scrolling.
 */
export function Container({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "mx-auto w-full max-w-[27rem] px-5 md:max-w-[40rem] md:px-8",
        /* 40rem is right where `lg` starts — a 21rem rail leaves ~43rem of
           column, so the measure nearly fills it. Past that the window grows and
           the column doesn't, which stranded 150–300px of empty paper either
           side. The measure grows with it instead. What uses the extra width is
           the recap table and the tap lists; chat lines are capped separately in
           `Bubble` so they don't turn into one long line. */
        "xl:max-w-[46rem] 2xl:max-w-[52rem] 3xl:max-w-[62rem]",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function ScreenHeader({
  left,
  right,
  below,
}: {
  left?: ReactNode;
  right?: ReactNode;
  below?: ReactNode;
}) {
  return (
    <header className="sticky top-0 z-30 border-b border-bark/70 bg-paper/90 backdrop-blur-md pt-safe md:pt-3">
      <Container className="pb-2.5 md:pb-3">
        <div className="flex min-h-11 items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">{left}</div>
          <div className="flex shrink-0 items-center gap-1">{right}</div>
        </div>
        {below}
      </Container>
    </header>
  );
}

export function ScreenBody({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    /* `tabIndex={-1}` so the skip link can actually put focus here. Without it
       the browser scrolls to the anchor and leaves focus on the link, so the
       next Tab goes straight back into the header the parent just skipped.
       The focus ring is deliberately *not* suppressed: the last interaction was
       a keypress, so `:focus-visible` matches, and the ring is the only thing
       telling the parent where they landed. */
    <main
      id="main"
      tabIndex={-1}
      className={cn("flex-1 pb-8 pt-6 md:pb-12 md:pt-10", className)}
    >
      <Container>{children}</Container>
    </main>
  );
}

/**
 * The action area. On a phone it's a sticky dock — the primary control has to be
 * under the thumb. From `md` it drops into normal page flow: a floating bar is a
 * phone idiom, and on a laptop it costs half the window while the mouse can reach
 * anywhere. Same markup, one instance, different behaviour per breakpoint.
 */
export function ScreenDock({
  children,
  stickyOnDesktop,
}: {
  children: ReactNode;
  /**
   * Keep the dock pinned above `md` too. Only the entry screen uses it: its CTA
   * is the entire purpose of the page, and the page is taller than a laptop
   * window. Flow screens read better with the action at the end of the content.
   */
  stickyOnDesktop?: boolean;
}) {
  return (
    <div
      className={cn(
        "sticky bottom-0 z-30 border-t border-bark/70 bg-paper/95 backdrop-blur-md",
        !stickyOnDesktop && "md:static md:bg-transparent md:backdrop-blur-none",
      )}
    >
      <Container
        className={cn(
          "pt-3 pb-safe",
          stickyOnDesktop ? "md:pb-4" : "md:pt-6 md:pb-14",
        )}
      >
        {children}
      </Container>
    </div>
  );
}

/**
 * Small uppercase category label above a screen title.
 *
 * ## Why this is the only one
 *
 * There were two components called `Eyebrow` — this one and a second in
 * `components/site/Shell.tsx` at `0.78rem` (≈12.48px against this one's
 * 11.5px). Same name, same job, imported from different places, a pixel apart,
 * and nothing on either screen said which was right. The site shell now
 * re-exports this rather than redeclaring it: the public site keeps its own
 * shell — that separation is deliberate — but there is no argument for a second
 * eyebrow size.
 *
 * `tone` exists so the two hand-written gold ones (`BrandPanel`'s badge and the
 * "ask" cards on the marketing home) stop being hand-written. Measured across
 * the codebase, this component had **nine** distinct `tracking` values; it is
 * one token now (`--tracking-eyebrow`).
 *
 * The size is the floor of the type scale on purpose. Anything smaller is the
 * design system's "if it needs to be under 12.5px, it needs to be cut instead".
 */
export function Eyebrow({
  children,
  tone = "green",
  as: Tag = "p",
  className,
}: {
  children: ReactNode;
  /**
   * `green` is the flow's category label on paper; `gold` marks something
   * special; `muted` is a sub-label inside a question.
   *
   * **`deep` is for an eyebrow sitting on `green-wash`, and it is a contrast
   * requirement rather than a preference.** Measured: `green` (#587a4a) on paper
   * is 4.50:1, which clears AA for normal text by nothing at all — and on
   * `green-wash` (#eef2e8) it falls to **4.30:1**, which does not. At 11.5px this
   * is normal text, not large text, so 4.5 is the bar. `green-deep` on the same
   * wash is 7.0:1.
   */
  tone?: "green" | "deep" | "gold" | "muted";
  /** `span` where it sits inside a card rather than above a title. */
  as?: ElementType;
  /** Spacing only. */
  className?: string;
}) {
  return (
    <Tag
      className={cn(
        "font-semibold uppercase text-eyebrow tracking-eyebrow",
        tone === "green" && "text-green",
        tone === "deep" && "text-green-deep",
        tone === "gold" && "text-gold",
        tone === "muted" && "text-muted",
        className,
      )}
    >
      {children}
    </Tag>
  );
}

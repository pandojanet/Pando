import type { ReactNode } from "react";
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
    <div className="min-h-dvh bg-paper lg:flex lg:items-stretch">
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
    <main className={cn("flex-1 pb-8 pt-6 md:pb-12 md:pt-10", className)}>
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

/** Small uppercase category label above a screen title. */
export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="text-[11.5px] font-semibold uppercase tracking-[0.15em] text-green">
      {children}
    </p>
  );
}

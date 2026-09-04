"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Keeps a closing element mounted long enough for its exit keyframe to play.
 *
 * ## Why this exists rather than a library
 *
 * CSS can animate something leaving perfectly well; what it cannot do is stop
 * React unmounting it on the same frame the flag flips. That one missing piece
 * is the reason this app had **no exit animation anywhere** — the "other" sheet
 * slid up over 260ms and then disappeared between two frames.
 *
 * `motion`'s `AnimatePresence` solves it, and measured on this app it costs
 * **44 KB gzipped** in the eager payload — `LazyMotion` does not defer it,
 * because `m` and `AnimatePresence` are imported statically and the bundler
 * pulls the feature set in with the route. That is more than the 34 KB the
 * admin's Radix removal saved, on the mobile path a first-time contributor
 * loads. So the library is kept for the one surface that earns it (the profile's
 * step transition, which also needs direction) and everything else uses this.
 *
 * ## Reduced motion is not a smaller number, it is zero
 *
 * The global CSS rule collapses the animation to 0.01ms, so a timer still
 * holding the element for 220ms would leave it on screen, motionless, after it
 * had visually gone. Read live and re-subscribed, because a parent can change
 * the setting mid-session.
 */
export function usePresence(open: boolean, ms: number): boolean {
  const [mounted, setMounted] = useState(open);
  const reduced = useRef(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    reduced.current = mq.matches;
    const onChange = (e: MediaQueryListEvent) => {
      reduced.current = e.matches;
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    if (open) {
      setMounted(true);
      return;
    }
    if (!mounted) return;
    const t = window.setTimeout(() => setMounted(false), reduced.current ? 0 : ms);
    return () => window.clearTimeout(t);
  }, [open, mounted, ms]);

  return mounted;
}

"use client";

import { LazyMotion, MotionConfig } from "motion/react";
import type { ReactNode } from "react";

/**
 * The one place `motion` is switched on, and it is switched on **only in the
 * parent flow**.
 *
 * ## Why a library is here at all, given CLAUDE.md's rule
 *
 * The repo deliberately ships no animation library — the admin's Radix removal
 * (102KB, 34KB gzipped) is a measured decision and still stands. This is the
 * developer's call, taken with the cost named, and it buys one thing CSS cannot
 * do at all: **exit animations**. Every keyframe in `globals.css` is an entrance.
 * `ProfileFlow` swaps a keyed `<div>` and the old step is simply gone on the next
 * frame; `animate-step-in-back` exists precisely because CSS can only animate
 * something that is arriving. The sheet closing is the most visible instance —
 * it vanishes.
 *
 * ## How the cost is kept down, and each of these matters
 *
 * - **`LazyMotion` with a dynamic `domAnimation`.** The feature bundle is
 *   fetched after hydration rather than shipped in the first payload, and
 *   `domAnimation` is the small set (no layout projection, no drag) — roughly a
 *   third of the full package.
 * - **`m` everywhere, never `motion`.** Importing `motion.div` pulls in every
 *   feature and defeats `LazyMotion` entirely; `strict` makes that a runtime
 *   error rather than a silent regression, which is the only way a rule like
 *   this survives.
 * - **Not on the public site, not in the admin.** The marketing pages are the
 *   LCP-sensitive surface and stay on CSS; the admin has nothing to animate.
 *
 * ## Reduced motion is the library's job now
 *
 * `MotionConfig reducedMotion="user"` makes every transform animation respect
 * the OS setting **and re-evaluate when it changes** — which the CSS blanket
 * rule in `globals.css` also does, and which `ChatSeeding`'s hand-rolled read
 * did not until this pass. Both stay: the CSS rule is the belt, this is the one
 * that governs anything animated in JS.
 */
export function MotionProvider({ children }: { children: ReactNode }) {
  return (
    <LazyMotion strict features={loadDomAnimation}>
      <MotionConfig reducedMotion="user">{children}</MotionConfig>
    </LazyMotion>
  );
}

const loadDomAnimation = () => import("./motion-features").then((m) => m.default);

/**
 * The flow's one easing and its two durations, so a component never picks a
 * number. `--ease-soft` as its cubic-bezier control points — the same curve the
 * CSS keyframes use, because the app has to move as one thing whether a given
 * transition happens to be driven by CSS or by JS.
 */
export const EASE_SOFT = [0.22, 1, 0.36, 1] as const;

/** A screen arriving or leaving. Matches `--animate-step-in`'s 0.34s. */
export const STEP = { duration: 0.34, ease: EASE_SOFT } as const;

/** Something small appearing in place — a chip, a row, a sheet. */
export const QUICK = { duration: 0.22, ease: EASE_SOFT } as const;

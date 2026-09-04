/**
 * `domAnimation` behind its own module specifier.
 *
 * `import("motion/react")` inside `Motion.tsx` does not split, because
 * `motion/react` is already in the graph statically (`m`, `AnimatePresence`) —
 * the bundler merges the dynamic import back into the same chunk. A distinct
 * module is the only thing that gives it a split point.
 */
export { domAnimation as default } from "motion/react";

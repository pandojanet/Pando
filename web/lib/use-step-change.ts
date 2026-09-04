"use client";

import { useEffect, useRef, type RefObject } from "react";

/**
 * What has to happen when a flow moves to the next screen.
 *
 * ## Why it is a hook and not two copies
 *
 * `ProfileFlow` scrolled to the top on step change; **`CaregiverFlow` did not**
 * — it had no `useEffect` at all, so tap step 4 opened at whatever scroll offset
 * step 3 had been left at. That is the most user-visible defect this pass found
 * in the caregiver flow, and it is exactly the kind that survives review because
 * each file looks complete on its own.
 *
 * ## What it does that neither did
 *
 * **Moves focus to the new screen's heading.** Both flows swap the entire body
 * and leave focus wherever it was — usually on the Continue button that is now
 * a different Continue button, with a screen full of silently changed content
 * around it. A keyboard or screen-reader user had no way to know the question
 * changed. The heading takes `tabIndex={-1}` and is focused with
 * `preventScroll`, because the scroll has already been done deliberately.
 *
 * ⚠ Behaviour change, and the guard matters as much as the feature:
 *
 * **The first run is skipped.** A resumed session lands mid-flow — that is the
 * whole point of autosave — and stealing focus on load is hostile: it moves the
 * page under somebody who has not touched anything yet, and on iOS it can raise
 * a keyboard nobody asked for.
 *
 * The announcement is deliberately *not* here. A live region has to exist before
 * its content changes (the rule `ChatSeeding` and `Note` both record), so it is
 * rendered by the flow from first paint rather than created by an effect.
 */
export function useStepChange(
  /** Anything that identifies the current screen. Changing it is the trigger. */
  key: unknown,
  heading: RefObject<HTMLElement | null>,
) {
  const settled = useRef(false);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });

    if (!settled.current) {
      settled.current = true;
      return;
    }
    heading.current?.focus({ preventScroll: true });
  }, [key, heading]);
}

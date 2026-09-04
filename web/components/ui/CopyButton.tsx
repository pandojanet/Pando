"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";

/**
 * Put something on the clipboard, and say so out loud.
 *
 * ## Why this is a component
 *
 * Two near-identical implementations — the caregiver invite in the chat, and the
 * referral message on `/done/next` — with the same class string, the same 2400ms
 * timeout, and the same two faults.
 *
 * **`aria-live` was on the button itself.** Both put `aria-live="polite"` on the
 * `<button>` whose own label then changes, which makes the *control* the live
 * region: what a screen reader announces is the whole button, re-read, and
 * announcing by mutating the accessible name of the focused element is
 * unreliable in the first place. This is the rule `Note` and `ResultNote`
 * already settled — the region is never the element, and it must exist before
 * its content changes — arriving one surface later. So the visual feedback stays
 * a label swap (that part works) and a separate, permanently-mounted `sr-only`
 * `role="status"` carries the announcement.
 *
 * **A blocked clipboard read as a dead button.** Both did
 * `.catch(() => setCopied(false))` — so on an older iOS webview, or any context
 * where the Clipboard API is refused, the parent taps and *nothing happens at
 * all*. It now says so.
 *
 * ⚠ The failure sentence is new user-facing copy and is on the list for the
 * client. It is deliberately plain and actionable rather than an apology.
 *
 * ## The box stays here rather than becoming a fifth `Button` variant
 *
 * Two call sites is thin, and appending `border-green` to `buttonClass`
 * ("secondary") would put `border-bark` and `border-green` in one Tailwind
 * layer, where output order decides and the string does not. The component owns
 * its own box — the house rule, and here also the safe one.
 */
export function CopyButton({
  text,
  label,
  copiedLabel,
  onCopied,
  className,
}: {
  /** What goes on the clipboard. */
  text: string;
  label: string;
  /** Shown on the button for a moment after a successful copy. */
  copiedLabel: string;
  /** Analytics, fired only when the write actually succeeded. */
  onCopied?: () => void;
  /** Spacing only. */
  className?: string;
}) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  async function copy() {
    window.clearTimeout(timer.current);
    try {
      await navigator.clipboard.writeText(text);
      setState("copied");
      onCopied?.();
    } catch {
      setState("failed");
    }
    timer.current = window.setTimeout(() => setState("idle"), 2400);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => void copy()}
        className={cn(
          "min-h-11 w-full rounded-full border border-green bg-card px-4 font-semibold text-green-deep text-control",
          className,
        )}
      >
        {state === "copied" ? copiedLabel : label}
      </button>
      {/* Mounted from the first render and empty, which is the whole point: a
          region created at the same moment as its content never fires. */}
      <span role="status" className="sr-only">
        {state === "copied" ? copiedLabel : state === "failed" ? FAILED : ""}
      </span>
      {state === "failed" && (
        <p className="mt-2 text-gold-ink text-help">{FAILED}</p>
      )}
    </>
  );
}

const FAILED = "Couldn't copy — select the text above and copy it by hand.";

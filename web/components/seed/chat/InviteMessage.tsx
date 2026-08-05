"use client";

import { useState } from "react";

/**
 * The message the parent sends to a caregiver they nominated (C11).
 *
 * It sits in the transcript as something to copy, not something Pando will send:
 * Pando never contacts a nominated caregiver, and nothing about them is stored
 * until they set up their own profile. The copy button is the whole feature — on a
 * phone, selecting several lines of text by hand is exactly where a parent gives up.
 */
export function InviteMessage({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2400);
    } catch {
      // Clipboard blocked (older iOS in a webview, permissions): the text is on
      // screen and selectable, so say nothing rather than raise an error.
      setCopied(false);
    }
  }

  return (
    <div className="animate-rise rounded-3xl rounded-bl-lg border border-green/25 bg-green-wash p-4">
      <p className="text-[12.5px] font-semibold uppercase tracking-[0.09em] text-green-deep">
        Send this to them
      </p>
      <p className="mt-2 whitespace-pre-line text-[15px] leading-relaxed text-ink">
        {text}
      </p>
      <button
        type="button"
        onClick={() => void copy()}
        aria-live="polite"
        className="mt-3 min-h-[44px] w-full rounded-full border border-green bg-card px-4 text-[15px] font-semibold text-green-deep"
      >
        {copied ? "Copied — paste it into your messages" : "Copy the message"}
      </button>
    </div>
  );
}

"use client";

import { TextAction } from "@/components/ui/TextAction";
import { SHARE_ORDER } from "@/lib/seed-chat/scripts";
import type { Script, ShareKind } from "@/lib/seed-chat/types";

/**
 * The "what would you like to share?" menu (estimate 1.4). Lives in the dock so
 * it's inside thumb reach, and comes back after every saved card — that's the
 * "add another" loop.
 */
export function ShareMenu({
  scripts,
  onPick,
  onDone,
  savedCount,
  heading,
}: {
  scripts: Record<ShareKind, Script>;
  onPick: (kind: ShareKind) => void;
  onDone: () => void;
  savedCount: number;
  /**
   * The call to action after the first completed contribution (5 Oct): "Add
   * one more contribution". Over the same choices rather than one more
   * button, so the way to do it is the menu the parent already knows.
   */
  heading?: string;
}) {
  return (
    <div>
      {heading && (
        <p className="mb-2 text-center text-[14px] font-semibold text-green-deep">{heading}</p>
      )}
      {/* Five choices since the doctor card (8 Oct): three across and two wider
          ones below on a phone, one row of five from md. Two columns made three
          rows, and the dock took 57% of a 360×640 screen against the under-half
          rule (measured); this keeps it to two rows, and the longest label —
          the doctor's — lands in a wide tile. */}
      <div className="grid grid-cols-6 gap-2 md:grid-cols-5">
        {SHARE_ORDER.map((kind, i) => (
          <button
            key={kind}
            type="button"
            onClick={() => onPick(kind)}
            className={`flex min-h-[72px] flex-col items-center justify-center gap-1.5 rounded-2xl border border-bark bg-card p-3 text-center transition-[transform,border-color] duration-150 hover:border-green/60 active:scale-[0.97] md:col-span-1 ${
              i < 3 ? "col-span-2" : "col-span-3"
            }`}
          >
            <span className="text-green">{ICONS[kind]}</span>
            <span className="text-[14px] font-semibold leading-tight">
              {scripts[kind].label}
            </span>
          </button>
        ))}
      </div>

      <TextAction tone="quiet" underline={false} full className="mt-2" onClick={onDone}>
        {savedCount === 0 ? "I’ll do this later" : "That’s me for now"}
      </TextAction>
    </div>
  );
}

const ICONS: Record<ShareKind, React.ReactNode> = {
  activity: (
    <svg viewBox="0 0 22 22" className="h-[22px] w-[22px]" fill="none" aria-hidden="true">
      <path
        d="M8.5 15.5a2.5 2.5 0 1 1-2.5-2.5c.6 0 1.1.2 1.5.5V4.8l7-1.6v9.3"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="17" cy="12.8" r="2.2" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  ),
  caregiver: (
    <svg viewBox="0 0 22 22" className="h-[22px] w-[22px]" fill="none" aria-hidden="true">
      <circle cx="11" cy="7.6" r="3.4" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M4.6 18.4c0-3.2 2.9-5.4 6.4-5.4s6.4 2.2 6.4 5.4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  ),
  place: (
    <svg viewBox="0 0 22 22" className="h-[22px] w-[22px]" fill="none" aria-hidden="true">
      <path
        d="M11 19.2s6-4.9 6-9.2a6 6 0 1 0-12 0c0 4.3 6 9.2 6 9.2Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <circle cx="11" cy="9.6" r="2.2" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  ),
  doctor: (
    <svg viewBox="0 0 22 22" className="h-[22px] w-[22px]" fill="none" aria-hidden="true">
      <rect x="3.2" y="3.2" width="15.6" height="15.6" rx="4.4" stroke="currentColor" strokeWidth="1.6" />
      <path d="M11 7.4v7.2M7.4 11h7.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  ),
  tip: (
    <svg viewBox="0 0 22 22" className="h-[22px] w-[22px]" fill="none" aria-hidden="true">
      <path
        d="M11 3.2a5.6 5.6 0 0 0-3.2 10.2v1.8h6.4v-1.8A5.6 5.6 0 0 0 11 3.2Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M9 18.2h4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  ),
};

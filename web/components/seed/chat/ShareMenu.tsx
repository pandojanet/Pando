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
}: {
  scripts: Record<ShareKind, Script>;
  onPick: (kind: ShareKind) => void;
  onDone: () => void;
  savedCount: number;
}) {
  return (
    <div>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {SHARE_ORDER.map((kind) => (
          <button
            key={kind}
            type="button"
            onClick={() => onPick(kind)}
            className="flex min-h-[72px] flex-col items-center justify-center gap-1.5 rounded-2xl border border-bark bg-card p-3 text-center transition-[transform,border-color] duration-150 hover:border-green/60 active:scale-[0.97]"
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

"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";

/**
 * The one extra turn estimate 1.8 asks for: a parent's thin answer, and a chance
 * to say more while they are still here.
 *
 * Its own component rather than a `StepWidget` case, because it is not a step: no
 * script contains it, it has no index in a card's progress, and undoing it would
 * mean undoing a card that is already complete. Keeping it out of the step machine
 * is what stops it appearing in the recap or the "change my last answer" rewind.
 */
export function ConfirmBackWidget({
  onAnswer,
  onSkip,
}: {
  onAnswer: (text: string) => void;
  onSkip: () => void;
}) {
  const [text, setText] = useState("");
  const ready = text.trim().length > 0;

  return (
    <div>
      <label htmlFor="confirm-back" className="sr-only">
        Anything to add
      </label>
      <textarea
        id="confirm-back"
        value={text}
        onChange={(e) => setText(e.target.value.slice(0, 500))}
        rows={3}
        autoFocus
        enterKeyHint="done"
        placeholder="A sentence is plenty"
        className="min-h-[84px] w-full rounded-2xl border border-bark bg-card px-4 py-3 text-[16px] leading-relaxed outline-none placeholder:text-muted/60 focus:border-green"
      />
      <div className="mt-2.5 flex items-center gap-3">
        <Button onClick={() => onAnswer(text)} disabled={!ready} full>
          Add this
        </Button>
        {/* As reachable as the primary action, on purpose — see the component
            comment. A 44px target, not a text link squeezed under the button. */}
        <button
          type="button"
          onClick={onSkip}
          className="min-h-11 shrink-0 px-2 text-[14.5px] font-semibold text-muted transition-colors hover:text-green-deep"
        >
          It&apos;s fine as it is
        </button>
      </div>
    </div>
  );
}

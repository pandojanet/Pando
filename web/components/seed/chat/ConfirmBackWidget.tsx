"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { TextAction } from "@/components/ui/TextAction";

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
  const box = useRef<HTMLTextAreaElement>(null);

  /**
   * Focus after paint, not `autoFocus`.
   *
   * `autoFocus` fires during commit, before the widget has been laid out, so on
   * iOS the keyboard starts rising against a dock that is still moving — the
   * rule `mobile-first-ui` states and `OtherSheet` already implements. A frame
   * later the box is where it will stay and the keyboard comes up under it.
   */
  useEffect(() => {
    const raf = requestAnimationFrame(() => box.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div>
      <Field
        id="confirm-back"
        label="Anything to add"
        labelHidden
        rows={3}
        ref={box}
        value={text}
        onChange={(e) => setText(e.target.value.slice(0, 500))}
        enterKeyHint="done"
        placeholder="A sentence is plenty"
      />
      <div className="mt-2.5 flex items-center gap-3">
        <Button onClick={() => onAnswer(text)} disabled={!ready} full>
          Add this
        </Button>
        {/* As reachable as the primary action, on purpose — see the component
            comment. A 44px target, not a text link squeezed under the button. */}
        <TextAction
          tone="quiet"
          underline={false}
          className="shrink-0 px-2"
          onClick={onSkip}
        >
          It&apos;s fine as it is
        </TextAction>
      </div>
    </div>
  );
}

"use client";

import { useId } from "react";
import type {
  InputHTMLAttributes,
  ReactNode,
  Ref,
  TextareaHTMLAttributes,
} from "react";
import { cn } from "@/lib/cn";

/**
 * A labelled text box — the one way this app asks a parent to type something.
 *
 * ## Why this is a component
 *
 * There were **seventeen** hand-written inputs and textareas across the seed,
 * caregiver and chat surfaces. Counted, they disagreed on five axes, and two of
 * the disagreements were defects rather than drift.
 *
 * **The focus ring existed in two mutually exclusive languages.** Fourteen of
 * the seventeen set `outline-none`, which suppresses the global
 * `:focus-visible { outline: 2px solid gold }` in `globals.css` and replaces it
 * with a green border. The three in `CaregiverFlow` did the opposite: they kept
 * the gold ring and had no green border. So a keyboard user got one indicator
 * on `/join` and a different one on `/caregiver`, and neither screen looked
 * wrong on its own. `Field` does **both** — the green border is the pointer
 * affordance, the gold ring is the app's one focus language and is never
 * suppressed.
 *
 * **A textarea is not a tall input.** An `<input>` centres its own text in a
 * 52px box through line-height; a `<textarea>` does not, so `px-4 min-h-[52px]`
 * is correct for one and puts the caret against the top edge of the other. The
 * three multiline fields had three different answers to this (`p-4`,
 * `px-4 py-3`, `px-4 py-3 min-h-[84px]`). That is the same shape as the
 * `TextAction` lesson — a `<button>` and an `<a>` look interchangeable at the
 * call site and are not — and it is why this is a component rather than a
 * `fieldClass` string.
 *
 * The rest was ordinary drift: `bg-paper` against `bg-card` with no rule saying
 * which; 16px, 16.5px and 22px; and a fourth focus treatment on the OTP box.
 *
 * ## `on` names the rule instead of freezing one answer
 *
 * A field is always the *opposite* surface to the thing it sits on — white in a
 * paper page, warm paper inside a white `Panel`. Both existing answers were
 * locally right and neither knew about the other, so flattening them to one
 * colour would have made half the call sites wrong. One prop states the rule.
 *
 * ## `error` is linked, not announced
 *
 * It sets `aria-invalid` and wires `aria-describedby` — neither of which
 * appeared **anywhere** in this app before, so `PhoneField`'s "that doesn't look
 * like a complete number yet" was a sentence no screen reader ever reached. It
 * is deliberately not a live region: this fires per keystroke on a
 * half-typed phone number, and a region would read the whole thing out on every
 * digit. Linked means it is read when focus lands, which is when it matters.
 *
 * Gold, never red, for the reason `Note` already settles: every one of these is
 * recoverable by definition.
 */

type Common = {
  /** Always required. `labelHidden` renders it `sr-only`. */
  label: ReactNode;
  /**
   * For the dock widgets and the sheet, where the surrounding copy is the
   * question and a second visible label would be the screen repeating itself.
   */
  labelHidden?: boolean;
  /** Static help under the label. Linked with `aria-describedby`. */
  hint?: ReactNode;
  /** Wrong or incomplete. Sets `aria-invalid` and is linked, not announced. */
  error?: ReactNode;
  /** Which surface the field sits **on**, so the field can be the other one. */
  on?: "paper" | "card";
  /** `code` is the OTP box and nothing else: big, tracked, tabular, centred. */
  variant?: "text" | "code";
  /**
   * `center` for a field whose whole value is one or two characters — a last
   * initial. Left-aligned, a single letter sits alone at the far edge of a
   * 52px box and reads as a rendering mistake.
   */
  align?: "start" | "center";
  /** Spacing only. The box itself is not overridable. */
  className?: string;
};

type InputProps = Common &
  Omit<InputHTMLAttributes<HTMLInputElement>, "className" | "size"> & {
    rows?: undefined;
    /* React 19 passes `ref` through as an ordinary prop; the types for the
       intrinsic attributes do not include it, so it is declared here. */
    ref?: Ref<HTMLInputElement>;
  };

type AreaProps = Common &
  Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "className"> & {
    /** Present ⇒ a `<textarea>`. Absent ⇒ an `<input>`. */
    rows: number;
    ref?: Ref<HTMLTextAreaElement>;
  };

/**
 * The box alone, for the one composite control that owns its own layout:
 * `PhoneField` puts the border on a wrapper so the country select and the
 * number read as one field.
 */
export function fieldShell({
  on = "paper",
  invalid = false,
}: { on?: "paper" | "card"; invalid?: boolean } = {}): string {
  return cn(
    "w-full rounded-2xl border bg-card text-field placeholder:text-muted/60",
    // Selected, never appended — two `bg-*` in one layer are resolved by
    // Tailwind's output order and not by this string.
    on === "card" && "bg-paper",
    invalid ? "border-gold-line" : "border-bark focus-within:border-green",
  );
}

export function Field(props: InputProps | AreaProps) {
  const {
    label,
    labelHidden,
    hint,
    error,
    on = "paper",
    variant = "text",
    align = "start",
    className,
    id: givenId,
    ...rest
  } = props as Common & { id?: string } & Record<string, unknown>;

  const auto = useId();
  const id = givenId ?? auto;
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  /* Merged, not replaced. `aria-describedby` is set after the `{...rest}` spread
     below, so computing it from hint/error alone would silently delete one a
     caller passed — and the caller that does (the OTP box, pointing at its
     "valid for 5 minutes" line) would have lost it with nothing failing. */
  const describedBy =
    [hintId, errorId, (rest as Record<string, unknown>)["aria-describedby"]]
      .filter(Boolean)
      .join(" ") || undefined;

  const multiline = (props as AreaProps).rows !== undefined;
  const code = variant === "code";

  const box = cn(
    "w-full rounded-2xl border text-ink placeholder:text-muted/60",
    // The one size, and the reason it is not 15px: iOS Safari zooms the page
    // when a focused input is under 16px.
    code ? "text-[22px] font-semibold tracking-[0.35em] tabular-nums" : "text-field",
    on === "card" ? "bg-paper" : "bg-card",
    // The two box models, selected rather than layered. See the header.
    multiline ? "px-4 py-3 leading-relaxed" : "min-h-[52px] px-4",
    code && "py-3",
    (code || align === "center") && "text-center",
    // The pointer affordance. The gold `:focus-visible` ring from globals.css is
    // deliberately *not* suppressed — that suppression is the bug this closes.
    error ? "border-gold-line" : "border-bark focus:border-green",
  );

  const control = multiline ? (
    <textarea
      {...(rest as TextareaHTMLAttributes<HTMLTextAreaElement>)}
      id={id}
      aria-invalid={error ? true : undefined}
      aria-describedby={describedBy}
      className={cn(box, "resize-none")}
    />
  ) : (
    <input
      {...(rest as InputHTMLAttributes<HTMLInputElement>)}
      id={id}
      aria-invalid={error ? true : undefined}
      aria-describedby={describedBy}
      className={box}
    />
  );

  return (
    <div className={className}>
      <label
        htmlFor={id}
        className={cn(
          "block font-semibold text-control",
          labelHidden && "sr-only",
        )}
      >
        {label}
      </label>
      {hint && (
        <p id={hintId} className="mt-1 leading-snug text-muted text-help">
          {hint}
        </p>
      )}
      <div className={labelHidden ? undefined : "mt-1.5"}>{control}</div>
      {error && (
        <p id={errorId} className="mt-1.5 text-gold-ink text-help">
          {error}
        </p>
      )}
    </div>
  );
}

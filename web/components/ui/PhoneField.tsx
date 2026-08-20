"use client";

import { useState } from "react";
import {
  PHONE_COUNTRIES,
  type PhoneCountry,
  formatPhone,
  isPhoneComplete,
  phoneCountryLabel,
  phoneCountryName,
  phoneCountryOf,
  phonePlaceholder,
} from "@/lib/phone";
import { cn } from "@/lib/cn";

interface Props {
  value: string;
  onChange: (formatted: string) => void;
  label: string;
  hint?: string;
  id?: string;
}

/**
 * The phone input, for a US or a Ukrainian number.
 *
 * ## Two things worth not undoing
 *
 * **The country lives here and nowhere else.** It is not a prop and it is not in
 * the autosaved session: the formatted value already says which country it is
 * (see `lib/phone.ts`), so nothing upstream has to hold a second copy that could
 * disagree with the number beside it.
 *
 * **What the number is beats what the picker says.** A complete value overrides
 * the picker rather than the other way round, so switching to `+1` with a
 * Ukrainian number in the box snaps back to `+380` instead of leaving the field
 * claiming a country the digits contradict. While the value is still a partial —
 * which is most of the time somebody is typing — the pick is what governs, which
 * is what makes the grouping change the moment you choose.
 */
export function PhoneField({
  value,
  onChange,
  label,
  hint,
  id = "phone",
}: Props) {
  const [picked, setPicked] = useState<PhoneCountry | null>(null);
  const country = phoneCountryOf(value) ?? picked ?? "US";

  const complete = isPhoneComplete(value, country);
  const started = value.trim().length > 0;

  function pick(next: PhoneCountry) {
    setPicked(next);
    /* Re-group what they already typed rather than clearing it: someone who
       mis-picked and typed nine digits should not have to type them again. */
    onChange(formatPhone(value, next));
  }

  return (
    <div>
      <label htmlFor={id} className="block text-[15px] font-semibold">
        {label}
      </label>
      {hint && (
        <p id={`${id}-hint`} className="mt-1 text-[14px] leading-snug text-muted">
          {hint}
        </p>
      )}

      {/* The border is on the wrapper, not on either control, so focus and the
          incomplete state colour one ring around the pair instead of two. */}
      <div
        className={cn(
          "mt-2.5 flex items-stretch overflow-hidden rounded-2xl border bg-card",
          "focus-within:border-green",
          started && !complete ? "border-gold-line" : "border-bark",
        )}
      >
        <div className="relative flex items-center">
          <select
            aria-label="Country code"
            value={country}
            onChange={(e) => pick(e.target.value as PhoneCountry)}
            /* 52px so the control clears the tap-target floor on its own, and
               `appearance-none` because native select chrome inside a field
               border reads as two nested inputs. */
            className="min-h-[52px] appearance-none bg-transparent pl-4 pr-7 text-[16px] text-ink-soft outline-none"
          >
            {PHONE_COUNTRIES.map((c) => (
              <option key={c} value={c}>
                {phoneCountryLabel(c)}
              </option>
            ))}
          </select>
          <svg
            viewBox="0 0 10 6"
            aria-hidden="true"
            className="pointer-events-none absolute right-2.5 h-1.5 w-2.5 text-muted"
          >
            <path
              d="M1 1l4 4 4-4"
              stroke="currentColor"
              strokeWidth="1.5"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span aria-hidden="true" className="h-7 w-px self-center bg-bark" />
        </div>

        <div className="relative flex-1">
          <input
            id={id}
            value={value}
            onChange={(e) => onChange(formatPhone(e.target.value, country))}
            type="tel"
            inputMode="tel"
            autoComplete="tel-national"
            enterKeyHint="done"
            placeholder={phonePlaceholder(country)}
            aria-describedby={hint ? `${id}-hint` : undefined}
            className="min-h-[52px] w-full bg-transparent pl-3.5 pr-11 text-[16px] outline-none placeholder:text-muted/60"
          />
          {complete && (
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-green">
              <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" aria-hidden="true">
                <path
                  d="M3 8.5 6.3 12 13 4.5"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
          )}
        </div>
      </div>

      {/* Only once the picker and the digits disagree — never as they type. */}
      {started && !complete && (
        <p className="mt-1.5 text-[14px] text-gold-ink">
          That doesn&apos;t look like a complete {phoneCountryName(country)} mobile
          number yet.
        </p>
      )}
    </div>
  );
}

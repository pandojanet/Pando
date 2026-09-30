"use client";

import { useEffect, useState } from "react";
import {
  digitsOf,
  formatPhone,
  isPhoneComplete,
  phoneCountryLabel,
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
 * The phone input: a US number, and nothing else is offered (30 Sep).
 *
 * The developer asked for the Ukrainian option to go from every page: existing
 * accounts stay, but nobody new registers or logs in with one. The picker that
 * let a `+380` be typed at all (20 Aug) is gone from every screen that asks for a
 * number, because every one of them renders this field.
 *
 * ⚠ **It changes what is offered, not what is stored or parsed.** `lib/phone.ts`
 * still understands a Ukrainian number, so an account that already exists is
 * untouched in the database and a stored one still displays correctly wherever it
 * is shown. What is gone is any way to *enter* one here.
 *
 * ⚠ **A Ukrainian number is refused rather than reinterpreted.** Pinned to US, a
 * pasted `+380 63 882 33 13` would be cut to ten digits and read as a different,
 * valid-looking American number: a silent wrong registration. So a value that
 * parses as Ukrainian (typed in full, pasted, or restored from a session saved
 * before this change) is cleared and the field says why.
 */
export function PhoneField({
  value,
  onChange,
  label,
  hint,
  id = "phone",
}: Props) {
  const country = "US" as const;
  const [refused, setRefused] = useState(false);

  /* A value restored from a session saved before the picker went is cleared
     once, so nobody is left looking at a number they can no longer change. */
  useEffect(() => {
    if (phoneCountryOf(value) === "UA") {
      setRefused(true);
      onChange("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const complete = isPhoneComplete(value, country);
  const started = value.trim().length > 0;

  function change(raw: string) {
    /* Typed digit by digit, the leading + is formatted away, so `380638823313`
       never parses as Ukrainian: it is a real US area code (Ohio) followed by
       two more digits. An eleventh digit after 380 that is not a US country code
       is somebody typing a Ukrainian number, and is refused the same way. */
    const d = digitsOf(raw);
    const looksUkrainian = d.length > 10 && d.startsWith("380");
    if (looksUkrainian || phoneCountryOf(raw) === "UA") {
      setRefused(true);
      onChange("");
      return;
    }
    const next = formatPhone(raw, country);
    /* The notice outlives the keystrokes that follow the refusal — the rest of
       a Ukrainian number typed in a run would otherwise wipe it in a blink —
       and goes once the field is empty or holds a whole US number. */
    if (next === "" || isPhoneComplete(next, country)) setRefused(false);
    onChange(next);
  }

  return (
    <div>
      <label htmlFor={id} className="block text-control font-semibold">
        {label}
      </label>
      {hint && (
        <p id={`${id}-hint`} className="mt-1 text-help leading-snug text-muted">
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
        {/* Text, not a disabled `<select>`: there is nothing to choose, and a
            greyed-out control reads as something that ought to work. It is
            `aria-hidden` because the input's own label and its `+1` placeholder
            already say what number is wanted. */}
        <div className="flex items-center" aria-hidden="true">
          <span className="min-h-[52px] pl-4 pr-3 text-field leading-[52px] text-ink-soft">
            {phoneCountryLabel(country)}
          </span>
          <span className="h-7 w-px self-center bg-bark" />
        </div>

        <div className="relative flex-1">
          <input
            id={id}
            value={value}
            onChange={(e) => change(e.target.value)}
            type="tel"
            inputMode="tel"
            autoComplete="tel-national"
            enterKeyHint="done"
            placeholder={phonePlaceholder(country)}
            /* Both, and the second half is new: the "not a complete number yet"
               line below had no `id`, was linked to nothing and carried no
               role, so no screen reader ever reached it. `aria-invalid` was
               used nowhere in this app at all. */
            aria-invalid={started && !complete ? true : undefined}
            aria-describedby={
              [hint ? `${id}-hint` : null, refused || (started && !complete) ? `${id}-error` : null]
                .filter(Boolean)
                .join(" ") || undefined
            }
            className="min-h-[52px] w-full bg-transparent pl-3.5 pr-11 text-field outline-none placeholder:text-muted/60"
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

      {refused ? (
        <p id={`${id}-error`} role="status" className="mt-1.5 text-help text-gold-ink">
          Pando is only available with a US (+1) mobile number for now.
        </p>
      ) : (
        /* Only once the digits are incomplete — never as they type. */
        started &&
        !complete && (
          <p id={`${id}-error`} className="mt-1.5 text-help text-gold-ink">
            That doesn&apos;t look like a complete US mobile number yet.
          </p>
        )
      )}
    </div>
  );
}

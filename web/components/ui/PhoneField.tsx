"use client";

import { formatUsPhone, isPhoneComplete } from "@/lib/phone";
import { cn } from "@/lib/cn";

interface Props {
  value: string;
  onChange: (formatted: string) => void;
  label: string;
  hint?: string;
  id?: string;
}

export function PhoneField({
  value,
  onChange,
  label,
  hint,
  id = "phone",
}: Props) {
  const complete = isPhoneComplete(value);
  const started = value.trim().length > 0;

  return (
    <div>
      <label htmlFor={id} className="block text-[15px] font-semibold">
        {label}
      </label>
      {hint && <p className="mt-1 text-[14px] leading-snug text-muted">{hint}</p>}
      <div className="relative mt-2.5">
        <span
          aria-hidden="true"
          className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[16px] text-muted"
        >
          +1
        </span>
        <input
          id={id}
          value={value}
          onChange={(e) => onChange(formatUsPhone(e.target.value))}
          type="tel"
          inputMode="tel"
          autoComplete="tel-national"
          enterKeyHint="done"
          placeholder="(626) 555-0143"
          aria-describedby={hint ? `${id}-hint` : undefined}
          className={cn(
            "min-h-[52px] w-full rounded-2xl border bg-card pl-12 pr-11 text-[16px] outline-none",
            "placeholder:text-muted/60",
            started && !complete
              ? "border-gold-line focus:border-gold"
              : "border-bark focus:border-green",
          )}
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
  );
}

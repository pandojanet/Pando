/**
 * Phone handling for the two countries Pando's numbers actually come from.
 * Spec §19: store every number in E.164.
 *
 * ## Why there is no country prop threaded through the app
 *
 * The obvious design is a `country` piece of state next to every `phone` piece of
 * state — and it would have to be threaded through `InviteLanding`, the chat
 * engine, `StepWidget`, `CaregiverFlow`, the autosaved session and back out again
 * on resume, with a stale copy in each. Instead **the formatted value identifies
 * its own country**, because each country's own way of writing a number already
 * does: an American writes `(626) 555-0143` and a Ukrainian writes `067 123 45 67`.
 * Both are ten digits, and no US area code begins with a `0`, so the leading digit
 * settles it with no ambiguity to resolve. Every call site therefore keeps passing
 * one string around and `toE164` keeps needing nothing else.
 *
 * The `hint` argument exists for the one case the value cannot settle: nine digits
 * with no trunk zero, which is a Ukrainian number only if the field says so.
 */

export type PhoneCountry = "US" | "UA";

interface Plan {
  /** Dial code, no plus. */
  dial: string;
  /** Subscriber digits, i.e. what follows the dial code in E.164. */
  length: number;
  /**
   * What the *first subscriber digit* may be. US area codes run 2–9; Ukrainian
   * operator codes 3–9. Neither can be 0, which is what leaves the trunk zero
   * free to tell the two national forms apart.
   */
  start: RegExp;
  /** True when the national form carries a trunk 0 that E.164 drops. */
  trunk: boolean;
  placeholder: string;
  /** On the country control, which is narrow — so the code, not the name. */
  label: string;
  /** Read out for anyone who cannot see the control. */
  name: string;
}

const PLANS: Record<PhoneCountry, Plan> = {
  US: {
    dial: "1",
    length: 10,
    start: /^[2-9]/,
    trunk: false,
    placeholder: "(626) 555-0143",
    label: "+1",
    name: "United States",
  },
  UA: {
    dial: "380",
    length: 9,
    start: /^[3-9]/,
    trunk: true,
    placeholder: "067 123 45 67",
    label: "+380",
    name: "Ukraine",
  },
};

/** Display order in the picker. US first — it is the pilot's market. */
export const PHONE_COUNTRIES: PhoneCountry[] = ["US", "UA"];

export function phoneCountryLabel(country: PhoneCountry): string {
  return PLANS[country].label;
}

export function phoneCountryName(country: PhoneCountry): string {
  return PLANS[country].name;
}

export function phonePlaceholder(country: PhoneCountry): string {
  return PLANS[country].placeholder;
}

export function digitsOf(input: string): string {
  return input.replace(/\D+/g, "");
}

export interface ParsedPhone {
  country: PhoneCountry;
  /** +16265550143 · +380671234567 */
  e164: string;
  /** The subscriber digits, without dial code or trunk zero. */
  subscriber: string;
}

function parsed(country: PhoneCountry, subscriber: string): ParsedPhone {
  return { country, e164: `+${PLANS[country].dial}${subscriber}`, subscriber };
}

/**
 * The one place that decides which country a typed or stored number belongs to.
 * Returns null when it genuinely cannot tell, which is what makes a field
 * incomplete rather than guessing a country on the parent's behalf.
 */
export function parsePhone(input: string, hint?: PhoneCountry): ParsedPhone | null {
  const d = digitsOf(input);
  if (d === "") return null;

  /* Written internationally. The dial code decides, and the two totals cannot
     collide: a US number is 11 digits with the code, a Ukrainian one 12. Both
     have to be length-checked and not merely prefix-checked, because `380` is
     also a real US area code (Ohio) — a ten-digit `380…` is American. */
  for (const country of ["UA", "US"] as const) {
    const plan = PLANS[country];
    if (
      d.length === plan.dial.length + plan.length &&
      d.startsWith(plan.dial) &&
      plan.start.test(d.slice(plan.dial.length))
    ) {
      return parsed(country, d.slice(plan.dial.length));
    }
  }

  /* Written nationally, as either parent would write it at home. Ten digits
     either way, and the leading digit separates them: Ukraine's trunk 0, which
     no US area code can start with. */
  if (
    d.length === PLANS.UA.length + 1 &&
    d.startsWith("0") &&
    PLANS.UA.start.test(d.slice(1))
  ) {
    return parsed("UA", d.slice(1));
  }
  if (d.length === PLANS.US.length && PLANS.US.start.test(d)) {
    return parsed("US", d);
  }

  /* Nine digits with the trunk zero left off. Only the field knows this is
     Ukrainian, so this is the one branch that needs telling. */
  if (hint === "UA" && d.length === PLANS.UA.length && PLANS.UA.start.test(d)) {
    return parsed("UA", d);
  }

  return null;
}

/** Which country a value belongs to, or null while it is still ambiguous. */
export function phoneCountryOf(input: string): PhoneCountry | null {
  return parsePhone(input)?.country ?? null;
}

function group(country: PhoneCountry, subscriber: string): string {
  if (subscriber === "") return "";
  if (country === "UA") {
    /* 0XX XXX XX XX — the trunk zero is kept in the display because it is how a
       Ukrainian number is written, and because it is what lets the value
       identify itself later without a country alongside it. */
    return [
      "0" + subscriber.slice(0, 2),
      subscriber.slice(2, 5),
      subscriber.slice(5, 7),
      subscriber.slice(7, 9),
    ]
      .filter((part) => part !== "")
      .join(" ");
  }
  if (subscriber.length <= 3) return subscriber;
  if (subscriber.length <= 6) return `(${subscriber.slice(0, 3)}) ${subscriber.slice(3)}`;
  return `(${subscriber.slice(0, 3)}) ${subscriber.slice(3, 6)}-${subscriber.slice(6)}`;
}

/**
 * Formats as the parent types — no reformat surprises mid-entry. `country` is the
 * field's own picker; without it the value is read for what it already is.
 */
export function formatPhone(input: string, country?: PhoneCountry): string {
  const which = country ?? phoneCountryOf(input) ?? "US";
  const plan = PLANS[which];
  let d = digitsOf(input);

  /* Pasted or resumed in international form — drop the dial code. Length-guarded
     so a national number that happens to begin with the dial code survives. */
  if (d.startsWith(plan.dial) && d.length > plan.length) {
    d = d.slice(plan.dial.length);
  }
  if (plan.trunk && d.startsWith("0")) {
    d = d.slice(1);
    /* They have typed the trunk zero and nothing else. Stripping it and
       rendering the empty string would take the keystroke back off the screen,
       so the first digit of a Ukrainian number would appear to do nothing. */
    if (d === "") return "0";
  }

  return group(which, d.slice(0, plan.length));
}

/** Returns E.164, or null when it isn't a number either country recognises. */
export function toE164(input: string, hint?: PhoneCountry): string | null {
  return parsePhone(input, hint)?.e164 ?? null;
}

export function isPhoneComplete(input: string, hint?: PhoneCountry): boolean {
  return parsePhone(input, hint) !== null;
}

/** For display back to the parent without echoing the whole number. */
export function maskPhone(e164: string): string {
  const d = digitsOf(e164);
  return d.length >= 4 ? `••• ••• ${d.slice(-4)}` : "•••";
}

/**
 * Enough to recognise your own number, not enough to publish: the area or
 * operator code, then the last four. `(626) •••‑0143` · `067 •••‑4567`.
 */
export function maskPhoneRecognisable(e164: string): string {
  const p = parsePhone(e164);
  if (!p) return maskPhone(e164);
  if (p.country === "UA") {
    return `0${p.subscriber.slice(0, 2)} •••‑${p.subscriber.slice(-4)}`;
  }
  return `(${p.subscriber.slice(0, 3)}) •••‑${p.subscriber.slice(-4)}`;
}

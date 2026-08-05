/**
 * US phone handling. Spec §19: store every number in E.164.
 * Phase 1 only captures the number; verification arrives with the OTP work
 * in Phase 2 (estimate 5.1), so this is deliberately forgiving.
 */

export function digitsOf(input: string): string {
  return input.replace(/\D+/g, "");
}

/** "(626) 555-0143" as the parent types — no reformat surprises mid-entry. */
export function formatUsPhone(input: string): string {
  let d = digitsOf(input);
  if (d.startsWith("1")) d = d.slice(1);
  d = d.slice(0, 10);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

/** Returns E.164 (+16265550143) or null when it isn't a plausible US number. */
export function toE164(input: string): string | null {
  const d = digitsOf(input);
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith("1")) return `+${d}`;
  return null;
}

export function isPhoneComplete(input: string): boolean {
  return toE164(input) !== null;
}

/** For display back to the parent without echoing the whole number. */
export function maskPhone(e164: string): string {
  const d = digitsOf(e164);
  return d.length >= 4 ? `••• ••• ${d.slice(-4)}` : "•••";
}

/**
 * A tool's answer that an outside service did not answer — GitHub for the plugin's repo — as opposed to a
 * refusal by Pando's own rules (24 Nov). Both reach Claude as one sentence, so the tool wrapper could not
 * tell them apart and logged GitHub being down as "Refused by Pando's rules". A text made here is
 * remembered (a handful of fixed sentences), and the wrapper logs it as a failure for `outside_service`.
 */
const TEXTS = new Set<string>();

export function unavailable(text: string): string {
  TEXTS.add(text);
  return text;
}

export const isUnavailable = (value: unknown): boolean => typeof value === "string" && TEXTS.has(value);

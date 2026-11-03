/**
 * A phone number or an email typed into free text (28 Oct audit).
 *
 * Invariant 13: no contact details for a nominated caregiver are ever
 * collected or stored. The named fields were refused long ago
 * (`RESERVED_FIELDS`), but a number typed into prose was not: "Text her at
 * 626-555-7690" was stored from the SMS capture as a share's name and its
 * parent's words, and from the web caregiver card as the public "up front"
 * note. Text that may describe a person is masked before it is written
 * anywhere, the raw copies included.
 *
 * Pure, so the gate's suites can run it.
 */

/** Digits with the usual separators; a match is a number only with ten or more digits. */
const PHONE = /\+?\(?\d[\d\s().-]{8,}\d/g;
const EMAIL = /[^\s@,;:()<>"']+@[^\s@,;:()<>"']+\.[A-Za-z]{2,}/g;
const isNumber = (m: string) => (m.match(/\d/g) ?? []).length >= 10;

export function hasContactDetail(text: string): boolean {
  return (text.match(PHONE) ?? []).some(isNumber) || (text.match(EMAIL) ?? []).length > 0;
}

export function maskContactDetails(text: string): string {
  return text.replace(PHONE, (m) => (isNumber(m) ? "[number]" : m)).replace(EMAIL, "[email]");
}

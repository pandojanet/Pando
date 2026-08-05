/**
 * Consent copy, versioned.
 *
 * Every point where Pando takes a phone number or permission to message someone
 * has to store *what the person actually agreed to*: status, source, timestamp
 * and the version of the text they saw (spec v3.2 SMS-compliance layer — consent
 * capture applies to the Seed Tool too, not only Phase 2 signup).
 *
 * Rules encoded here:
 *  - the wording covers future SMS outreach explicitly, because the opt-in is
 *    taken on the web months before the SMS channel goes live (TCPA);
 *  - the three permissions are separate and stay separate — a follow-up about
 *    your own recommendation is not a Blast from a stranger, and neither is
 *    agreeing to be a reference;
 *  - bump CONSENT_TEXT_VERSION whenever a word of it changes, and never edit an
 *    old version in place: stored records must stay resolvable to real text.
 */

export const CONSENT_TEXT_VERSION = "seed-followup-2026-07-31";

/** Shown next to the follow-up toggle on the completion screen. */
export const FOLLOW_UP_CONSENT_TEXT =
  "Yes — Pando may text me at this number about what I shared: to check a recommendation is still current, or to ask a question my experience can answer. At most a few times a month, never a marketing message. Reply STOP to end, HELP for help. Msg & data rates may apply.";

/**
 * SMS consent at the phone field — the client's registered wording, verbatim.
 *
 * Two rules that come with it and are not ours to soften:
 *  - its own checkbox, unchecked by default, never bundled with anything else;
 *  - it is what authorises the very first verification text, so no consent means
 *    no code is sent and nothing is submitted.
 *
 * Bump the version if a single word changes, and never edit an old version in
 * place: stored records must stay resolvable to the text that was actually shown.
 */
export const SMS_CONSENT_TEXT_VERSION = "seed-sms-2026-08-01";

export const SMS_CONSENT_TEXT =
  "I agree to receive text messages from Pando Systems, Inc. at the number provided — including answers to my questions, occasional requests from the parent network, and account notifications. Message frequency varies. Message & data rates may apply. Reply STOP to opt out, HELP for help.";

/**
 * The same registered wording, split for display only — and **derived** from it, so
 * the two halves cannot drift from the text that was registered with the carriers.
 *
 * `SMS_CONSENT_AGREEMENT` is what the `<label>` covers: the sentence the parent is
 * agreeing to. `SMS_CONSENT_TERMS` is the carrier disclosure that follows, shown
 * immediately beside the checkbox and tied to it with `aria-describedby`.
 *
 * Why split at all: a tap anywhere inside a label toggles its checkbox, so a label
 * holding the whole paragraph turned ~230px of legal copy into an opt-in control. An
 * accidental opt-in is the worst failure this control has.
 */
const CONSENT_SPLIT_AT = "Message frequency varies.";
const CONSENT_SPLIT_INDEX = SMS_CONSENT_TEXT.indexOf(CONSENT_SPLIT_AT);

export const SMS_CONSENT_AGREEMENT = SMS_CONSENT_TEXT.slice(
  0,
  CONSENT_SPLIT_INDEX,
).trim();

export const SMS_CONSENT_TERMS = SMS_CONSENT_TEXT.slice(CONSENT_SPLIT_INDEX);

/** Reassurance above the checkbox — not a substitute for it. */
export const SMS_CONSENT_REASSURANCE =
  "We won't text you anything you didn't ask for.";

/** The three permissions, kept distinct on purpose. */
export type ConsentScope =
  /** The registered SMS consent taken at the phone field. */
  | "sms"
  /** Pando may message me about my own contributions and occasional questions. */
  | "follow_up"
  /** Pando may include me in paid Blasts from other parents (Phase 2). */
  | "blast"
  /** Pando may introduce me to a parent asking about someone I nominated. */
  | "reference";

export interface ConsentRecord {
  scope: ConsentScope;
  status: "opted_in" | "declined";
  /** Where it was taken, for the audit trail. */
  source: string;
  text_version: string;
  captured_at: string;
}

export function buildConsentRecord(
  scope: ConsentScope,
  optedIn: boolean,
  source: string,
): ConsentRecord {
  return {
    scope,
    status: optedIn ? "opted_in" : "declined",
    source,
    text_version:
      scope === "sms" ? SMS_CONSENT_TEXT_VERSION : CONSENT_TEXT_VERSION,
    captured_at: new Date().toISOString(),
  };
}

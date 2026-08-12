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
 * SMS consent at the phone field.
 *
 * ⚠️ **This is not word for word the text in the client's documents, and that is
 * a decision (12 Aug), not an oversight.** "Pando — QC Answers + A2P Prep"
 * (Part 2, §3.3) and spec v3.2 §19.1 both quote the shorter *"By providing your
 * number you agree to receive text messages from Pando. Message frequency varies.
 * Msg & data rates may apply. Reply STOP to cancel, HELP for help."* The wording
 * below came from the client's own dictation on the kickoff call and says more —
 * it names the legal entity and the kinds of message, which is what carriers
 * actually want to see.
 *
 * **The string below is the one to register.** §3.7 warns that a mismatch between
 * the registered opt-in flow and the built one is a common cause of campaign
 * suspension, so this exact text — not the documents' shorter one — has to go into
 * the A2P campaign's opt-in description. Replacing it here to "match the spec"
 * would create the mismatch it looks like it is fixing.
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

/**
 * 2C — the caregiver's own permissions (G2, G8–G10).
 *
 * Four decisions, asked and stored separately, because they are four different
 * amounts of exposure and none of them implies the next: existing at all, being
 * named in an answer, being introduced to a family, and being willing to have a
 * former family vouch for you. A single "make me visible" switch would collapse
 * them, and the ladder in `caregivers` only means something if each rung was
 * agreed to on its own.
 *
 * Same rule as above: bump the version, never edit the text.
 */
export const CAREGIVER_CONSENT_TEXT_VERSION = "caregiver-2026-08-10";

export const CAREGIVER_CONSENT_TEXT = {
  /** G2 — the price of entry, and it buys nothing visible on its own. */
  profile:
    "Yes — Pando may keep this profile. It stays private until I say otherwise, and I can delete it at any time by texting DELETE.",
  /** G9 — being named in an answer to a parent who asked. */
  listing:
    "Families near me may see my first name, what I'm good with, my areas and my rate range when they ask Pando about care. Never my number.",
  /** G10 — a family being put in touch. Strictly more than being named. */
  introduction:
    "If a family wants to reach me, Pando may pass on my contact details — but only after asking me first, every time.",
  /** G8 — a former family speaking for you. Their consent is separate and theirs. */
  reference:
    "A family I've worked for may be asked to be a reference for me. Pando asks them, not me, and they can always say no.",
} as const;

/** The permissions, kept distinct on purpose. */
export type ConsentScope =
  /** The registered SMS consent taken at the phone field. */
  | "sms"
  /** Pando may message me about my own contributions and occasional questions. */
  | "follow_up"
  /** Pando may include me in paid Blasts from other parents (Phase 2). */
  | "blast"
  /** Pando may introduce me to a parent asking about someone I nominated. */
  | "reference"
  /** 2C · G2 — the caregiver agrees Pando may hold their profile at all. */
  | "caregiver_profile"
  /** 2C · G9 — the caregiver may be named in an answer. */
  | "caregiver_listing"
  /** 2C · G10 — the caregiver may be introduced to a family. */
  | "caregiver_introduction"
  /** 2C · G8 — the caregiver is open to a former family being a reference. */
  | "caregiver_reference";

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
      scope === "sms"
        ? SMS_CONSENT_TEXT_VERSION
        : scope.startsWith("caregiver_")
          ? CAREGIVER_CONSENT_TEXT_VERSION
          : CONSENT_TEXT_VERSION,
    captured_at: new Date().toISOString(),
  };
}

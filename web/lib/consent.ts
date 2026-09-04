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
 * The listening-ear opt-in (18 Aug strategy addition). Its own version because
 * its own wording — this is a willingness to be matched to a stranger's hard
 * question, which is a different amount of exposure than agreeing to hear
 * about your own contributions (`follow_up`), and the two must never be able
 * to drift onto the same version string.
 */
export const LISTENING_EAR_CONSENT_TEXT_VERSION = "seed-listening-ear-2026-08-18";

export const LISTENING_EAR_CONSENT_TEXT =
  "Yes — Pando may occasionally match me to another parent's hard question, anonymously on both sides. It spends the same monthly allowance as everything else, and I can say no to any single one.";

/**
 * Per-affiliation sharing — the client's Privacy Guidance §A (24 Aug).
 *
 * This is the wording she supplied, and both halves of it are load-bearing:
 *
 *  - the control says what Pando *may* do and states plainly that the name and
 *    contact details are not shown;
 *  - the line under it admits what the control cannot promise — in a small
 *    community, members may work out who you are. Her own text, and it is the
 *    sentence that makes this consent informed rather than merely obtained.
 *
 * **Its own version string, never shared with another scope.** A parent agreeing
 * that "a parent at your golf club" may be said about them has agreed to one
 * thing; the follow-up consent, the Blast consent and the listening ear are
 * different amounts of exposure and different decisions. Sharing a version would
 * make it impossible to answer "which words did they see" for either.
 *
 * §A's other three rules are enforced in code rather than in this text, and are
 * repeated here because they are what the wording assumes: a new affiliation
 * defaults to `private`; reading the privacy explainer changes nothing; and
 * **"Continue" is not consent** — only the toggle is.
 */
export const AFFILIATION_CONSENT_TEXT_VERSION = "seed-affiliation-2026-08-24";

export const AFFILIATION_CONSENT_TEXT =
  "Pando may tell another parent with this same connection that a parent from the community made a recommendation. Your name and contact information will not be shown.";

/** Shown immediately underneath, in her words. Never as a tooltip. */
export const AFFILIATION_CONSENT_CAVEAT =
  "Members may sometimes be able to guess who you are, particularly in a small community.";

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

/**
 * 5.9 — consent given by texting first, where no wording was shown at all.
 *
 * A cold inbound parent never saw `SMS_CONSENT_TEXT`: they were forwarded an
 * answer and texted the number. 5.9 says "their first text counts as their opt-in
 * and is recorded as such", and **as such** is the operative phrase — recording
 * it under the seed wording's version would claim they read a paragraph they were
 * never shown, on the one record a TCPA complaint actually tests.
 *
 * So it has its own version, which says what happened rather than which text was
 * displayed. The defence for this consent is the inbound message itself, and the
 * `message_log` row that carries it.
 */
export const INBOUND_CONSENT_VERSION = "inbound-text-2026-08";

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
 * The recurring-messaging opt-in on the participation screen (2 Sep, client).
 *
 * ## Why a second SMS-shaped consent exists
 *
 * `SMS_CONSENT_TEXT` is taken at the phone field and authorises Pando to text
 * the number at all — it is what sends the verification code. This one is taken
 * at the moment the parent *chooses how often they may be asked*, and that is
 * what it covers: it names **recurring automated messages**, says **SMS and
 * RCS** explicitly, and ties the volume to the level just picked ("up to the
 * number of relevant community questions you select"). RCS is the reason it was
 * asked for — it is a different channel from SMS, and the carriers want it
 * named.
 *
 * Its own version string, never shared with `sms`: the two are different
 * permissions taken at different moments, and a stored record has to resolve to
 * the words that were actually on screen.
 *
 * **The client's wording, verbatim.** The trailing "Terms · Privacy" of her copy
 * is deliberately *not* in this string — those are links, not language, so they
 * are rendered beside it and can never end up inside a stored consent text.
 *
 * ⚠️ Her sentence says "tapping **Continue**", and on that screen the dock
 * button reads **Review**, because it is the last question before the review
 * step. The text is registered copy and the button is a flow control, so
 * neither was changed unilaterally — put it to her.
 */
export const RECURRING_MESSAGES_CONSENT_TEXT_VERSION = "seed-recurring-2026-09-02";

export const RECURRING_MESSAGES_CONSENT_TEXT =
  "By selecting a participation level and tapping Continue, you agree to receive recurring automated text messages (SMS and RCS) from Pando. These include answers you request and up to the number of relevant community questions you select. Message frequency varies. Message and data rates may apply. Reply STOP to opt out or HELP for help.";

/**
 * Split for display only, and **derived** from the string above so the halves
 * cannot drift from the text that gets registered — the same rule, and the same
 * reason, as `SMS_CONSENT_AGREEMENT`: a `<label>` wrapping the whole paragraph
 * turns a screenful of legal copy into an opt-in control, and an accidental
 * opt-in is the worst failure a consent checkbox can have.
 */
const RECURRING_SPLIT_AT = "Message frequency varies.";
const RECURRING_SPLIT_INDEX =
  RECURRING_MESSAGES_CONSENT_TEXT.indexOf(RECURRING_SPLIT_AT);

export const RECURRING_MESSAGES_CONSENT_AGREEMENT =
  RECURRING_MESSAGES_CONSENT_TEXT.slice(0, RECURRING_SPLIT_INDEX).trim();

export const RECURRING_MESSAGES_CONSENT_TERMS =
  RECURRING_MESSAGES_CONSENT_TEXT.slice(RECURRING_SPLIT_INDEX);

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

/**
 * 11.3 — the word that honours the sentence above.
 *
 * `CAREGIVER_CONSENT_TEXT.profile` promises "I can delete it at any time by
 * texting DELETE", and the 2C flow's last screen says "Text DELETE and the whole
 * profile goes, without asking why". Those are the only two places the promise
 * is made, and the keyword lives here beside one of them so the two cannot
 * drift — the same argument that keeps `isSettingsCommand` in
 * `outreach-policy.ts` next to the numbers it quotes.
 *
 * **Exact on the whole message**, the rule every parser in this app follows
 * (`keywordOf`, `yesOrNo`, `readPingReply`) and here for the sharpest version of
 * the reason: this one is *irreversible*. "delete my saturday slot" must not
 * remove somebody's profile, and a substring test would.
 *
 * **And it acts immediately, with no "are you sure?".** That is what the copy
 * promises — "at any time by texting DELETE" describes one message, not two —
 * and a confirmation step would make the sentence false on the one screen where
 * a caregiver is deciding whether to trust Pando at all. The exact-match rule is
 * what makes immediacy safe: DELETE is not a word anybody texts by accident.
 */
const CAREGIVER_DELETE_KEYWORDS = ["DELETE", "REMOVE ME", "DELETE MY PROFILE"];

export function isCaregiverDeleteRequest(body: string): boolean {
  const word = body.trim().toUpperCase().replace(/[.!]+$/, "");
  return CAREGIVER_DELETE_KEYWORDS.includes(word);
}

/** The permissions, kept distinct on purpose. */
export type ConsentScope =
  /** The registered SMS consent taken at the phone field. */
  | "sms"
  /** Recurring automated SMS **and RCS**, agreed with the participation level. */
  | "sms_recurring"
  /** Pando may message me about my own contributions and occasional questions. */
  | "follow_up"
  /** Pando may include me in paid Blasts from other parents (Phase 2). */
  | "blast"
  /** Willing to be matched to a stranger's sensitive question, anonymously. */
  | "listening_ear"
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
        : scope === "sms_recurring"
          ? RECURRING_MESSAGES_CONSENT_TEXT_VERSION
        : scope === "listening_ear"
          ? LISTENING_EAR_CONSENT_TEXT_VERSION
          : scope.startsWith("caregiver_")
            ? CAREGIVER_CONSENT_TEXT_VERSION
            : CONSENT_TEXT_VERSION,
    captured_at: new Date().toISOString(),
  };
}

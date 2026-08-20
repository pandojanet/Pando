/**
 * Plain English for everything the admin displays that is stored as an id.
 *
 * The rule this file exists to enforce: **an admin never reads a database
 * value.** `possible_named_person`, `share_contribution`, `pending_review` and
 * `stale_at_capture` are all correct names for what they are and all wrong on a
 * screen — Janet is not reading a schema, she is deciding what to do about a
 * parent's recommendation.
 *
 * Keep the wording here rather than inline in a page, for the same reason
 * `lib/consent.ts` holds consent copy: the same value shows up on more than one
 * surface, and two surfaces calling one thing by two names is worse than either
 * name on its own.
 */

/** What a flag is, said as a person would say it. */
const FLAG_REASONS: Record<string, { title: string; meaning: string }> = {
  possible_named_person: {
    title: "Someone is named",
    meaning:
      "A person is named or clearly identifiable in what this parent wrote. Read it before it is used anywhere — that is the only reason it is here, and it does not mean the note is bad.",
  },
  named_allegation: {
    title: "A claim about someone",
    meaning:
      "A parent said something negative about a named person. Read it, and nothing else — this is never quoted in an answer, never circulated, and never added to what Pando knows.",
  },
  high_stakes_demand: {
    title: "Health, legal or safety question",
    meaning:
      "The parent was shown professional resources straight away. This is here so somebody follows up properly — Pando does not answer these itself.",
  },
  low_confidence: {
    title: "Not much to go on",
    meaning:
      "Another parent probably could not act on what was written. Worth a read: sometimes it is a good recommendation that just needs one more detail.",
  },
  stale_at_capture: {
    title: "Already out of date",
    meaning:
      "The parent said themselves it was over a year ago. Still usable, but it should be labelled as old — prices and teachers change.",
  },
  possible_duplicate_share: {
    title: "Might be a duplicate",
    meaning:
      "This looks like somewhere Pando already knows about under a slightly different name. Worth checking before it becomes a second entry.",
  },
};

export function flagTitle(reason: string): string {
  return FLAG_REASONS[reason]?.title ?? sentence(reason);
}

export function flagMeaning(reason: string): string | null {
  return FLAG_REASONS[reason]?.meaning ?? null;
}

/** How urgent, in words rather than a severity enum. */
export const SEVERITY_LABEL: Record<string, string> = {
  escalation: "Needs a person today",
  review: "Worth a read",
  note: "Just so you know",
};

/** What a flag or a record is *about*. */
export const SUBJECT_LABEL: Record<string, string> = {
  share_contribution: "a recommendation",
  place_contribution: "a recommendation",
  share: "a place or class",
  place: "a place or class",
  demand_signal: "a question a parent asked",
  caregiver_nomination: "a caregiver someone put forward",
  caregiver: "a caregiver",
};

/**
 * Which field was involved. Only the ones that ever reach a screen — anything
 * else falls back to a readable version of the column name rather than nothing,
 * because "we can't name it" is worse than an imperfect name.
 */
export const FIELD_LABEL: Record<string, string> = {
  last_there: "when they last went",
  what_makes_it_great: "what they liked",
  caveat: "what to know first",
  who_for: "who it suits",
  who_not_for: "who it would not suit",
  tip_text: "their tip",
  price_band: "what they paid",
};

/** The review state of a recommendation, as a person would describe it. */
export const REVIEW_STATUS: Record<
  string,
  { label: string; tone: "green" | "gold" | "red" | "neutral"; meaning: string }
> = {
  pending_review: {
    label: "Waiting for you",
    tone: "gold",
    meaning: "Nobody has looked at this yet.",
  },
  needs_detail: {
    label: "Held for a detail",
    tone: "gold",
    meaning:
      "You asked for something extra. It stays in your queue — there is no way to text the parent yet, so this is a note to yourself.",
  },
  approved: {
    label: "Added to Pando",
    tone: "green",
    meaning: "This can be used in an answer to a parent.",
  },
  rejected: {
    label: "Not used",
    tone: "neutral",
    meaning: "Set aside. Nothing was sent to the parent.",
  },
};

/**
 * The tap-list categories. `baby_activities` is the one that really needs this —
 * it holds classes for every age despite the name, so slugging it produced "Baby
 * Activities" next to a robotics club for a fourteen-year-old.
 */
export const CATEGORY_LABEL: Record<string, string> = {
  neighborhoods: "Neighborhoods",
  schools: "Schools & preschools",
  worship: "Faith communities",
  clubs: "Clubs & leagues",
  parent_groups: "Parent groups",
  baby_activities: "Classes & activities",
  camps: "Camps",
  focus: "Topics",
};

/**
 * Why a caregiver nomination is being held. These are the stored reasons, and
 * each one is a sentence rather than a label because an admin about to release a
 * hold is deciding whether that reason still stands.
 */
export const HOLD_REASON: Record<string, string> = {
  hire_again_hesitant: "the family hesitated about using her again",
  hire_again_no: "the family would not use her again",
  private_note: "the family left a private note",
  under_18: "she may be under 18",
  duplicate_candidate: "she may already be here under another name",
};

/** Where a caregiver is on the consent ladder. */
export const CONSENT_STATE: Record<string, { label: string; meaning: string }> = {
  mentioned: {
    label: "Put forward by a family",
    meaning: "She does not know she is here. Nothing is visible to anyone.",
  },
  invited: {
    label: "Family sent the invite",
    meaning: "Waiting for her to say yes herself. Still invisible.",
  },
  consented: {
    label: "She said yes",
    meaning: "She agreed to be here. Whether families can see her is separate.",
  },
  declined: { label: "She said no", meaning: "She will never appear anywhere." },
  revoked: {
    label: "She changed her mind",
    meaning: "She withdrew. Everything about her is hidden again.",
  },
};

/**
 * Would you recommend it (R10). Stored as `yes` / `yes_with_caveats` /
 * `probably_not` / `no` — four words that mean four different amounts of
 * enthusiasm and read as almost the same thing when title-cased.
 */
export const RECOMMENDATION: Record<
  string,
  { label: string; tone: "green" | "gold" | "red" | "neutral" }
> = {
  yes: { label: "Would recommend", tone: "green" },
  yes_with_caveats: { label: "Yes, with a caveat", tone: "gold" },
  probably_not: { label: "Probably not", tone: "neutral" },
  no: { label: "Would not recommend", tone: "red" },
};

/**
 * How old the information is. The stored words are about the *record*; an admin
 * is asking "can I still put this in front of a parent", so the labels answer
 * that instead.
 */
export const FRESHNESS: Record<
  string,
  { label: string; tone: "green" | "gold" | "red" | "neutral"; meaning: string }
> = {
  fresh: {
    label: "Recent",
    tone: "green",
    meaning: "Somebody was there recently enough to be worth repeating.",
  },
  ageing: {
    label: "Getting old",
    tone: "gold",
    meaning: "Still usable, but worth a fresh voice on it before long.",
  },
  stale: {
    label: "Out of date",
    tone: "neutral",
    meaning: "Old enough that prices and staff have probably changed. Label it as old if it is used at all.",
  },
};

/**
 * D1 routing — what kind of question a parent asked, and therefore what Pando
 * already said back to them. The stored ids are the most jargon-heavy thing in
 * the admin, and this is the one column where the *consequence* matters more
 * than the name, so each carries what happened and what may happen next.
 */
export const DEMAND_SENSITIVITY: Record<
  string,
  {
    label: string;
    tone: "green" | "gold" | "red" | "neutral";
    /** What the parent saw. */
    said: string;
    /** What you may do with it. */
    allowed: string;
  }
> = {
  ordinary: {
    label: "An ordinary question",
    tone: "neutral",
    said: "Nothing special — it is a normal local question.",
    allowed: "Use it freely.",
  },
  peer_support: {
    label: "Wanted to feel less alone",
    tone: "gold",
    said: "Pando answered warmly, in the flow, straight away.",
    allowed: "Only stored because this parent said it was alright to keep.",
  },
  /**
   * Not "Health, legal or safety" — that is the name of the *category* a parent
   * taps, and the two columns sit side by side, so the same words in both said
   * nothing about what makes this row different. This label answers the
   * question the column is for: what did Pando do about it.
   */
  high_stakes: {
    label: "Needs a professional",
    tone: "red",
    said: "Professional resources were shown immediately — Pando does not answer these itself.",
    allowed: "Read it, and follow up properly if it needs it.",
  },
  named_allegation: {
    label: "A claim about someone",
    tone: "red",
    said: "Nothing. No resources, no reassurance — any reply reads as agreement before a person has looked.",
    allowed: "Read it and nothing else. Never quoted, never circulated, never part of what Pando knows.",
  },
};

/** Where a question has got to. Yours to track — nothing is sent to the parent. */
export const DEMAND_STATUS: Record<
  string,
  { label: string; tone: "green" | "gold" | "neutral" }
> = {
  open: { label: "Not looked at", tone: "gold" },
  matched: { label: "Found someone who could answer", tone: "neutral" },
  answered: { label: "Answered", tone: "green" },
  closed: { label: "Closed", tone: "neutral" },
};

/** The D1 categories a parent taps. Stored ids; these are the words they read. */
export const DEMAND_CATEGORY: Record<string, string> = {
  activities: "Classes & activities",
  camps: "Camps",
  preschools_schools: "Schools & preschools",
  nannies: "Nannies",
  babysitters: "Babysitters",
  childcare: "Childcare",
  working_parent_logistics: "Juggling work and childcare",
  returning_to_work: "Going back to work",
  the_emotional_side: "The emotional side",
  pediatric_health: "Children's health",
  health_legal_safety: "Health, legal or safety",
};

/** Would the *parent* act as a reference (R/C: the parent's own willingness). */
export const REFERENCE_WILLING: Record<string, string> = {
  yes: "Happy to be a reference",
  maybe: "Asks to be checked with first",
  no: "Would rather not",
};

/** What an audit row is about. The table names, said as things. */
export const AUDIT_RESOURCE: Record<string, string> = {
  person: "a contributor",
  share: "a place or class",
  place: "a place or class",
  share_contribution: "a recommendation",
  place_contribution: "a recommendation",
  caregiver: "a caregiver",
  caregiver_nomination: "a caregiver someone put forward",
  caregiver_claim: "a caregiver's own sign-up",
  restricted_note: "a private note",
  demand_signal: "a question a parent asked",
  flag: "a flag",
  invite: "an invite link",
  market_option: "a tap-list option",
  consents: "the consent file",
  admin_user: "who can sign in",
  referral: "a referral",
};

/**
 * What an admin actually did, for the audit log.
 *
 * Every one of these is an action name from `admin-write.ts`, and on that page
 * they were printed verbatim — `nomination.release_hold` in a badge. The audit
 * log is the one surface whose entire job is to be readable months later by
 * somebody reconstructing a decision, so it is the worst place for a dotted
 * identifier. Past tense throughout: this is a record of what happened, not a
 * button.
 */
export const AUDIT_ACTION: Record<string, string> = {
  "contribution.approve": "Added a recommendation to Pando",
  "contribution.reject": "Set a recommendation aside",
  "contribution.needs_detail": "Asked the parent for one more detail",
  "contribution.edit": "Corrected a field on a recommendation",
  "share.answer_ready": "Marked a record good enough to answer with",
  "caregiver.consent": "Recorded a caregiver's answer about being listed",
  "caregiver.visibility": "Changed who can see a caregiver",
  "caregiver.merge": "Merged two records for the same caregiver",
  "nomination.approve": "Accepted a caregiver a family put forward",
  "nomination.reject": "Declined a caregiver a family put forward",
  "nomination.hold": "Held a caregiver for review",
  "nomination.release_hold": "Released a caregiver from hold",
  "claim.link": "Matched a caregiver's own sign-up to a family's nomination",
  "claim.decline": "Declined a caregiver's own sign-up",
  "claim.delete": "Deleted a caregiver's profile at their request",
  "founding.approve": "Confirmed a founding parent",
  "founding.request_invite": "Marked a parent as not from the group",
  "contributor.note": "Left a note on a contributor",
  "referral.link": "Credited a referral",
  "referral.void": "Removed a referral",
  "demand.status": "Moved a parent's question along",
  "demand.mark_reviewed": "Marked a parent's question as read",
  "flag.resolve": "Read a flag and cleared it",
  "flag.escalate": "Raised a flag as needing attention today",
  "invite.create": "Made an invite link",
  "invite.retire": "Stopped sharing an invite link",
  "invite.restore": "Started sharing an invite link again",
  "option.promote": "Added a parent's own answer to the tap lists",
  "option.reject": "Declined a parent's own answer",
  "option.retire": "Retired a tap-list option",
  /**
   * Not a write. `/api/admin/query` logs this for the two reads that are events
   * in themselves: opening a restricted note, and exporting the consent file.
   *
   * It must stay generic. Labelling it "Downloaded the consent file" was wrong
   * on sight the first time the log was read for real — the same action, on a
   * private note, then claimed a consent export had happened. **What** was read
   * is the next column's job; this one only says that it was.
   */
  read: "Opened and read it",
};

/**
 * The `before`/`after` keys in an audit row, where they are worth naming. Most
 * fall through to `sentence()`, which turns `review_status` into "Review status"
 * and is good enough; these are the ones where it isn't.
 */
export const AUDIT_FIELD: Record<string, string> = {
  option_value: "Stored as",
  consent_status: "Consent",
  review_status: "Review",
  founding: "Founding",
  answer_ready: "Good enough to answer with",
  needs_detail_note: "Question asked",
  requires_human_review: "Needs a person",
  weak_starter_password: "Starter password still in place",
};

/**
 * A readable fallback for an id nothing above names.
 *
 * Deliberately not `slugLabel`, which title-cases every word and produces
 * "Possible Named Person" — a phrase no person would say out loud. One capital,
 * spaces for underscores.
 */
export function sentence(value: string): string {
  const words = value.replace(/[-_]/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

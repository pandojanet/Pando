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

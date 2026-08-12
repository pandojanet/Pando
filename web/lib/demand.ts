/**
 * D1 routing — what Pando does with the question a parent asks at the end.
 *
 * The client's question set splits the closing question four ways, and the split
 * matters more than the storage: "you'll hear at launch" is the right answer to
 * *"which camp?"* and the wrong answer to *"is this normal, and who do I call?"*.
 *
 * The routing is driven by the category the parent taps, not by guessing at their
 * words. A keyword scan decides one thing only — whether to *escalate* a question
 * the parent filed as ordinary — because a false positive there costs a gentler
 * screen, and a false negative costs the thing that matters.
 */

export type DemandSensitivity =
  /** Which camp, which preschool, where to go on a rainy Saturday. */
  | "ordinary"
  /** Peer support: answered in-flow, then saved only with permission. */
  | "peer_support"
  /** Health, legal, safety: professional resources in-flow, plus an admin flag. */
  | "high_stakes"
  /**
   * A negative claim about a named nanny, doctor, teacher or parent. The Product
   * Strategy gives it its own row in the safety table and its own answer: "human
   * review only; never broadly circulated or automatically written into the
   * knowledge base."
   *
   * Its own class rather than a flavour of `high_stakes`, because the two are owed
   * different things. A safety question is owed professional resources now; an
   * allegation is owed *silence* until a person has read it — no in-flow resource
   * list, no reassurance that reads as agreement, and nothing that could be
   * mistaken for Pando repeating the claim back.
   */
  | "named_allegation";

export interface DemandCategory {
  id: string;
  label: string;
  sensitivity: DemandSensitivity;
}

export const DEMAND_CATEGORIES: DemandCategory[] = [
  { id: "activities", label: "Activities", sensitivity: "ordinary" },
  { id: "classes", label: "Classes", sensitivity: "ordinary" },
  { id: "camps", label: "Camps", sensitivity: "ordinary" },
  { id: "childcare", label: "Childcare", sensitivity: "ordinary" },
  { id: "schools", label: "Schools", sensitivity: "ordinary" },
  { id: "places", label: "Places", sensitivity: "ordinary" },
  {
    id: "the_emotional_side",
    label: "The emotional side of this",
    sensitivity: "peer_support",
  },
  {
    id: "health_legal_safety",
    label: "Health, legal or safety",
    sensitivity: "high_stakes",
  },
  { id: "other", label: "Something else", sensitivity: "ordinary" },
];

/**
 * Words that escalate a question filed as ordinary. Deliberately short and
 * deliberately blunt: this is a net for the case where a parent picks "Childcare"
 * and then describes something nobody should answer with "you'll hear at launch".
 */
const HIGH_STAKES_TERMS = [
  "abuse",
  "hurt",
  "hit",
  "unsafe",
  "danger",
  "emergency",
  "hospital",
  "self-harm",
  "suicide",
  "custody",
  "court",
  "restraining",
  "cps",
  "neglect",
  "overdose",
  "assault",
];

const PEER_SUPPORT_TERMS = [
  "alone",
  "lonely",
  "loneliness",
  "depressed",
  "depression",
  "anxious",
  "anxiety",
  "postpartum",
  "exhausted",
  "burnt out",
  "burned out",
  "failing",
  "guilt",
  "divorce",
  "separating",
];

/**
 * An accusation, in the past tense, about somebody in particular. Not "is this
 * safe" — that is a question and belongs to `high_stakes`.
 */
const ALLEGATION_TERMS = [
  "stole",
  "stealing",
  "lied",
  "lying",
  "screamed",
  "yelled",
  "slapped",
  "shook",
  "shoved",
  "grabbed",
  "abusive",
  "negligent",
  "neglected",
  "drunk",
  "creepy",
  "racist",
  "scammed",
  "fired",
  "no-showed",
  "ghosted",
  "faked",
  "forged",
  "unlicensed",
];

/**
 * Evidence that the sentence is about *a person* rather than a situation. An
 * accusation with no subject ("stuff kept going missing") is not a named
 * allegation; the same words attached to "our nanny" or "she" are.
 */
const PERSON_CUES = [
  "nanny",
  "sitter",
  "babysitter",
  "au pair",
  "nurse",
  "teacher",
  "doctor",
  "pediatrician",
  "therapist",
  "coach",
  "tutor",
  "instructor",
  "director",
  "principal",
  "owner",
  "housekeeper",
  "caregiver",
  "she",
  "he",
  "her",
  "him",
  "they",
];

function mentions(text: string, terms: string[]): boolean {
  const haystack = ` ${text.toLowerCase().replace(/[^a-z\s-]/g, " ")} `;
  return terms.some((term) => haystack.includes(` ${term} `));
}

/**
 * Classifies a demand signal. Never de-escalates: a category the parent chose as
 * sensitive stays sensitive, whatever the text looks like.
 *
 * The ladder is checked from the top, because the classes are not alternatives —
 * an allegation about a nanny usually trips the high-stakes words too, and the
 * quieter answer is the correct one of the two.
 *
 * The allegation net is deliberately crude and its errors are deliberately
 * one-sided: a false positive costs a gentler screen and a human read, a false
 * negative risks Pando answering a claim about a named person as if it were a
 * request for a recommendation. Two conditions rather than one keeps it from
 * catching every sentence with "fired" in it.
 */
export function classifyDemand(
  text: string,
  categoryId: string | null,
): DemandSensitivity {
  const chosen = DEMAND_CATEGORIES.find((c) => c.id === categoryId)?.sensitivity;
  if (mentions(text, ALLEGATION_TERMS) && mentions(text, PERSON_CUES)) {
    return "named_allegation";
  }
  if (chosen === "high_stakes") return "high_stakes";
  if (mentions(text, HIGH_STAKES_TERMS)) return "high_stakes";
  if (chosen === "peer_support") return "peer_support";
  if (mentions(text, PEER_SUPPORT_TERMS)) return "peer_support";
  return "ordinary";
}

/**
 * Free text about a named person, or anything sensitive, waits for a human — and
 * a queue entry a human has not read is never an answer Pando can give. For
 * `named_allegation` the database carries the same rule as a CHECK, so no caller
 * can be the one that forgets it.
 */
export function needsHumanReview(sensitivity: DemandSensitivity): boolean {
  return sensitivity !== "ordinary";
}

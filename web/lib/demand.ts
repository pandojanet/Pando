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
 * Words that escalate a question filed as ordinary.
 *
 * It was written as a **net under a category tap** — short and blunt, for the
 * parent who picks "Childcare" and then describes something nobody should answer
 * with "you'll hear at launch". Over SMS there is no tap, so from 4 Sep it has
 * been the only reading, and from 8 Sep — with `PILOT_HOLD_EVERYTHING` off — the
 * only thing between a health question and an unread automatic answer.
 *
 * It was not up to that. Measured: *"my 4 year old keeps having nosebleeds, is
 * that normal?"* returned `ordinary`, because the list carried **no medical
 * vocabulary at all**; *"is it legal to leave a 9 year old home alone?"* came
 * back `peer_support`, because "alone" is in the peer-support list and nothing
 * read the word "legal".
 *
 * ## What was added, and the line drawn
 *
 * **Symptoms and conditions, not specialities.** "fever", "rash", "seizure",
 * "medication" describe a child who is unwell — that is the client's
 * health-legal-safety class (3 Aug) and it is owed professional resources. But
 * *"any good pediatricians near me?"* is a **recommendation**, the commonest
 * question this product exists to answer, and filing it as high-stakes would
 * bury the ordinary case in the queue and answer a request for a name with a
 * resource list. So "doctor", "pediatrician" and "dentist" are deliberately
 * absent.
 *
 * ⚠ **No word list is complete, and this one is a floor rather than a
 * guarantee.** The model's `sensitive` flag escalates on top of it
 * (`escalateSensitivity`), and that flag is probabilistic — on the nosebleed
 * sentence it comes back `true` at 0.35 confidence, i.e. correct and unsure. Two
 * imperfect layers, and with automatic sending on, something sensitive will
 * eventually reach a parent unread. `PILOT_HOLD_EVERYTHING = true` is the
 * one-line answer if it does.
 */
const HIGH_STAKES_TERMS = [
  "abuse",
  "abused",
  "hurt",
  "hurting",
  "hit",
  "unsafe",
  "danger",
  "dangerous",
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

  /**
   * Medical — a child who is unwell, never a speciality somebody is looking for.
   *
   * ⚠ **The plurals are written out**, because `mentions` matches whole words:
   * a parent writes "nosebleeds", not "nosebleed", and the singular alone is
   * what let that sentence through. See the note on `mentions` for why matching
   * a prefix instead was tried and reverted.
   */
  "fever",
  "fevers",
  "rash",
  "rashes",
  "vomit",
  "vomiting",
  "vomited",
  "nosebleed",
  "nosebleeds",
  "seizure",
  "seizures",
  "asthma",
  "allergic",
  "allergy",
  "allergies",
  "infection",
  "infections",
  "medication",
  "medications",
  "prescription",
  "prescriptions",
  "antibiotic",
  "antibiotics",
  "symptom",
  "symptoms",
  "diagnosis",
  "diagnosed",
  "choking",
  "concussion",
  "dehydrated",
  "urgent care",
  "emergency room",

  /* Legal, beyond the custody words above. "is it legal" is how a parent
     actually asks, and nothing here read the word at all. */
  "legal",
  "lawyer",
  "lawyers",
  "attorney",
  "police",
  "social services",
];

const PEER_SUPPORT_TERMS = [
  "alone",
  "lonely",
  "loneliness",
  /* How a parent who has just moved actually says it — the market's own new-to-
     area case, and the list had every synonym but this one. */
  "isolated",
  "isolation",
  "overwhelmed",
  "struggling",
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
  /**
   * Whole words, and the inflections are spelled out in the lists.
   *
   * ⚠ **Prefix matching was tried on 8 Sep and reverted the same hour.** The
   * miss that prompted it is real — *"my 4 year old keeps having nosebleeds"*
   * did not match `nosebleed`, and the same hole was already in the original
   * list where nobody had looked (`abuse` missed "abused", `danger` missed
   * "dangerous"). But matching a term at the start of a word instead put six
   * plainly ordinary sentences into the high-stakes class, measured: *"the
   * school has a lovely **courtyard**"*, *"my toddler **hit** a growth spurt"*,
   * *"is there a **rash guard** requirement at the pool"*, *"best
   * **legal-sized** soccer field"*, *"any classes near the **courthouse**"*.
   *
   * On SMS that costs one extra reading. **On the web D1 flow it costs more**:
   * `high_stakes` there means professional resources are shown immediately (3
   * Aug), so a question about swim kit would have been answered with a health
   * resource list. A net that catches the pool is not a net.
   *
   * So the lists carry their own plurals. It is more lines and it is
   * predictable, which is what a rule standing between a health question and an
   * automatic answer has to be.
   */
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

/**
 * Raise a rule-based reading when the model thought the message was sensitive.
 *
 * **One direction only.** `classifyDemand` stays the authority on *which* class
 * a question belongs to, because each is owed something different — a safety
 * question gets professional resources, an allegation gets silence until a
 * person has read it — and a boolean has not said which. So this can lift
 * `ordinary` and can never lower anything.
 *
 * ⚠ It lifts to `high_stakes`, never to `named_allegation`. That class carries a
 * storage rule of its own (`demand_signals_allegation_review_check`: never
 * circulated, human review only), and claiming it on a coarse flag would file
 * an ordinary health question as an accusation.
 *
 * Why it exists at all: with `PILOT_HOLD_EVERYTHING` off (8 Sep), the keyword
 * net is the only thing between a health question and an unread automatic
 * answer, and over SMS it runs without the category tap it was designed as a
 * net underneath.
 */
export function escalateSensitivity(
  ruled: DemandSensitivity,
  modelSaidSensitive: boolean,
): DemandSensitivity {
  if (!modelSaidSensitive) return ruled;
  return ruled === "ordinary" ? "high_stakes" : ruled;
}

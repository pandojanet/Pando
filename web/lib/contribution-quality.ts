/**
 * Is this contribution complete enough to count? One rule, read by three places.
 *
 * The client (5 Oct): *"Stop making the admin infer quality from several
 * conflicting fields. Give each contribution one simple status: Qualifies ·
 * Needs follow-up · Too thin / unusable."* Before this a card could say
 * "Counts toward Founding" beside "Fully answered: Not yet", because two fields
 * measured two different things and neither was a decision.
 *
 * Read by:
 *  - the admin (`repo/admin-read.ts`), from the stored columns of a contribution;
 *  - the chat (`ChatSeeding`), from the card as the parent has just finished it,
 *    which is what lets Pando say "this counts" the moment it does;
 *  - the tests.
 *
 * ⚠ **A pure module with no imports at all**, on `matching.ts`'s rule: the same
 * function has to run in a browser, on the server and in a plain node test, and
 * a rule that needs a connection to be tested is a rule tested less.
 *
 * ⚠ **What this judges and what it does not.** It checks that each question a
 * kind *requires* has an answer, and that the one free-text answer that carries
 * the experience says more than a few words — the same 12-character floor and
 * empty-praise test the confirm-back uses. Whether a sentence is *true*, or
 * really firsthand, is a person's call: the model's usefulness score stays
 * internal and decides nothing here.
 *
 * ⚠ **"Added to Pando" is a different thing and is not computed here.** An
 * admin approves a record into Pando whether or not it qualifies — a useful
 * partial comment can stay — and only a qualifying one counts toward Founding.
 */

export type ContributionKind = "activity" | "place" | "tip" | "caregiver";

export type QualityStatus = "qualifies" | "needs_follow_up" | "too_thin";

export interface Quality {
  status: QualityStatus;
  /**
   * What is still missing, in the words a parent was asked — empty when it
   * qualifies. Read out as "Need <a> + <b>" so an admin sees the exact gap.
   */
  missing: string[];
}

/** The answers a kind's requirements read, normalised from either source. */
export interface QualityInput {
  kind: ContributionKind;
  /** Their own experience. A friend's never counts (3 Aug). */
  firsthand: boolean;
  /** The record's name, for the kinds a parent names (not a tip). */
  name: string | null;
  /** At least one child age answered. */
  has_child_age: boolean;
  /** When they were last there — an activity only. */
  last_there: boolean;
  /** "What makes it good" — and, on a tip, "why it helped". */
  why: string | null;
  /** The "what should another parent know" question was asked and answered. */
  caveat_answered: boolean;
  /** A tip's advice itself. */
  tip_text: string | null;
}

/**
 * Below this a sentence carries almost nothing another parent could act on.
 * The confirm-back's own number (`lib/seed-chat/confirm-back.ts`), kept in one
 * place: the chat asks for more when it is under, and a card still under it
 * afterwards is not complete.
 */
const THIN = 12;

const EMPTY_PRAISE =
  /^(it'?s |we |they |i )?(really |very |so )?(good|great|nice|fine|ok|okay|lovely|amazing|the best|fun|loved it|liked it|recommend)[.!]?$/i;

const NOTHING_TO_FLAG =
  /^(none|no|nope|nah|nothing|n\/a|na|not really|nothing( really| much)?( to (flag|add|report|mention|share|say|note))?|nothing comes to mind|no (caveats?|issues?|concerns?))[.!]?$/i;

/**
 * Words that carry no information about *what* was good: articles and fillers,
 * and the praise itself. What is left of a sentence once they are gone is what
 * the parent actually said.
 */
const FILLER = new Set(
  (
    "a an the is was are were be been being it its it's we i my our they their them you your he she her his " +
    "and but so or as at by of to for in on with from this that there here very really so super just too also " +
    "quite pretty definitely absolutely totally truly highly such all one would will can could do did does " +
    "have has had not no yes if what which who about than then more most much many some any too"
  ).split(" "),
);
const EVALUATIVE = new Set(
  (
    "good great excellent amazing awesome wonderful fantastic fabulous lovely nice fine ok okay best better " +
    "perfect favorite favourite love loved loves like liked likes recommend recommended enjoy enjoyed fun " +
    "cool superb brilliant terrific outstanding incredible invaluable worth worthwhile solid decent top " +
    "place class classes thing things stuff spot program experience"
  ).split(" "),
);

/** How many words of this sentence say something. Numbers count: "$30" and "9am" are facts. */
function contentWords(text: string, name?: string | null): number {
  const own = new Set(
    (name ?? "")
      .toLowerCase()
      .split(/[^a-z0-9']+/)
      .filter(Boolean),
  );
  return text
    .toLowerCase()
    .split(/[^a-z0-9$']+/)
    .filter(Boolean)
    .filter((w) => /\d/.test(w) || !(FILLER.has(w) || EVALUATIVE.has(w) || own.has(w))).length;
}

/** At least this many words that are neither filler, praise nor the record's own name. */
const MIN_CONTENT_WORDS = 2;

/**
 * "Good", "it's fine", "great!" — a sentence that says nothing a parent can use.
 *
 * ⚠ **With `content`, also a sentence that only praises the place by name** (5 Oct,
 * the client's own example): *"The Family Room is excellent"* is the name, a verb
 * and a compliment, and nothing a parent could act on. Strip the record's name,
 * the filler words and the praise, and fewer than two words are left. *"…invaluable
 * postpartum because I met mothers with babies the same age; the community was the
 * main value"* keeps a dozen. Not a word count and not a judgement of truth —
 * whether the words are firsthand is still a person's call — only a refusal to
 * call a compliment an experience. Applied to "what makes it good", not to the
 * caveat or who-it-suits, which are short by nature.
 */
export function isThinAnswer(
  value: string | null | undefined,
  options: { name?: string | null; content?: boolean } = {},
): boolean {
  const text = (value ?? "").trim();
  if (text.length < THIN || EMPTY_PRAISE.test(text)) return true;
  return options.content === true && contentWords(text, options.name) < MIN_CONTENT_WORDS;
}

/** The caveat question answered with "nothing" — an answer, and not a caveat. */
export function isNothingToFlag(value: string | null | undefined): boolean {
  return NOTHING_TO_FLAG.test((value ?? "").trim());
}

function has(text: string | null | undefined): boolean {
  return (text ?? "").trim().length > 0;
}

const UNNAMED = /^(untitled|unnamed|tip)?$/i;

/**
 * The decision.
 *
 *  - **qualifies** — everything this kind asks is answered, firsthand, and the
 *    experience is more than a few words.
 *  - **needs_follow_up** — something is missing that one more question would
 *    supply; `missing` says exactly what.
 *  - **too_thin** — there is no experience to follow up on: a name with nothing
 *    behind it, or a caregiver the family would not recommend.
 */
export function assessContribution(input: QualityInput): Quality {
  if (input.kind === "caregiver") {
    /* Caregivers are judged on their own fields (`assessCaregiver`); a caller
       that sends one here has the wrong function. */
    return { status: "needs_follow_up", missing: ["a caregiver card is judged separately"] };
  }

  const missing: string[] = [];
  const isTip = input.kind === "tip";

  if (!isTip && UNNAMED.test((input.name ?? "").trim())) missing.push("a name");

  if (isTip) {
    if (!has(input.tip_text)) missing.push("the tip itself");
  }

  if (input.kind === "activity") {
    if (!input.has_child_age) missing.push("how old their child was");
    if (!input.last_there) missing.push("when they were last there");
  }

  const hasWhy = has(input.why);
  const thinWhy = hasWhy && isThinAnswer(input.why, { name: input.name, content: true });
  if (!hasWhy) missing.push(isTip ? "why it helped" : "what they liked about it");
  else if (thinWhy)
    missing.push(isTip ? "more on why it helped" : "more on what they liked about it");

  if (!isTip && !input.caveat_answered) {
    missing.push(input.kind === "place" ? "what to know before going" : "whether there's a catch");
  }

  /* Nothing to follow up on: no experience at all beyond a name. */
  const nothingSaid = isTip ? !has(input.tip_text) && !hasWhy : !hasWhy && !input.caveat_answered;
  if (nothingSaid) return { status: "too_thin", missing };

  if (!input.firsthand) {
    return {
      status: "needs_follow_up",
      missing: ["their own experience — this one is a friend's", ...missing],
    };
  }

  return missing.length === 0
    ? { status: "qualifies", missing: [] }
    : { status: "needs_follow_up", missing };
}

/* ── Caregivers ─────────────────────────────────────────────────────────── */

export interface CaregiverQualityInput {
  name: boolean;
  type: boolean;
  ages: boolean;
  strengths: boolean;
  how_long: boolean;
  last_worked: boolean;
  /** `yes` · `hesitant` · `no`, or null when not answered. */
  recommend: string | null;
  /** Asked only after a recommendation; null when it was not asked. */
  reference_answered: boolean;
  know_first_answered: boolean;
}

/**
 * A caregiver card counts toward Founding only as a firsthand reference
 * (the client, 5 Oct), so the gate that she personally cared for the child is
 * not repeated here — a card that failed it was never kept (invariant 14).
 *
 * ⚠ A **No** is kept, privately and held, and is not a recommendation: it
 * reads as too thin to count, and the missing line says why rather than
 * pretending it is incomplete.
 */
export function assessCaregiver(input: CaregiverQualityInput): Quality {
  if (input.recommend === "no") {
    return { status: "too_thin", missing: ["a recommendation — the family would not recommend them"] };
  }
  const missing: string[] = [];
  if (!input.name) missing.push("a name");
  if (!input.type) missing.push("the kind of care");
  if (!input.ages) missing.push("the ages they looked after");
  if (!input.strengths) missing.push("what they are good at");
  if (!input.how_long) missing.push("how long they worked for them");
  if (!input.last_worked) missing.push("when they last worked for them");
  if (!input.know_first_answered) missing.push("anything a family should know");
  if (input.recommend === null) missing.push("whether they would recommend them");
  else if (!input.reference_answered) missing.push("whether they would be a reference");
  return missing.length === 0
    ? { status: "qualifies", missing: [] }
    : { status: "needs_follow_up", missing };
}

/* ── From stored columns ─────────────────────────────────────────────────── */

/** A contribution as the database holds it — the columns the rule reads. */
export interface ContributionColumns {
  kind: "activity" | "place" | "tip";
  firsthand: boolean;
  /** The record's name (`shares.name`). */
  name: string | null;
  child_age_at_time: number[] | null;
  last_there: string | null;
  what_makes_it_great: string | null;
  caveat_answered: boolean;
  tip_text: string | null;
}

/**
 * The same decision from the stored columns (5 Oct). One adapter for the admin
 * card and for the Founding count, so a card cannot be "complete" on one screen
 * and not on the other.
 */
export function assessColumns(c: ContributionColumns): Quality {
  return assessContribution({
    kind: c.kind,
    firsthand: c.firsthand,
    name: c.name,
    has_child_age: (c.child_age_at_time ?? []).length > 0,
    last_there: has(c.last_there),
    why: c.what_makes_it_great,
    caveat_answered: c.caveat_answered,
    tip_text: c.tip_text,
  });
}

/** A caregiver nomination as the database holds it. */
export interface NominationColumns {
  first_name: string | null;
  care_type: string | null;
  cared_for_ages: string[] | null;
  strengths: string[] | null;
  how_long: string | null;
  last_worked: string | null;
  hire_again: string | null;
  reference_willing: string | null;
}

/**
 * ⚠ The public note ("anything a family should know") is **not** checked here:
 * a typed "nothing to flag" is stored as no caveat (`cards.ts`), so a null
 * caveat cannot tell *declined* from *never asked*. The chat requires it for
 * every new card; for a stored one this reads it as answered.
 */
export function assessNomination(n: NominationColumns): Quality {
  return assessCaregiver({
    name: has(n.first_name),
    type: has(n.care_type),
    ages: (n.cared_for_ages ?? []).length > 0,
    strengths: (n.strengths ?? []).length > 0,
    how_long: has(n.how_long),
    last_worked: has(n.last_worked),
    recommend: has(n.hire_again) ? (n.hire_again as string) : null,
    reference_answered: has(n.reference_willing),
    know_first_answered: true,
  });
}

/**
 * How many **complete** contributions each parent has, from approved cards only
 * (5 Oct, the client: Founding counts a contribution once its minimum questions
 * are answered, not once an admin has pressed Add to Pando).
 *
 * Pure so it can be tested; `repo/founding-count.ts` feeds it the rows.
 */
export function countCompletePerPerson(input: {
  shares: Array<ContributionColumns & { person_id: string }>;
  nominations: Array<NominationColumns & { person_id: string }>;
}): Map<string, number> {
  const counts = new Map<string, number>();
  const add = (id: string) => counts.set(id, (counts.get(id) ?? 0) + 1);
  for (const row of input.shares) if (assessColumns(row).status === "qualifies") add(row.person_id);
  for (const row of input.nominations)
    if (assessNomination(row).status === "qualifies") add(row.person_id);
  return counts;
}

/* ── From a card in the chat ────────────────────────────────────────────── */

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

function nonEmptyArray(v: unknown): boolean {
  return Array.isArray(v) && v.length > 0;
}

/**
 * A card as the chat holds it: its step ids are the field keys.
 *
 * ⚠ **A skipped step is stored as an empty value, an unasked one is absent**
 * (`answer` in `ChatSeeding`), and the two are told apart here only for the
 * caveat — the one question that "nothing to flag" answers. Cards from before
 * 5 Oct could skip it, and a skip was always an answer (`caveat_answered` in
 * `cards.ts`); they keep reading that way.
 */
export function assessChatCard(
  kind: ContributionKind,
  fields: Record<string, unknown>,
): Quality {
  if (kind === "caregiver") {
    const name = fields.name;
    return assessCaregiver({
      name: Array.isArray(name) && typeof name[0] === "string" && name[0].trim() !== "",
      type: has(str(fields.type)),
      ages: nonEmptyArray(fields.cared_for_ages),
      strengths: nonEmptyArray(fields.strengths),
      how_long: has(str(fields.how_long)),
      last_worked: has(str(fields.last_worked)),
      recommend: str(fields.hire_again),
      reference_answered: has(str(fields.reference_willing)),
      know_first_answered: typeof fields.know_first === "string",
    });
  }
  return assessContribution({
    kind,
    firsthand: kind !== "activity" || fields.firsthand !== "secondhand",
    name: str(fields.name) ?? str(fields.place_name),
    has_child_age: nonEmptyArray(fields.child_age),
    last_there: has(str(fields.freshness)),
    why: str(fields.what_makes_it_great),
    caveat_answered: typeof fields.caveat === "string",
    tip_text: str(fields.tip),
  });
}

/** "Need a name + how old their child was" — the line an admin reads. */
export function missingLine(quality: Quality): string {
  return quality.missing.length === 0 ? "" : `Need ${quality.missing.join(" + ")}`;
}

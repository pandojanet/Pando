import type { FreshnessState, TrustLabels } from "./trust-labels";

/**
 * M5.7 — composing the answer.
 *
 * ## Why this has no model in it
 *
 * The estimate calls 5.7 "the core of the workflow", and the obvious reading is
 * that a model writes the reply. It does not, and that is the design rather than
 * a first cut to be replaced.
 *
 * Strategy §3: *"Pando never lets AI-generated text or public information pose as
 * a real parent's recommendation — the labels ('3 parents · confirmed 4 weeks
 * ago') come from records, not from the AI's imagination."* Three invariants say
 * the same thing from different angles — labels are verbatim and read the source
 * (3), a parent-trust label needs a parent behind it (4), and free text about a
 * named person is never published without human review (8).
 *
 * A model that writes the sentence can break all three without anybody noticing:
 * it can paraphrase a parent's caveat into a recommendation, attach "vouched" to
 * a record nobody vouched for, or smooth two parents into "several". None of
 * those is a bug that shows up in a test of the model; they show up as a parent
 * acting on something Pando never actually knew.
 *
 * So the composition is arithmetic over records, and the only thing a model could
 * usefully add later is tone — under a constraint that it may not introduce a
 * fact. That layer is deliberately not here yet.
 *
 * ## What it does decide
 *
 * The estimate's own list: "decides the answer's makeup by category / risk /
 * evidence (**not a fixed order**), renders it for SMS length, and sets the next
 * step (e.g. offering a blast). Also appends the forwardable share line where
 * eligible."
 */

/** One record, already retrieved and labelled (5.5 → 5.6). */
export interface AnswerCandidate {
  /**
   * The `shares` row this came from, when it came from one.
   *
   * **Never rendered** — it exists so the caller can record *which* records an
   * answer was built from, which is the join `drizzle/0026` added `share_ids`
   * for and which nothing had ever written. Without it 9.2 cannot fire at all:
   * the thank-you query inner-joins contributions on that array, so an empty one
   * finds nobody and the contributors behind a recommendation that helped are
   * never thanked.
   *
   * Absent on a caregiver and on general information: `share_ids` joins
   * `shares`, and an id from anywhere else would join nothing or, worse, the
   * wrong row.
   */
  id?: string | null;
  name: string;
  venue?: string | null;
  /**
   * A `share_kind` for a record, and for general information **the words it
   * came back with** — see `KIND_WORD`, which translates the first and passes
   * the second through.
   */
  kind: string;
  /**
   * Where it is, in the market's own vocabulary — one neighborhood slug.
   *
   * Added because the answer named two records and said what neither of them
   * **was** or **where**: a parent reading "Little Maestros (on Mission St)" has
   * to already know it is a music class in South Pasadena, which is precisely
   * what they were asking. It is a slug rather than a label because that is what
   * the record holds; the renderer is the only place that has to know how to say
   * it out loud.
   *
   * ⚠ This used to be followed by "structured fields only — this type has no
   * free-text field at all". **That stopped being true on 9 Sep**: see `notes`,
   * which the client's own strategy requires, and which carries the guards the
   * absence used to stand in for.
   */
  area?: string | null;
  /**
   * What it costs, **already written out** — "$50-100 a month".
   *
   * Rendered by the caller rather than here, and that is the same boundary the
   * rest of this type keeps: `answer.ts` imports nothing at runtime so a plain
   * node test can load it, while the words for `50_100` and `per_month` live in
   * the option lists `lib/seed-chat/scripts.ts` already exports. Passing the ids
   * would mean a second copy of those labels in here.
   *
   * ⚠ It must arrive **GSM-7 clean**. The option label is "$50–100" with an en
   * dash, which is outside GSM-7 and would drop the whole message to UCS-2 —
   * undoing the encoding fix above for one character. `toGsm7` is exactly the
   * tool, used exactly as its own header intends: on copy that is *not*
   * registered.
   */
  price?: string | null;
  /**
   * What the parents made of the price — "great value", "pricey but worth it".
   *
   * Rendered by the caller for the same reason as `price`, and carried
   * separately from it because a record can have one without the other: 11 of 13
   * live records agree on a price and only 8 on this.
   */
  worth?: string | null;
  /**
   * The kind of care a caregiver offers — "Full-time", "Before / after school".
   *
   * Replaces the kind word rather than joining it: "Elena V. - caregiver" says
   * nothing that her being in an answer about care did not already say, while
   * "Elena V. - full-time care" is the thing a parent is choosing on. Null for a
   * caregiver who has not filled in a profile of their own, and the line falls
   * back to the plain word.
   */
  care?: string | null;
  /**
   * One short factual thing about a **public** finding — the ages it takes,
   * when it runs, drop-in or a term, a published price.
   *
   * Only ever set on general information, and only when the page actually said
   * it. It is what turns a public line from a bare name into something a parent
   * can act on, and it is honest there precisely because that block is headed
   * "Public/general information": the same sentence under a parent's record
   * would be a claim about what parents found, which nobody made.
   */
  detail?: string | null;
  trust: TrustLabels;
  firsthand_count: number;
  /** §17.1 — an admin marked it complete enough to answer with. */
  answer_ready?: boolean;
  /**
   * What a parent actually wrote about it, already approved.
   *
   * ⚠ **This reverses the 11.4 boundary — `AnswerCandidate` had no free-text
   * field at all, deliberately — and the client reversed it on 9 Sep by sending
   * the strategy, whose own example answer is made of exactly this material:**
   * *"Two said the 9am class is calmer than the 10:30 … one tip: it fills fast
   * after Labor Day."*
   *
   * The old boundary read invariant 8 as forbidding it. It does not. The
   * invariant is that free text **about a named person** is never published
   * verbatim **without human review**, and both halves are satisfied here: these
   * sentences are about a class or a place, and `share_contributions.status =
   * 'approved'` *is* the human review — the contributions queue, where an admin
   * read this exact sentence before letting it into the graph.
   *
   * Measured before building it: eight approved contributions on the live graph
   * already carry one — *"Saturdays are packed, take the 9am"*, *"Sign up the
   * week registration opens or you are on a waitlist"* — and **not one had ever
   * reached a parent.** The knowledge the product is built to move was in the
   * database, reviewed, and structurally unable to leave it.
   *
   * ⚠ **Two guards, and neither is optional.** The caller must pass text only
   * from an **approved** contribution on an **approved** share, and must skip a
   * record carrying an open `possible_named_person` flag — because 11.4's
   * detector is about a record's own *name*, and a sentence naming somebody is
   * the case invariant 8 is actually written for.
   */
  notes?: {
    /** R6 — what makes it good, in their words. */
    great?: string | null;
    /** R7 — the caveat, which is often the most useful sentence there is. */
    caveat?: string | null;
    /**
     * R5 — **who it suits**, and it is the closest thing in the graph to the
     * strategy's own *"all with high-energy kids around that age"*.
     *
     * A parent choosing between two classes is choosing on whether it fits
     * *their* child, and this is the only field that speaks to that: "A cautious
     * toddler who warms up slowly", "First-time parents who want to be told what
     * to do", "A child who is not sporty yet". Captured since 1.5, approved with
     * the contribution, and never sent.
     */
    who_for?: string | null;
    /**
     * The practical thing a parent would not know to ask — her example's *"one
     * tip: it fills fast after Labor Day"*.
     *
     * Distinct from the caveat: a caveat is a reason to hesitate, a tip is how
     * to do it well. Both are worth the characters and both were unused.
     */
    tip?: string | null;
  };
  /**
   * The contributor's first name, where they turned it on for this one
   * recommendation — the client's *"Janet recommends this"* (10 Sep).
   *
   * ## It appears in exactly one place per record, and never twice
   *
   * On the **quote** when there is one, because that is the sentence the name
   * is actually attributing: *"Janet said: …"*. Otherwise on the **evidence
   * sentence**, and only where this parent is the only firsthand one — naming
   * one of three in a sentence whose whole job is to say there are three would
   * trade the strongest claim Pando makes for a first name.
   *
   * ⚠ **A record with several contributors and no quote therefore shows no
   * name**, even though somebody granted permission. That is the honest
   * outcome: a permission is not a promise of appearance, exactly as a
   * caregiver's consent is not (invariant 1). The card says "can see", not
   * "will see", for this reason.
   *
   * ⚠ **It is never made GSM-7.** Every other unregistered string on this path
   * is (a public finding's name, a price label), and a person's name is the one
   * that must not be: "Zoë" rewritten to "Zoe" is altering somebody's name to
   * save a segment. An accent moves the whole message to UCS-2 and roughly
   * doubles its cost, `sendSms` already logs that, and the trade is deliberate.
   */
  named_by?: string | null;
  /**
   * When a parent last confirmed it, so the evidence can be said in prose.
   *
   * The same date `lastConfirmedLabel` renders; carried separately because the
   * label is now a sentence rather than a suffix.
   */
  last_confirmed?: string | null;
  /**
   * Where retrieval put this record — 0 is the most relevant. Lower wins.
   *
   * ⚠ **Without this the whole of 5.5's relevance work reached no parent.**
   * `retrieveFor` orders by the question's topic and the asker's area and hands
   * the list over in that order; `rankForAnswer` then re-sorted by evidence and
   * *reversed* it. Measured on the live graph, every band holds fewer records
   * than retrieval's own `limit`, so the SQL `ORDER BY` could not even change
   * which rows were fetched — it ordered them and the composer threw the order
   * away. `focusInQuestion`, `drizzle/0032`, `focus:backfill` and the area rank
   * were all computed, carried, and read by nothing.
   *
   * What that looked like on a phone, from `answers` on 8 Sep: *"Please give me
   * some great school in Passadena"* was answered with a **watershed park** and
   * a **summer camp**, and the only school on the page was the one public line.
   * That is the client's *"недостатньо інформації"* — the information was in the
   * graph and the ordering put it out of reach.
   *
   * Absent means "retrieval did not rank this", which is true of general
   * information: it is ranked last by `public_only` anyway.
   */
  rank?: number;
}

export type NextStep =
  /** Pando knows enough. Nothing further offered. */
  | "none"
  /** Not enough, and the network could be asked. */
  | "offer_blast"
  /** Nothing at all, and asking would not help either — a person should look. */
  | "human_review";

export interface ComposedAnswer {
  /** What Pando would send, already within the length budget. */
  text: string;
  next_step: NextStep;
  /**
   * True when the answer rests only on public information.
   *
   * Carried out rather than inferred from the text: the caller decides whether an
   * answer with no parent behind it is worth sending at all, and reading that
   * back out of a rendered string would be guessing at our own output.
   */
  public_only: boolean;
  /** How many records the answer actually used. */
  used: number;
  /**
   * How many of those a parent actually stands behind.
   *
   * Separate from `used` because the answer now carries **general information
   * alongside** the parents' records, and every judgement downstream is about
   * the parents' half: whether to offer a Network Ask, and whether the answer is
   * thin enough to need a person (5.8's `low_evidence`).
   *
   * Without it those judgements silently improve when the web finds three
   * things: one parent plus three public results reads as four records, so Pando
   * would stop offering to ask the network on the strength of pages it did not
   * write. The comment on `next_step` below has always said the line is drawn at
   * parent-backed records; this is what makes the code say it too.
   */
  parent_used: number;
  /**
   * The `shares` rows behind the records that were actually rendered.
   *
   * The ones **used**, never the ones retrieved: an answer that mentions two of
   * five records was built from two, and thanking the other three would be
   * thanking people whose recommendation nobody saw.
   */
  used_ids: string[];
  /** Every label that appears, for the acceptance checks and the admin queue. */
  labels: string[];
}

/**
 * The length budget: **three segments**, raised from two on 4 Sep.
 *
 * An SMS segment is 160 GSM-7 characters, and 153 once a message is split, so
 * this is 153 × 3 exactly.
 *
 * ## Why it moved, and what it was before
 *
 * It was 306 — two segments — on two grounds written here at the time: the
 * arithmetic, and *"the strategy's own example answer is about that long"*. Read
 * that second clause carefully before changing this again: it is **an inference
 * from an example, not an instruction**. The client never specified a length,
 * and there was no Decisions row for it, so the number looked like a settled
 * choice only because it was a named constant.
 *
 * ⚠ **The strategy document is not in the repo**, so nobody here can check that
 * example. If it turns out to be two segments, this is a deviation from her
 * intent and should go back to her — it is on the list.
 *
 * What actually forced it: once a record carried what it *is*, where it is and
 * what it costs, two records no longer fit and a question like "any good toddler
 * classes near South Pasadena?" came back naming **one** option. The argument
 * for two segments was that an answer should read like a person texting rather
 * than a newsletter — and the thing the client reacted to read like neither. It
 * read like a database dump, from too little detail rather than too much. An
 * answer that offers one option is also an answer the parent will follow with a
 * Network Ask, so the second message is spent either way.
 *
 * The cost is real: roughly 50% more per answer. Worth it for a second option a
 * parent can compare, and worth re-examining when there is a bill to look at.
 *
 * The budget is enforced by **dropping whole records**, never by truncating a
 * sentence mid-word — an answer that ends in "recommended by three par" is worse
 * than one that mentions two places.
 */
/**
 * ## 765 since 9 Sep, and the client lifted the constraint herself
 *
 * Her words: *"мені не важливий наразі розмір повідомлення, але має бути як
 * паблік інфа, так і від батьків"* — size is not the constraint right now, and
 * an answer must carry **both** halves. At 459 they competed for the same space:
 * a lead block in the parents' own words runs 250-350 characters, a second
 * option is ~90, and general information got whatever was left, which was
 * frequently nothing.
 *
 * Five segments (153 × 5), kept a whole number of them because a budget that
 * ends mid-segment wastes one. ⚠ **Roughly 67% more per answer than three
 * segments**, and "наразі" is her own word for how long that stands.
 */
export const SMS_BUDGET = 765;

/**
 * The blank line plus "Public/general information:" that opens that block.
 *
 * Budgeted as a constant rather than measured, because the heading is written
 * inside the loop and the reservation has to be made before it — and it is the
 * one line in the answer whose length does not vary.
 */
const PUBLIC_HEADING_COST = 32;

/**
 * How records are ordered — "by category / risk / evidence, **not a fixed
 * order**".
 *
 * Evidence first, because that is what the parent is actually buying: a record
 * two parents have used outranks one with a single mention, whatever else is true
 * of it. `answer_ready` — an admin's judgement that this record could answer a
 * question on its own — breaks the tie above evidence, since it *is* a human
 * having already looked.
 *
 * Freshness is last and is a **tiebreak, not a filter**: the spec's answer to old
 * knowledge is to mark it old, and a stale record that two parents used still
 * beats a fresh one nobody has.
 */
const FRESHNESS_RANK: Record<FreshnessState, number> = { fresh: 0, ageing: 1, stale: 2 };

export function rankForAnswer(candidates: AnswerCandidate[]): AnswerCandidate[] {
  return [...candidates].sort(
    (a, b) =>
      /**
       * A parent-backed record always outranks general information, whatever
       * else is true of either.
       *
       * Stated as its own key rather than left to fall out of the counts, and
       * the case that forces it is the quiet one: a record with only secondhand
       * contributions has `firsthand_count: 0` and may be ageing, so on the
       * remaining keys a freshly-fetched web result would beat it. That is the
       * product's own claim inverted — "AI knows things. Pando knows someone."
       *
       * It is also what makes the budget honest. Records are dropped from the
       * end when there is no room, so this is what guarantees the thing that
       * goes first is the page nobody vouched for.
       */
      Number(a.trust.public_only) - Number(b.trust.public_only) ||
      /**
       * **Then relevance, because an answer about the wrong subject is not an
       * answer** (8 Sep).
       *
       * This key was missing and it is what the client reported. Evidence used
       * to come first, so a park two parents had used beat the only school on a
       * question about schools — and `answer_ready` beat it too, which is worse,
       * because that flag says a record is *complete enough to answer with*
       * (§17.1) and says nothing whatever about **this** question.
       *
       * ⚠ It ranks and never filters, which is the 4 Sep rule this has to keep:
       * `focus` is written by the extraction model, so a wrong tag re-orders and
       * can never drop the right record and leave nothing on screen saying so.
       * And it is retrieval's *index* rather than the topic itself, so the rule
       * lives in one place — the SQL that already knows the question's topic,
       * the asker's area and their bands.
       *
       * Evidence and the golden flag still decide everything *within* one level
       * of relevance, which is where they belong.
       */
      (a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER) ||
      Number(b.answer_ready ?? false) - Number(a.answer_ready ?? false) ||
      b.firsthand_count - a.firsthand_count ||
      FRESHNESS_RANK[a.trust.freshness] - FRESHNESS_RANK[b.trust.freshness] ||
      a.name.localeCompare(b.name),
  );
}

/**
 * The one line per record.
 *
 * The labels are pasted **verbatim** from `TRUST_LABEL` — never reworded, never
 * summarised, never merged. That is invariant 3, and it is why this function
 * takes the labels rather than deriving anything of its own from the counts.
 *
 * Freshness is appended as a word only when it is not fresh: saying "fresh" out
 * loud is noise, while saying nothing about an ageing record would be a claim.
 */
/**
 * What a record *is*, in one word a parent would use.
 *
 * `share_kind` has four members and none of them is a word anybody says: a
 * parent asks about a class, not an "activity", and "place" tells them nothing
 * a park does not. Kept beside the renderer rather than in `labels.ts`, which
 * is the admin's vocabulary — this is the parent's.
 *
 * ## Anything not in this map is already a parent's words, and is used as-is
 *
 * ⚠ A public finding carries `what` here — "toddler swim lessons",
 * "drop-in indoor playspace" — and the lookup **silently dropped it**, because
 * a miss is `undefined` and `describes` then falls back to the area alone. So
 * every general-information line a parent has ever been sent read
 * *"Tinkergarten in South Pasadena"* while the three words saying what it is
 * had been asked for, length-capped, stripped of praise and thrown away one
 * function later. Measured across ten live questions: **eight of eight** public
 * lines were missing it.
 *
 * That is the 4 Sep finding — "the line never said what the thing *was*" — on
 * the half of the answer that was built after it. The fallback is a `??` rather
 * than a second field because the two cases are the same sentence slot: what is
 * this thing, in words a parent would use. A share's four enum members can
 * never reach it, so nothing about a record's rendering changes.
 */
const KIND_WORD: Record<string, string> = {
  activity: "class",
  place: "place",
  tip: "tip",
  caregiver: "caregiver",
};

/** `south-pasadena` as somebody would say it. */
function areaWords(slug: string): string {
  return slug
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/**
 * One record, and it now says what it is and where.
 *
 * It used to render `name (venue): labels` and nothing else, which is what made
 * a real answer read as a list of names — *"Little Maestros (on Mission St):
 * Validated by multiple parents · Human-reviewed · Last confirmed Aug 2026"*
 * tells a parent who does not already know what Little Maestros is precisely
 * nothing, and the identical chain on the next line made both look
 * machine-generated.
 *
 * ⚠ **The labels themselves are untouched and must stay so.** They are approved
 * copy held verbatim in `TRUST_LABEL` (invariant 3), so what could change was
 * everything around them, never their wording — and the kind and the area are
 * structured fields the record already holds, so nothing here is invented.
 *
 * The cost is real and worth naming: roughly twenty characters a record against
 * a 306-character budget, so a long answer now fits one record fewer. That is a
 * trade rather than a free win - an answer that names three things nobody can
 * identify is worse than one that names two they can act on.
 *
 * ## And every separator here is ASCII, which is worth more than it looks
 *
 * The old line joined the labels with ` · `, and one character outside GSM-7
 * drops the whole message to UCS-2 and the budget from 160 to 70. Measured with
 * `planSegments` on one rendered record: **130 characters, UCS-2, two segments**
 * with the interpunct, and **128 characters, GSM-7, one** without it. Both the
 * separator and the dash had to go — either one alone keeps it in UCS-2 — and
 * across a two-record answer that is five segments against two.
 *
 * ⚠ The **labels are untouched**: they are approved copy held verbatim in
 * `TRUST_LABEL` (invariant 3). What changed is the punctuation *between* them,
 * which is this function's own and was never registered. The design system's
 * "em dashes are fine" is a rule about screens; `sms-segments.ts` exists for
 * exactly this argument on the other side.
 */
/**
 * The labels `evidenceSentence` now says in prose, so they are not printed twice.
 *
 * ⚠ **A second copy of approved copy, and that is a known cost paid deliberately
 * here as it is in `test:answer`.** This module imports nothing at runtime — that
 * is what lets a plain node test load it — so it cannot read `TRUST_LABEL`. The
 * suite checks this list against `trust-labels.ts` character for character, so an
 * edit there that is not made here fails rather than silently printing a claim
 * twice or dropping one.
 *
 * The three parent-strength labels and the confirmation date become *"Two parents
 * near you have used it, last confirmed Aug 2026"*. `Human-reviewed` is dropped
 * outright: it is a process fact rather than a source, and the client's own label
 * format ("3 parents · confirmed 4 weeks ago") omits it.
 *
 * Everything else — `Public/general information`, `Fresh network answer`,
 * `Reference available` — is untouched and still printed verbatim.
 */
export const SAID_IN_PROSE: readonly string[] = [
  "Shared by a local parent",
  "Vouched by a local parent",
  "Validated by multiple parents",
  "Human-reviewed",
];

function extrasOf(labels: readonly string[]): string[] {
  return labels.filter(
    (l) => !SAID_IN_PROSE.includes(l) && !l.startsWith("Last confirmed"),
  );
}

/**
 * The evidence, in a sentence rather than as a chain of labels.
 *
 * ⚠ **This is a re-approval under invariant 3, taken by the client on 9 Sep**,
 * and the wording is hers: the strategy writes the trust claim as *"Three
 * parents near you have used Toddler Tunes in the last six months"* and gives
 * the compact form as *"3 parents · confirmed 4 weeks ago"*. What it replaces is
 * `Validated by multiple parents. Human-reviewed. Last confirmed Aug 2026.` —
 * 71 characters a record, repeated on every line, and measured at **53% of every
 * message Pando sends**.
 *
 * **It says more, not less.** "Two parents" is a number where "multiple" was a
 * word, and it is computed from the same `firsthand_count` 5.6 labels from — so
 * the claim is the same claim, stated precisely. `Human-reviewed` is dropped
 * because it is a process fact rather than a source, and the strategy's own
 * label format omits it.
 *
 * ⚠ **What is *not* softened is the public branch.** `TRUST_LABEL.PUBLIC` stays
 * verbatim, because invariant 4 is the one this prose could actually break: a
 * page must never read as a parent's experience, and "Public/general
 * information" is the sentence that stops it.
 *
 * ⚠ And the interpunct in her own example (`3 parents · confirmed`) is outside
 * GSM-7 and would halve every message's budget, so the separator is a comma.
 */
function evidenceSentence(candidate: AnswerCandidate, named: string | null): string {
  /* Verbatim, from the labels 5.6 computed — never a local copy of approved
     copy, which is the duplication invariant 3 exists to prevent. */
  if (candidate.trust.public_only) return `${candidate.trust.labels.join(". ")}.`;

  const n = candidate.firsthand_count;
  const who =
    /* The client's own sentence, where it is true (10 Sep): one parent, and
       that parent turned their name on for this recommendation. `named` is
       already null wherever the caller is putting the name on a quote instead,
       so the two can never both fire. */
    named && n === 1
      ? `${named} has used`
      : n <= 0
      ? "A local parent has shared"
      : n === 1
        ? "One parent near you has used"
        : `${n} parents near you have used`;
  const when = candidate.last_confirmed
    ? `, last confirmed ${monthOf(candidate.last_confirmed)}`
    : "";
  return `${who} ${candidate.name}${placeOf(candidate)}${when}.`;
}

/**
 * ", a class in South Pasadena" — what it is and where.
 *
 * ⚠ **The kind is not decoration and must not be dropped to shorten this.** It
 * was added on 4 Sep after a live answer named two records and said what neither
 * of them *was*: "a parent reading 'Little Maestros' has to already know it is a
 * music class in South Pasadena, which is precisely what they were asking."
 * `KIND_WORD` is what makes it a word a parent would use — nobody says
 * "activity".
 */
function placeOf(candidate: AnswerCandidate): string {
  const what = candidate.care
    ? `${candidate.care.toLowerCase()} care`
    : (KIND_WORD[candidate.kind] ?? candidate.kind);
  const where = candidate.area ? ` in ${areaWords(candidate.area)}` : "";
  return what ? `, ${article(what)}${what}${where}` : where;
}

function article(what: string): string {
  return /^[aeiou]/i.test(what) ? "an " : "a ";
}

function monthOf(at: string): string {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return "recently";
  return d.toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "America/Los_Angeles",
  });
}

/**
 * The lead record, in the shape the strategy asks for.
 *
 * Evidence, then **what a parent actually said**, then the caveat, then the
 * money. The client chose this over the catalogue line on 9 Sep, with the second
 * record kept as a single line so an answer still offers a comparison — which is
 * why `SMS_BUDGET` was raised to three segments on 4 Sep and is why depth alone
 * was not the choice.
 *
 * ⚠ **A parent's sentence is never edited** — not truncated, not re-punctuated,
 * not rewritten into GSM-7. A note that does not fit is dropped whole, exactly
 * as a record is. Altering what somebody said and then attributing it to them is
 * a worse failure than sending one line fewer.
 */
function leadBlock(candidate: AnswerCandidate, extras: readonly string[]): string {
  const great = clean(candidate.notes?.great);
  /**
   * One name per record, and the quote wins it (10 Sep).
   *
   * The name and the quote come from the same contribution by construction —
   * the SQL orders both the same way — so attributing the sentence is always
   * truthful. When there is no sentence the name has nowhere better to go than
   * the evidence, and `evidenceSentence` takes it only where it can be said
   * without dropping a count.
   */
  const named = clean(candidate.named_by);
  const parts = [evidenceSentence(candidate, great ? null : named)];

  /* Who it suits, before what one parent thought of it: a reader deciding
     between two classes is deciding whether it fits their child, and that
     question comes first. */
  const whoFor = clean(candidate.notes?.who_for);
  if (whoFor) parts.push(`Best for: ${lowerFirst(whoFor)}.`);

  if (great) parts.push(`${named ?? "One"} said: "${great}"`);

  const caveat = clean(candidate.notes?.caveat);
  if (caveat) parts.push(`Heads up: ${caveat}`);

  /* A tip is how to do it well; a caveat is a reason to hesitate. Both, when
     both exist — they are different sentences and a parent uses each. */
  const tip = clean(candidate.notes?.tip);
  if (tip) parts.push(`One tip: ${lowerFirst(tip)}`);

  const money = [candidate.price, candidate.worth].filter(Boolean).join(", ");
  /* "About" because the bands are bands and the client's own example says it:
     *"It runs about $30 a session."* Omitted for a free record, where "about
     free" is nonsense. */
  /**
   * "About" because the bands are bands, and the client's own example says it:
   * *"It runs about $30 a session."*
   *
   * ⚠ Dropped where the label is already hedged or exact — "About Over $200 a
   * camp week" and "About Free" both came out of the live probe. `Over` and
   * `Under` are the band labels' own comparatives, and a price of Free is not
   * approximate.
   */
  if (money) {
    const hedged = /^(over|under|free)\b/i.test(candidate.price ?? "");
    parts.push(hedged ? `${money}.` : `About ${money}.`);
  }

  if (extras.length > 0) parts.push(`${extras.join(". ")}.`);
  parts.push(freshnessNote(candidate));

  return parts.filter(Boolean).join("\n");
}

/**
 * "A cautious toddler" → "a cautious toddler", so it reads as the rest of the
 * sentence Pando started rather than as a new one.
 *
 * ⚠ The **only** change ever made to a parent's own words besides collapsing
 * whitespace, and it is made only where the field is a fragment that Pando has
 * introduced ("Best for:", "One tip:"). A quoted sentence is never touched — an
 * altered sentence in quotation marks attributed to somebody is the thing
 * invariant 8 is about.
 */
function lowerFirst(text: string): string {
  /* Left alone when it starts with something that is capitalised for its own
     reasons — a name, an acronym — which a lower-case second letter reveals. */
  if (/^[A-Z][A-Z]/.test(text)) return text;
  return text.charAt(0).toLowerCase() + text.slice(1);
}

/** A parent's own words, whitespace-normalised and never otherwise touched. */
function clean(text: string | null | undefined): string | null {
  const flat = (text ?? "").replace(/\s+/g, " ").trim();
  return flat === "" ? null : flat;
}

function freshnessNote(candidate: AnswerCandidate): string {
  return candidate.trust.freshness === "fresh"
    ? ""
    : candidate.trust.freshness === "ageing"
      ? "Worth checking it hasn't changed."
      : "This one is old, so treat it as a starting point.";
}

/**
 * Every record after the lead: one line, so the answer still offers a choice.
 *
 * Deliberately not a second deep block. Two of those is four segments and reads
 * as a brochure; the strategy's example answers with one recommendation, and the
 * client's instruction was that a short second option keeps the comparison the
 * 4 Sep budget decision was made for.
 */
function alsoLine(candidate: AnswerCandidate): string {
  if (candidate.trust.public_only) return line(candidate, candidate.trust.labels);
  /* Only ever used for the cost estimate below; the printed line is built from
     `alsoParts` and `tipLines`, either of which may skip this record. */
  if (candidate.kind === "tip") return tipPart(candidate) ?? "";
  const part = alsoPart(candidate);
  return part === null ? "" : `Also nearby: ${part}.`;
}

/**
 * One secondary record, without the prefix, so several can share a line.
 *
 * ⚠ **Found by the live probe the moment the budget went to five segments.**
 * With room for five records every one of them opened *"Also nearby:"* — the
 * answer read as a stutter, and the probe's own duplicate check fired on the
 * repeated phrase. The client asked for one record in depth plus **a** short
 * second option; more space is not permission to turn that into a list of five.
 */
function alsoPart(candidate: AnswerCandidate): string | null {
  /**
   * A tip is not a place, and its name is a filing label (9 Sep).
   *
   * The client's own answer ended "Also nearby: Camp registration timing, a
   * tip, 1 parent; Kidspace summer camp..." — and "Camp registration timing"
   * tells a parent nothing. It is what the record was called so it could be
   * found again; the thing worth sending is the sentence inside it. Rendering
   * the label also put a tip under a phrase claiming it was *nearby*, which a
   * tip cannot be.
   *
   * So a tip is not offered as an alternative at all — `tipPart` gives it its own
   * line, where its sentence has room to be read, and the slot it used to occupy
   * goes to a real second option.
   */
  if (candidate.kind === "tip") return null;
  const n = candidate.firsthand_count;
  const who = n === 1 ? "1 parent" : `${n} parents`;
  const money = [candidate.price, candidate.worth].filter(Boolean).join(", ");
  return `${candidate.name}${placeOf(candidate)}, ${who}${money ? `, ${money}` : ""}`;
}

/**
 * A tip record on its own line.
 *
 * ⚠ **Its own line rather than a slot in the "Also nearby" list**, and that is
 * the second half of the same finding. Squeezed into the list it produced
 * *"…not February.; Kidspace summer camp, a class in Playhouse District…"* — a
 * two-sentence paragraph joined to a compact directory line by a semicolon,
 * with a full stop butting into it. On its own line the same sentence is the
 * most actionable thing in the answer.
 *
 * `name: text`, because the name is a heading here rather than a filing label —
 * it says what the tip is about, which the sentence alone often does not. No
 * text means nothing to say, and it is dropped.
 */
function tipPart(candidate: AnswerCandidate): string | null {
  const said = candidate.notes?.tip ?? candidate.notes?.great ?? null;
  return said ? `${candidate.name}: ${said}` : null;
}

/** One. A second is a newsletter, not an answer. */
const TIP_LIMIT = 1;

/**
 * How many records follow the lead.
 *
 * Two, so a parent has something to compare against and the answer still reads
 * as a recommendation rather than a directory. The budget is no longer what
 * decides this (9 Sep, when it stopped being scarce) — the shape is.
 */
const ALSO_LIMIT = 2;

function line(candidate: AnswerCandidate, labels: readonly string[]): string {
  const what = candidate.care
    ? `${candidate.care.toLowerCase()} care`
    : (KIND_WORD[candidate.kind] ?? candidate.kind);
  const where = candidate.area ? ` in ${areaWords(candidate.area)}` : "";
  const venue = candidate.venue ? `, ${candidate.venue}` : "";
  const describes = what ? ` - ${what}${where}${venue}` : `${where}${venue}`;
  /* The one fact a parent choosing between two classes actually needs, and the
     answer never carried it. Omitted rather than guessed when the parents who
     reported it did not agree — see `ShareCandidate.price_band`. */
  const money = [candidate.price, candidate.worth].filter(Boolean).join(", ");
  /* A public finding carries a fact the page stated instead of a price band —
     the ages it takes, when it runs, what it publishes as its price. It is what
     turns a bare name into something a parent can act on, and it is honest only
     because the heading above it says where it came from. */
  const extra = [money, candidate.detail].filter(Boolean).join(". ");
  const cost = extra ? ` ${extra}.` : "";

  const claims = labels.join(". ");
  const age =
    candidate.trust.freshness === "fresh"
      ? ""
      : candidate.trust.freshness === "ageing"
        ? " Worth checking it hasn't changed."
        : " This one is old, so treat it as a starting point.";
  /* Every label may have been hoisted, in which case the record is its own
     sentence and the full stop after the price already closed it. */
  return claims === ""
    ? `${candidate.name}${describes}.${cost}${age}`.trimEnd()
    : `${candidate.name}${describes}.${cost} ${claims}.${age}`;
}

/**
 * The labels every record in the answer carries, said once instead of on each
 * line.
 *
 * ## Why this is not a reword, and could not have been one
 *
 * The labels are approved copy held verbatim (invariant 3), so shortening the
 * wording is a re-approval rather than an edit. Shortening the **repetition** is
 * neither: the identical string is printed once about the set instead of once
 * about each member of it, and no record loses a claim.
 *
 * It is worth real space. A three-record answer repeats "Human-reviewed" three
 * times for 48 characters that say one thing, and when the records also share
 * their strength and their date — which two approved records from the same month
 * usually do — the whole 70-character chain collapses to one line. That is a
 * record's worth of budget bought back from punctuation.
 *
 * ## The two rules that keep it honest
 *
 * **Only labels *every* record has**, which is what makes the hoisted line true
 * of each of them. A label one record lacks stays on the lines that do have it —
 * and that is the interesting case rather than an edge: "Validated by multiple
 * parents" on one record beside "Shared by a local parent" on another is exactly
 * the distinction a reader is there to see.
 *
 * **Computed over every ranked candidate, not only the ones that fit.** Dropping
 * a record can only *shrink* the shared set, never grow it, so a label hoisted
 * before the budget loop is still true of whatever survives it. Getting that
 * backwards would put a claim on a footer about a record the reader was shown.
 */
function sharedLabels(candidates: AnswerCandidate[]): string[] {
  if (candidates.length < 2) return [];
  const [first, ...rest] = candidates;
  return first.trust.labels.filter((label) =>
    rest.every((c) => c.trust.labels.includes(label)),
  );
}

/**
 * §13 — the forwardable line.
 *
 * The estimate asks the generator to "append the forwardable share line where
 * eligible", and eligibility is the interesting half: it goes on an answer a
 * parent would actually pass on, which means one with something in it. Appending
 * it to "I don't know yet" would be asking somebody to advertise an empty answer.
 *
 * It is also how 5.9's cold inbound arrives — a forwarded answer is the front
 * door — so the wording names the service rather than assuming the reader knows
 * what it is.
 */
export const SHARE_LINE = "- from Pando, where local parents answer. Text this number to ask your own.";

export interface ComposeInput {
  candidates: AnswerCandidate[];
  /** What the parent asked, only to decide whether an answer is worth sending. */
  has_question: boolean;
  /** Whether a Network Ask could still be offered — false when they have no budget. */
  can_offer_blast?: boolean;
  /** Append the forwardable line. Off for a reply inside a conversation. */
  forwardable?: boolean;
}

/**
 * Build the answer.
 *
 * Records are added while they fit. The budget is checked **before** each line is
 * appended, so the result is always whole lines — an answer that stops mid-record
 * is worse than a shorter one.
 */
export function composeAnswer(input: ComposeInput): ComposedAnswer {
  const ranked = rankForAnswer(input.candidates);

  /* Nothing at all. Two different nothings, and they get different offers. */
  if (ranked.length === 0) {
    return {
      text: input.can_offer_blast === false
        ? "I don't have anything from local parents on this yet. I'll come back to you when I do."
        : "I don't have anything from local parents on this yet. Want me to ask a few nearby who might?",
      next_step: input.can_offer_blast === false ? "human_review" : "offer_blast",
      public_only: false,
      used: 0,
      parent_used: 0,
      used_ids: [],
      labels: [],
    };
  }

  const parentBacked = ranked.filter((c) => !c.trust.public_only);
  const publicOnly = parentBacked.length === 0;

  /**
   * The opening sentence, and **the count is gone from it on purpose.**
   *
   * It used to read "N local parents have shared something on this", and the
   * comment here used to claim it never counted records the answer would not
   * mention. Both were wrong, and a live walk printed the proof: *"10 local
   * parents have shared something on this"* above **two** records.
   *
   * Two separate faults, and the first is the serious one.
   *
   * **It counted records and called them parents.** `parentBacked` is a filter
   * over candidates, so ten records might be ten parents, or three parents who
   * contributed ten records, or one enthusiast. How many *people* stand behind an
   * answer is the strongest claim Pando makes — invariants 3 and 4 exist for it —
   * and it is **not derivable** from what a candidate carries: `firsthand_count`
   * is per record, and the same parent can appear in several.
   *
   * **And it was computed before the budget loop**, which then dropped whatever
   * did not fit. So even read as a count of records it described a list the
   * reader was not shown.
   *
   * The honest fix is to stop claiming a number rather than to compute a better
   * one. Nothing is lost that the reader cannot see: the records are listed right
   * underneath, and each carries its own label — "Validated by multiple parents"
   * is the per-record version of the claim, computed from the counts by 5.6,
   * where it is true.
   *
   * The public-information branch is untouched: it never says "parents" at all,
   * which is 5.6's guard arriving in the prose.
   */
  /**
   * ⚠ **The opening is gone for a parent-backed answer** (9 Sep).
   *
   * "Here's what local parents have shared:" is 38 characters saying what the
   * very next sentence — *"Two parents near you have used Little Maestros in
   * South Pasadena"* — says better and with a number in it. The client's own
   * example answer has no preamble at all; it opens on the evidence.
   *
   * The public branch keeps its sentence, because there it is the **guard**
   * rather than a preamble: it is what stops a page reading as a parent's
   * experience, which is invariant 4 and the one thing this pass must not
   * loosen.
   */
  const head = publicOnly
    ? "Here's what I can tell you. This is general information, not from a parent:"
    : "";

  /**
   * The labels every record shares come out of the lines and go under them once.
   *
   * `footer` is budgeted like a line because it is one; the connective is ours
   * rather than approved copy, and it is deliberately colourless — the labels do
   * the talking and a sentence introducing them would be a gloss on wording
   * nobody may gloss.
   */
  /* Filtered through `extrasOf` as well, or the footer prints the very claim
     the evidence sentence just made: "All of these: Validated by multiple
     parents" under "2 parents near you have used it" (9 Sep). */
  const hoisted = extrasOf(sharedLabels(ranked));
  const perLine = (c: AnswerCandidate) =>
    hoisted.length === 0
      ? c.trust.labels
      : c.trust.labels.filter((l) => !hoisted.includes(l));
  const footer = hoisted.length > 0 ? `All of these: ${hoisted.join(". ")}.` : "";

  const lines: string[] = [];
  /**
   * The records that actually made it in, not how many.
   *
   * It was a count read back as `ranked.slice(0, used)`, which held only while
   * the loop below could never skip: it now can, because a parent record too
   * long for the reserved budget is stepped over rather than ending the run. A
   * prefix of `ranked` would then name the wrong records in `labels` and count
   * the wrong ones in `parent_used`.
   */
  const chosen: AnswerCandidate[] = [];
  let length = head.length + (footer ? footer.length + 1 : 0);
  const tail = input.forwardable ? `\n${SHARE_LINE}` : "";

  /**
   * One line of general information keeps its place, and the parents fill the
   * rest around it.
   *
   * ## Why a reservation and not simply an ordering
   *
   * Public candidates rank last, deliberately — a parent-backed record always
   * outranks a page. But "last" and "dropped" are the same thing against a fixed
   * budget: measured live, three parent records filled all 459 characters and
   * the web result never once reached a parent, so the feature existed and
   * produced nothing. The client asked for an answer that carries **both**, and
   * both is not a preference the budget can be left to break.
   *
   * So while the loop is on parent-backed records the budget is short by the
   * cost of the first public line, and that line is then allowed the full
   * budget. Public candidates sort last, so this reads in one pass.
   *
   * ⚠ The reservation is **one** line, whatever the search found. Two would buy
   * a second page at the price of a second parent, and a parent is the thing the
   * answer is for.
   */
  /**
   * ⚠ **Every public line is reserved for, not just the first** (9 Sep).
   *
   * The client's instruction is that an answer carries general information *and*
   * what parents backed — *"має бути як паблік інфа, так і від батьків"* — so a
   * public line losing a race against a long parent quote is the feature not
   * working. Reserving only the first meant a second one was dropped silently
   * whenever the parents' half ran long.
   */
  const publicOnes = ranked.filter((c) => c.trust.public_only);
  const reserved =
    publicOnes.reduce(
      (sum, c) => sum + line(c, publicOnly ? perLine(c) : []).length + 1,
      0,
    ) + (publicOnes.length > 0 && !publicOnly ? PUBLIC_HEADING_COST : 0);

  /**
   * The lead is the first parent-backed record, and it is the only one rendered
   * in depth (9 Sep, the client's choice).
   *
   * Identified by identity rather than by index, because the loop below can skip
   * a record that does not fit — so "the first one that was actually rendered"
   * and "`ranked[0]`" are different things, and the deep block must go to the
   * one the reader sees.
   */
  const leadOf = ranked.find((c) => !c.trust.public_only) ?? null;
  let leadRendered = false;
  /* The heading is written once, and never when the whole answer is public —
     `head` already says it there, and saying it twice is worse than not at all. */
  let publicOpened = publicOnly;
  /* Collected during the loop and joined into one line after it. */
  const alsoParts: string[] = [];
  const tipLines: string[] = [];

  for (const candidate of ranked) {
    const isLead = candidate === leadOf && !leadRendered;
    const rendered = isLead
      ? leadBlock(candidate, extrasOf(perLine(candidate)))
      : candidate.trust.public_only
        ? /* No label on the line: the heading above it carries the only one it
             has, and repeating it under its own heading is noise. */
          line(candidate, publicOnly ? perLine(candidate) : [])
        : alsoLine(candidate);
    const cost = rendered.length + 1;
    /* The reserve applies to everything ahead of the public line and is released
       for the line it was held for. */
    const ceiling = candidate.trust.public_only ? SMS_BUDGET : SMS_BUDGET - reserved;
    if (length + cost + tail.length > ceiling) {
      if (candidate.trust.public_only) break;
      /* A parent record that does not fit is skipped rather than ending the
         loop: a shorter one behind it may still fit, and the public line it is
         making room for certainly does. */
      continue;
    }
    /**
     * ⚠ **The two kinds of material are separated by a blank line and a heading
     * of their own** (9 Sep), because the strategy's rule is that an answer
     * "always says which is which". As one flat list a page read as the third
     * recommendation with a label after it — the same shape as a parent's
     * record, distinguished only by a trailing sentence nobody reads to the end.
     *
     * The heading is `TRUST_LABEL.PUBLIC` **verbatim**, taken from the labels
     * 5.6 computed rather than written here: it is approved copy, it is
     * invariant 4's guard, and a heading is a stronger place to say it than a
     * suffix. Each line under it then drops the label it would have repeated.
     */
    if (candidate.trust.public_only && !publicOpened) {
      lines.push(`\n${candidate.trust.labels.join(". ")}:`);
      publicOpened = true;
    }
    /* The secondary records share one "Also nearby:" line rather than each
       opening their own — see `alsoPart`. Held aside and joined after the loop,
       because how many fit is not known until it has run. */
    if (!isLead && !candidate.trust.public_only) {
      /* A tip is not an alternative, so it neither takes an `ALSO_LIMIT` slot
         nor joins that line — see `tipPart`. With nothing to say it is dropped
         rather than sent as a filing label. */
      if (candidate.kind === "tip") {
        if (tipLines.length >= TIP_LIMIT) continue;
        const said = tipPart(candidate);
        if (said === null) continue;
        tipLines.push(said);
        length += cost;
        chosen.push(candidate);
        continue;
      }
      if (alsoParts.length >= ALSO_LIMIT) continue;
      const part = alsoPart(candidate);
      if (part === null) continue;
      alsoParts.push(part);
      length += cost;
      chosen.push(candidate);
      continue;
    }
    lines.push(rendered);
    length += cost;
    chosen.push(candidate);
    if (isLead) leadRendered = true;
  }

  /**
   * One record does not need a footer, and reads worse with one: a line saying
   * "All of these" about a single thing is a shared claim with nothing to share
   * it with. Rendered again with its own labels, which is cheaper than it looks
   * — the loop above has already told us the record fits.
   */
  /* One line for all of them, inserted where the first of them would have
     gone: after the lead block and before any public heading. */
  /* Both go where the first secondary record would have: after the lead block
     and before any public heading. The alternatives first, then the tip, so the
     comparison stays together and the aside follows it. */
  const trailing = [
    ...(alsoParts.length > 0 ? [`Also nearby: ${alsoParts.join("; ")}.`] : []),
    ...tipLines,
  ];
  if (trailing.length > 0) {
    const at = lines.findIndex((l) => l.startsWith("\n"));
    if (at === -1) lines.push(...trailing);
    else lines.splice(at, 0, ...trailing);
  }

  const collapse = chosen.length === 1 && footer !== "";
  if (collapse) {
    lines.length = 0;
    lines.push(
      chosen[0] === leadOf
        ? leadBlock(chosen[0], extrasOf(chosen[0].trust.labels))
        : line(chosen[0], chosen[0].trust.labels),
    );
  }

  /* Everything was too long to fit even once. Send the best one alone rather than
     an opening sentence with nothing under it. */
  if (lines.length === 0) {
    const only =
      ranked[0] === leadOf
        ? leadBlock(ranked[0], extrasOf(ranked[0].trust.labels))
        : line(ranked[0], ranked[0].trust.labels);
    lines.push(only.slice(0, SMS_BUDGET - head.length - tail.length - 2));
    chosen.push(ranked[0]);
  }

  const used = chosen.length;

  /**
   * The next step.
   *
   * Offering a Network Ask when Pando already answered well would be selling
   * something the parent does not need; not offering when the answer is thin is
   * leaving them without the thing that would help. The line is drawn at whether
   * any *parent-backed* record made it in — public information is an answer, but
   * it is not the answer they came for.
   */
  const parentUsed = chosen.filter((c) => !c.trust.public_only).length;

  const next_step: NextStep =
    input.can_offer_blast === false
      ? "none"
      : publicOnly || parentUsed < 2
        ? "offer_blast"
        : "none";

  const offer =
    next_step === "offer_blast"
      ? "\nWant me to ask a few nearby parents for more?"
      : "";

  return {
    /* The footer sits under the records and above anything offered, because it
       describes them and not the offer. Dropped when a single record collapsed
       back to carrying its own labels. */
    text: `${head ? `${head}\n` : ""}${lines.join("\n")}${
      footer && !collapse ? `\n${footer}` : ""
    }${offer}${tail}`,
    next_step,
    public_only: publicOnly,
    used,
    parent_used: parentUsed,
    used_ids: chosen.map((c) => c.id).filter((id): id is string => typeof id === "string" && id !== ""),
    labels: [...new Set(chosen.flatMap((c) => c.trust.labels))],
  };
}

/**
 * The check an acceptance test — and 5.8's review queue — runs on a finished
 * answer.
 *
 * It asks the one question that matters: **does this text claim a parent stands
 * behind something no parent stands behind?** Cheap, and it catches the failure
 * that would otherwise only show up as a parent acting on a recommendation that
 * was never made.
 *
 * ## Why it is *given* the labels
 *
 * It would be shorter to import `TRUST_LABEL` — and that would make this module
 * unloadable in a plain node test, because `import type` is erased while a value
 * import is not. `matching.ts` learned the same thing the same way, and the
 * property is worth protecting: this is the file that decides what Pando says to
 * a parent, so it has to be testable exhaustively without a server.
 *
 * Copying the three strings in here instead would be worse than either: approved
 * copy in two places is exactly what invariant 3 forbids. So the caller passes
 * them, from the one file that holds them.
 */
export function claimsAParent(text: string, parentLabels: readonly string[]): boolean {
  return parentLabels.some((l) => text.includes(l));
}

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
   * ⚠ Structured fields only, and that boundary is invariant 11.4's: this type
   * has **no free-text field at all**, so a named person in a parent's note
   * cannot structurally reach another parent. Adding "what the parent said" here
   * would open exactly the hole the absence closes.
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
  trust: TrustLabels;
  firsthand_count: number;
  /** §17.1 — an admin marked it complete enough to answer with. */
  answer_ready?: boolean;
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
export const SMS_BUDGET = 459;

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
  const cost = money ? ` ${money}.` : "";

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
  const head = publicOnly
    ? "Here's what I can tell you. This is general information, not from a parent:"
    : "Here's what local parents have shared:";

  /**
   * The labels every record shares come out of the lines and go under them once.
   *
   * `footer` is budgeted like a line because it is one; the connective is ours
   * rather than approved copy, and it is deliberately colourless — the labels do
   * the talking and a sentence introducing them would be a gloss on wording
   * nobody may gloss.
   */
  const hoisted = sharedLabels(ranked);
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
  const firstPublic = ranked.find((c) => c.trust.public_only);
  const reserved = firstPublic ? line(firstPublic, perLine(firstPublic)).length + 1 : 0;

  for (const candidate of ranked) {
    const rendered = line(candidate, perLine(candidate));
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
    lines.push(rendered);
    length += cost;
    chosen.push(candidate);
  }

  /**
   * One record does not need a footer, and reads worse with one: a line saying
   * "All of these" about a single thing is a shared claim with nothing to share
   * it with. Rendered again with its own labels, which is cheaper than it looks
   * — the loop above has already told us the record fits.
   */
  const collapse = chosen.length === 1 && footer !== "";
  if (collapse) {
    lines.length = 0;
    lines.push(line(chosen[0], chosen[0].trust.labels));
  }

  /* Everything was too long to fit even once. Send the best one alone rather than
     an opening sentence with nothing under it. */
  if (lines.length === 0) {
    const only = line(ranked[0], ranked[0].trust.labels);
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
    text: `${head}\n${lines.join("\n")}${
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

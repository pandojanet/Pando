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
  name: string;
  venue?: string | null;
  kind: string;
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
  /** Every label that appears, for the acceptance checks and the admin queue. */
  labels: string[];
}

/**
 * The length budget.
 *
 * An SMS segment is 160 GSM-7 characters, and 153 once a message is split. Two
 * segments is the most an answer should ever be: the strategy's own example
 * answer is about that long, and the product's whole claim is that it reads like
 * a person texting rather than like a newsletter.
 *
 * The budget is enforced by **dropping whole records**, never by truncating a
 * sentence mid-word — an answer that ends in "recommended by three par" is worse
 * than one that mentions two places.
 */
export const SMS_BUDGET = 306;

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
function line(candidate: AnswerCandidate): string {
  const where = candidate.venue ? ` (${candidate.venue})` : "";
  const claims = candidate.trust.labels.join(" · ");
  const age =
    candidate.trust.freshness === "fresh"
      ? ""
      : candidate.trust.freshness === "ageing"
        ? " — worth checking it hasn't changed"
        : " — this one is old, so treat it as a starting point";
  return `${candidate.name}${where}: ${claims}${age}`;
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
export const SHARE_LINE = "— from Pando, where local parents answer. Text this number to ask your own.";

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
        : "I don't have anything from local parents on this yet — want me to ask a few nearby who might?",
      next_step: input.can_offer_blast === false ? "human_review" : "offer_blast",
      public_only: false,
      used: 0,
      labels: [],
    };
  }

  const parentBacked = ranked.filter((c) => !c.trust.public_only);
  const publicOnly = parentBacked.length === 0;

  /**
   * The opening sentence.
   *
   * It never counts records the answer will not go on to mention, and it never
   * says "parents" about public information — that is the guard from 5.6 arriving
   * in the prose, where it would otherwise be easiest to lose.
   */
  const head = publicOnly
    ? "Here's what I can tell you — this is general information, not from a parent:"
    : parentBacked.length === 1
      ? "One local parent has shared something on this:"
      : `${parentBacked.length} local parents have shared something on this:`;

  const lines: string[] = [];
  let used = 0;
  let length = head.length;
  const tail = input.forwardable ? `\n${SHARE_LINE}` : "";

  for (const candidate of ranked) {
    const rendered = line(candidate);
    const cost = rendered.length + 1;
    if (length + cost + tail.length > SMS_BUDGET) break;
    lines.push(rendered);
    length += cost;
    used += 1;
  }

  /* Everything was too long to fit even once. Send the best one alone rather than
     an opening sentence with nothing under it. */
  if (lines.length === 0) {
    const only = line(ranked[0]);
    lines.push(only.slice(0, SMS_BUDGET - head.length - tail.length - 2));
    used = 1;
  }

  /**
   * The next step.
   *
   * Offering a Network Ask when Pando already answered well would be selling
   * something the parent does not need; not offering when the answer is thin is
   * leaving them without the thing that would help. The line is drawn at whether
   * any *parent-backed* record made it in — public information is an answer, but
   * it is not the answer they came for.
   */
  const next_step: NextStep =
    input.can_offer_blast === false
      ? "none"
      : publicOnly || used < 2
        ? "offer_blast"
        : "none";

  const offer =
    next_step === "offer_blast"
      ? "\nWant me to ask a few nearby parents for more?"
      : "";

  return {
    text: `${head}\n${lines.join("\n")}${offer}${tail}`,
    next_step,
    public_only: publicOnly,
    used,
    labels: [...new Set(ranked.slice(0, used).flatMap((c) => c.trust.labels))],
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

import { isNothingToFlag } from "../contribution-quality";
import { cleanAges, cleanText } from "../sanitize";
import { canonicalPrompt, formatAnswer, isEmptyValue } from "./engine";
import { followUpMark } from "./scripts";
import {
  isClassifiedKind,
  subcategoryFor,
  type ClassifiedKind,
  type Subcategory,
} from "./subcategories";
import type { FieldValue, Fields, Script, Step } from "./types";

/**
 * `/api/seed/assist` — the pure half of the adaptive interview (9 Oct).
 *
 * The developer, after walking the first version: the questions came in the
 * script's fixed order, merely reworded, and nothing followed up a pasted
 * paragraph. So after **every** answer the server now asks the model one thing
 * with three parts, and this file decides what of it may be believed:
 *
 *  1. **A follow-up** about the answer just given — when it is empty, thin, or
 *     does not actually answer the question (a pasted blurb, the same text as
 *     another answer). Once per question (`followUpMark`).
 *  2. **Answers it already gave** — closed answers the parent's own words state
 *     outright ("our 4-year-old still goes" → age, whose experience, how
 *     recent). Closed answers only (`PREFILLABLE`): a sentence is never written
 *     for a parent, and each one is shown to them as noted.
 *  3. **The next question**, chosen from the steps still open (`candidateSteps`)
 *     and worded from everything said so far.
 *
 * ⚠ **The model chooses and words; the scripts decide what exists.** Every step
 * id, widget, option and column is the script's (`scripts.ts`), and what may be
 * asked next is decided here, not by the model: required questions before the
 * fork, the fork before the detail, the card's own last question last, and a
 * "why" only once the recommendation is known. An id the model names outside
 * that set is ignored and the first open step is asked in its own words.
 *
 * Every failure — no key, the switch off, a timeout — is `configured: false`,
 * and the chat carries on in the script's order with the rule-based follow-ups.
 */

/** Switch the classifier and the adaptive interview off without touching anything else. */
export const ASSIST_ENABLED = true;

/** Below this the sub-category is a guess, and a guess asks the wrong questions. */
export const CLASSIFY_THRESHOLD = 0.6;

/**
 * Closed answers the model may read off the parent's own words.
 *
 * ⚠ **Not the child's age** (9 Oct, the developer: *"there was a clear age
 * question with clear options, and you removed it"*). The model filled "Age at
 * the time: 9" from the profile on a card that never mentioned an age, and the
 * age question — with its own grid — was skipped. The age is always asked.
 */
export const PREFILLABLE = new Set(["firsthand", "visit_reason"]);
/*
 * ⚠ Nor how recent (the same walk, re-run): "our afternoon here" was filled as
 * "Within the last year", which the parent never said. Left are the two whose
 * words are unambiguous: whose experience it was, and what they saw a doctor for.
 */

/** One turn: what the chat sends after an answer. */
export interface TurnInput {
  kind: ClassifiedKind;
  /** True on the last context question: classify first. */
  classify: boolean;
  /** The sub-category already chosen (null = general), ignored when classifying. */
  subcategory: Subcategory | null;
  /** Everything answered so far, cleaned — never stored. */
  fields: Fields;
  /** The step just answered, which a follow-up would be about. */
  last_step: string | null;
  /** Steps already followed up once. */
  followed_up: string[];
  /** The parent's children's ages from the profile, for the wording. */
  child_ages: number[];
  /**
   * The parent may be addressed by name on this turn (12 Oct): the chat knows
   * a first name and has not used it on this card yet. The name itself is
   * never sent — see `NAME_TOKEN`.
   */
  may_name: boolean;
}

export interface TurnResult {
  /** False when nothing was asked of the model: the chat goes on by itself. */
  configured: boolean;
  subcategory: Subcategory | null;
  /** A follow-up about `last_step`, worded; null when none is due. */
  followup: string | null;
  /** Closed answers read off the parent's words. */
  prefill: Fields;
  /** The next step and its wording; null = the card is finished. */
  next: { id: string; prompt: string } | null;
  /**
   * A short reaction to the answer just typed, said before the next question
   * (9 Oct, iteration 1: the chat moved on as if nothing had been said). Null
   * after a tap, a follow-up, or when there is nothing worth saying.
   */
  ack?: string | null;
}

export const NOT_CONFIGURED: TurnResult = {
  configured: false,
  subcategory: null,
  followup: null,
  prefill: {},
  next: null,
  ack: null,
};

/* ── The request ─────────────────────────────────────────────────────────── */

function cleanFieldsForTurn(raw: unknown): Fields {
  const out: Fields = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (key.startsWith("__") || !/^[a-z_]{1,40}$/.test(key)) continue;
    if (typeof value === "string") {
      out[key] = cleanText(value, 400) ?? "";
    } else if (Array.isArray(value)) {
      if (value.every((v) => typeof v === "number")) out[key] = cleanAges(value);
      else
        out[key] = value
          .filter((v): v is string => typeof v === "string")
          .map((v) => cleanText(v, 80))
          .filter((v): v is string => v !== null)
          .slice(0, 20);
    }
  }
  return out;
}

/** The request body, cleaned, or null when it is not one. */
export function readTurnInput(body: unknown): TurnInput | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (typeof b.kind !== "string" || !isClassifiedKind(b.kind)) return null;
  return {
    kind: b.kind,
    classify: b.classify === true,
    subcategory: subcategoryFor(b.kind, b.subcategory),
    fields: cleanFieldsForTurn(b.fields),
    last_step: typeof b.last_step === "string" && /^[a-z_]{1,40}$/.test(b.last_step) ? b.last_step : null,
    followed_up: Array.isArray(b.followed_up)
      ? b.followed_up.filter((x): x is string => typeof x === "string" && /^[a-z_]{1,40}$/.test(x)).slice(0, 40)
      : [],
    child_ages: cleanAges(b.child_ages),
    may_name: b.may_name === true,
  };
}

/* ── Classification ──────────────────────────────────────────────────────── */

/** The classifier's answer, believed only when it is sure enough and in range. */
export function readClassification(
  kind: ClassifiedKind,
  raw: { subcategory?: unknown; confidence?: unknown } | null,
): Subcategory | null {
  if (!raw) return null;
  const confidence = typeof raw.confidence === "number" ? raw.confidence : 0;
  if (!(confidence >= CLASSIFY_THRESHOLD)) return null;
  return subcategoryFor(kind, raw.subcategory);
}

/**
 * The card's fields once it is classified. On the tip button the context answer
 * **is** the tip (`scripts.ts`), so it is copied into `tip` and never asked twice
 * — the chat and the server both apply it, so they agree on what is open.
 */
export function afterClassified(kind: string, subcategory: Subcategory | null, fields: Fields): Fields {
  if (kind === "tip" && subcategory !== "products" && typeof fields.what_is_it === "string" && !("tip" in fields)) {
    return { ...fields, tip: fields.what_is_it };
  }
  return fields;
}

/* ── What may come next ──────────────────────────────────────────────────── */

const WHY = new Set(["what_makes_it_great", "what_didnt_work"]);

function open(step: Step, fields: Fields): boolean {
  return !(step.id in fields) && (!step.when || step.when(fields));
}

/**
 * The steps that may be asked next, in the order the developer's rules allow:
 * required questions before anything optional, both before the fork, the
 * detail only behind it, and the card's own last question last. A "why" waits
 * for the recommendation, because which "why" is asked depends on it.
 */
export function candidateSteps(script: Script, fields: Fields): Step[] {
  const steps = script.steps;
  const fork = steps.findIndex((s) => s.id === "more_detail");
  const asksRecommendation = steps.some((s) => s.id === "recommendation");
  const ready = (s: Step) =>
    open(s, fields) && !(WHY.has(s.id) && asksRecommendation && !("recommendation" in fields));

  const before = steps.filter((s, i) => (fork < 0 || i < fork) && s.id !== "extra_note" && ready(s));
  const required = before.filter((s) => !s.optional);
  if (required.length > 0) return required;
  if (before.length > 0) return before;
  if (fork >= 0 && open(steps[fork], fields)) return [steps[fork]];
  const after = steps.filter((s, i) => fork >= 0 && i > fork && s.id !== "extra_note" && ready(s));
  if (after.length > 0) return after;
  const last = steps.find((s) => s.id === "extra_note" && open(s, fields));
  return last ? [last] : [];
}

/**
 * Steps whose answer the model may read off what the parent already said.
 *
 * A product's **name** too (9 Oct, the walk: "The UPPAbaby Vista stroller…" and
 * then "What's the product?"). It is the one text answer allowed, and only when
 * it appears word for word in what the parent typed (`readPrefillValue`) — a
 * name lifted from their sentence, never one written for them.
 */
export function prefillableSteps(script: Script, fields: Fields): Step[] {
  return script.steps.filter(
    (s) =>
      (PREFILLABLE.has(s.id) || (s.id === "name" && script.subcategory === "products")) &&
      open(s, fields),
  );
}

/** The answers so far, as the model reads them: the question, then the answer in words. */
export function transcriptOf(script: Script, fields: Fields): Array<{ id: string; question: string; answer: string }> {
  return script.steps
    .filter((s) => s.id in fields && !isEmptyValue(fields[s.id]))
    .map((s) => ({ id: s.id, question: s.prompt, answer: formatAnswer(s, fields[s.id] as FieldValue) }));
}

/* ── Reading the model's turn ────────────────────────────────────────────── */

const LINK = /https?:\/\/|www\.|\S+@\S+\.\w|\+?\d[\d\s().-]{6,}\d/i;

/**
 * A reworded question, or null when the canonical one should be used.
 *
 * One question, of a sensible length, that does not read out the step's own
 * options (the buttons do that) and carries no link, address or number a
 * parent could be steered to.
 */
export function acceptPrompt(canonical: string, candidate: unknown, step: Step): string | null {
  if (typeof candidate !== "string") return null;
  const text = candidate.replace(/\s+/g, " ").trim();
  if (text.length < 8) return null;
  if (text.length > Math.max(canonical.length * 2, 200)) return null;
  if (LINK.test(text)) return null;
  const marks = (text.match(/\?/g) ?? []).length;
  if (marks > 1) return null;
  if (canonical.trim().endsWith("?") && !text.endsWith("?")) return null;
  if (namesOptions(text, step)) return null;
  return text;
}

/* ── The parent's first name ─────────────────────────────────────────────── */

/**
 * Where the parent's first name goes (12 Oct, the developer: *"you can pull the
 * parent's name from context — why not use it in the dynamic chat?"*).
 *
 * ⚠ **The name never reaches the model, the server or a log.** The model writes
 * this token where it would address them; the chat, which already holds the
 * name on the device, puts it in (`fillName`). So a first name is not sent to a
 * third party to make a question warmer, and invariant 7 has nothing to guard.
 */
export const NAME_TOKEN = "{name}";

/**
 * Is every token a form of address — "Thanks, {name} — …", "{name}, what…",
 * "…, {name}?" — and never part of the sentence ("Is {name} still going?"),
 * which the name would not fit and which removing it would break?
 */
function nameAsAddress(text: string): boolean {
  return !text.replace(NAME_OPENING, "").replace(NAME_ASIDE, "").includes(NAME_TOKEN);
}

/** "{name}, what…" — the name opening the sentence. */
const NAME_OPENING = /^\{name\}\s*[,—–-]\s*/;
/** "Thanks, {name} — …", "…, {name}?" — the name set off by a comma or a dash. */
const NAME_ASIDE = /\s*[,—–-]\s*\{name\}(?=\s*[.,!?—–-]|\s*$)/g;

/** The tokens taken out, the sentence closed up — no capitalising. */
function dropName(text: string): string {
  return text
    .replace(NAME_OPENING, "")
    .replace(NAME_ASIDE, "")
    .replace(/\{name\}/g, "")
    .replace(/ {2,}/g, " ")
    .replace(/ +([.,!?])/g, "$1");
}

/** The text without the token, still a sentence ("Thanks, {name}." → "Thanks."). */
export function withoutName(text: string): string {
  const t = dropName(text).trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/**
 * The model's text with the name rule applied: when the parent may not be
 * named, the token is taken out; when they may, it is kept once and only as a
 * form of address. Null when the token sits inside the sentence ("Is {name}
 * still going?") — the caller then uses its own wording.
 */
export function readName(text: string, mayName: boolean): string | null {
  if (!text.includes(NAME_TOKEN)) return text;
  if (!nameAsAddress(text)) return null;
  if (!mayName) return withoutName(text);
  const end = text.indexOf(NAME_TOKEN) + NAME_TOKEN.length;
  return text.slice(0, end) + dropName(text.slice(end));
}

/**
 * Is this the turn to address them by name? (12 Oct, first harness run: told
 * only that it *may*, the model never once did.) Once a card, where it reads
 * as warmth rather than a tic: a follow-up the rule already wants, or right
 * after they wrote something of substance.
 */
export function nameThisTurn(mayName: boolean, lastStep: Step | null, fields: Fields, followUpDue: boolean): boolean {
  /* Not straight after the context question (second run: every card opened
     "Dana, how old was…", the same words in the same place each time). */
  if (!mayName || !lastStep || lastStep.classifyAfter) return false;
  if (followUpDue) return true;
  return substantial(lastStep, fields);
}

/** They wrote something of substance to this step. */
function substantial(step: Step | null, fields: Fields): boolean {
  const answer = step ? fields[step.id] : undefined;
  return step?.widget === "text" && typeof answer === "string" && answer.trim().length >= 40;
}

/**
 * The name put in front when the model left it out: "Thanks, {name} — …" after
 * something they wrote, "{name}, …" before a follow-up.
 */
function addressed(text: string, thanks: boolean): string {
  const first = /^([A-Z])(?=[a-z' ])/.test(text) && !/^I\b/.test(text) ? text.charAt(0).toLowerCase() + text.slice(1) : text;
  return thanks ? `Thanks, ${NAME_TOKEN} — ${first}` : `${NAME_TOKEN}, ${first}`;
}

/** The chat's half: the name in, or the token out when there is no name. */
export function fillName(text: string, firstName: string | null | undefined): string {
  const name = (firstName ?? "").trim();
  return name ? text.split(NAME_TOKEN).join(name) : withoutName(text);
}

/** Does the text read out two or more of the step's own buttons? */
function namesOptions(text: string, step: Step): boolean {
  /* Compared without punctuation: "Yes with caveats" names "Yes, with caveats". */
  const plain = (v: string) =>
    ` ${v.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9$]+/g, " ").trim()} `;
  const labels = (step.options ?? []).map((o) => plain(o.label)).filter((l) => l.trim().length > 3);
  return labels.length > 0 && labels.filter((l) => plain(text).includes(l)).length >= 2;
}

/** Everything the parent typed on this card. */
function saidOn(fields: Fields): string {
  return Object.entries(fields)
    .filter(([k, v]) => typeof v === "string" && !k.startsWith("__"))
    .map(([, v]) => v as string)
    .join(" ");
}

/** One prefilled answer, believed only in the step's own vocabulary. */
function readPrefillValue(step: Step, raw: unknown, said: string): FieldValue | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (step.widget === "text") {
    /* Only a product's name, and only as the parent wrote it. */
    const name = cleanText(value, 80);
    return name && name.length >= 2 && said.toLowerCase().includes(name.toLowerCase()) ? name : null;
  }
  if (step.widget === "ages") {
    const ages = cleanAges(value.split(/[,\s]+/).filter(Boolean).map(Number));
    return ages.length > 0 ? ages : null;
  }
  if (step.widget === "quick") {
    return step.options?.some((o) => o.id === value) ? value : null;
  }
  if (step.widget === "chips") {
    const ids = value.split(/[,\s]+/).filter((id) => step.options?.some((o) => o.id === id));
    return ids.length > 0 ? ids : null;
  }
  return null;
}

/**
 * The model's turn, checked. `ruleFollowUp` is the rule-based follow-up for the
 * step just answered (`followUpFor`) — it stands even when the model says no,
 * so the chat never asks less than the rule would.
 */
export function readTurn(
  raw: {
    followup?: { needed?: unknown; text?: unknown } | null;
    prefill?: unknown;
    next?: { id?: unknown; question?: unknown } | null;
    ack?: unknown;
  } | null,
  ctx: {
    script: Script;
    fields: Fields;
    lastStep: Step | null;
    mayFollowUp: boolean;
    ruleFollowUp: string | null;
    /** Address the parent by name on this turn (`nameThisTurn`), once. */
    mayName?: boolean;
  },
): {
  followup: string | null;
  prefill: Fields;
  next: { id: string; prompt: string } | null;
  ack: string | null;
} {
  const { script, lastStep } = ctx;
  /* The name once in a turn: the reaction and the question share one bubble,
     so whichever is said first keeps it; if the model left it out, the text
     that is said gets it in front (`addressed`). */
  let nameLeft = ctx.mayName === true;
  const personal = (text: string | null): string | null => (text === null ? null : readName(text, nameLeft));
  const spoken = (text: string): string => {
    if (text.includes(NAME_TOKEN)) nameLeft = false;
    return text;
  };
  const addressOnce = (text: string, thanks = false): string => {
    if (!nameLeft || text.includes(NAME_TOKEN)) return spoken(text);
    nameLeft = false;
    return addressed(text, thanks);
  };

  /* 1. The follow-up — about the answer just given, once. "Nothing to flag" is
     a complete answer to the caveat, whatever the model says (9 Oct, the walk:
     it followed one up with a question about something else). */
  const lastAnswer = lastStep ? ctx.fields[lastStep.id] : undefined;
  const nothingToFlag =
    lastStep?.id === "caveat" && typeof lastAnswer === "string" && isNothingToFlag(lastAnswer);
  if (ctx.mayFollowUp && lastStep?.followUp && !nothingToFlag) {
    const modelSaysYes = raw?.followup?.needed === true;
    const offered = personal(acceptFollowUp(raw?.followup?.text, lastStep));
    /* After a skip they said nothing: "You mentioned the setup — …" (12 Oct,
       the simulated chats) quotes words that were never written. */
    const skipped = typeof lastAnswer !== "string" || lastAnswer.trim() === "";
    const worded = offered && skipped && SAID_BACK.test(withoutName(offered)) ? null : offered;
    /**
     * Iteration 1 (9 Oct): when the rule asks (an empty or thin answer), the
     * model's wording is used — it can name what they actually said — and the
     * canonical one only if it gave none. When only the model asks, its
     * follow-up must be **about this question** (`onTopic`): the walk got
     * "What did your twins enjoy most?" as a follow-up to "what to know first".
     */
    if (ctx.ruleFollowUp) {
      const own = worded && onTopic(worded, lastStep) ? worded : null;
      return { followup: addressOnce(own ?? ctx.ruleFollowUp), prefill: {}, next: null, ack: null };
    }
    if (modelSaysYes && worded && onTopic(worded, lastStep)) {
      return { followup: addressOnce(worded), prefill: {}, next: null, ack: null };
    }
  }

  /* 2. Closed answers the parent's words already gave. */
  const prefill: Fields = {};
  const prefillable = new Map(prefillableSteps(script, ctx.fields).map((s) => [s.id, s]));
  const said = saidOn(ctx.fields);
  if (Array.isArray(raw?.prefill)) {
    for (const item of raw.prefill as Array<{ id?: unknown; value?: unknown }>) {
      if (!item || typeof item.id !== "string") continue;
      const step = prefillable.get(item.id);
      if (!step) continue;
      const value = readPrefillValue(step, item.value, said);
      if (value !== null) prefill[step.id] = value;
    }
  }

  /* 3. The next question, from what is open once those are in. */
  const fields = { ...ctx.fields, ...prefill };
  const candidates = candidateSteps(script, fields);
  /* A reaction only to something they typed, and only a safe one. */
  /* Never the name inside the reaction ("Dana, so parents need to be ready…"
     read as a slip, 12 Oct): the question carries it. */
  const read = lastStep?.widget === "text" ? acceptAck(raw?.ack, lastAnswer) : null;
  const ack = read === null ? null : readName(read, false);
  if (candidates.length === 0) return { followup: null, prefill, next: null, ack };
  const named = typeof raw?.next?.id === "string" ? candidates.find((s) => s.id === raw.next?.id) : undefined;
  const step = named ?? candidates[0];
  const canonical = canonicalPrompt(step, fields);
  /**
   * ⚠ **Only a typed question is reworded** (9 Oct, the developer, after the
   * walk). A question answered with buttons keeps its own words — "Are they
   * still taking it?" came back as "Is the studio still offering the workshop?",
   * and the buttons no longer answered it. Her fixed sentences (the fork and
   * the card's last question) are never reworded either. A typed question's
   * rewording must still carry its own words (`keepsMeaning`): "What would you
   * buy instead?" came back as "Anything else to know about the Vista?".
   */
  /*
   * Iteration 1 (9 Oct, the developer: "I haven't noticed strong changes"): a
   * question with buttons may be personalised too — the name, who it was for —
   * but only if **every** one of its own words is still there (`keepsMeaning`
   * at 1.0), which is exactly what "Is the studio still offering the workshop?"
   * failed. A typed question keeps at least half. Her fixed sentences never.
   */
  const fixed = step.id === "more_detail" || step.id === "extra_note";
  const offered = named && !fixed ? personal(acceptPrompt(canonical, raw?.next?.question, step)) : null;
  const need = step.widget === "text" ? 0.5 : 1;
  const worded = offered && keepsMeaning(canonical, withoutName(offered), need) ? offered : null;
  /* Her fixed sentences are not addressed either. */
  const prompt = fixed
    ? spoken(worded ?? canonical)
    : addressOnce(worded ?? canonical, ack === null && substantial(lastStep, ctx.fields));
  return { followup: null, prefill, next: { id: step.id, prompt }, ack };
}

/** A follow-up quoting the parent — wrong when the answer was skipped. */
const SAID_BACK = /\byou (said|mentioned|told|noted|wrote)\b/i;

/** Words that turn a reaction into flattery (iteration 2, 9 Oct). */
const PRAISE =
  /\b(great|nice|wonderful|lovely|perfect|amazing|awesome|fantastic|impressive|real (progress|durability)|love that|sounds like|drew you)\b/i;

/**
 * A reaction to the last answer, or null. One short sentence that reflects a
 * fact back — not a question, not a compliment, nothing a parent could be
 * steered by (no link, number or address).
 */
export function acceptAck(raw: unknown, answer?: unknown): string | null {
  if (typeof raw !== "string") return null;
  const text = raw.replace(/\s+/g, " ").trim();
  if (text.length < 6 || text.length > 110) return null;
  if (text.includes("?") || LINK.test(text) || PRAISE.test(text)) return null;
  /* A lead-in cut off mid-thought ("You made bowls together — "). */
  if (/[—–,:-]$/.test(text)) return null;
  /* Their own sentence handed back with "— got it" (12 Oct, the second run:
     "A very independent kid — got it."): an echo, not a reaction. */
  const echo = text.match(/^(.*?)\s*[—–,-]\s*(got it|noted)\.?$/i);
  if (echo && typeof answer === "string" && answer.toLowerCase().includes(echo[1].toLowerCase().replace(/[.!]$/, ""))) return null;
  return text;
}

/**
 * A follow-up in the model's words, or null. Looser than a question's wording
 * (iteration 2: the model writes "You said it's nice — what about…? Was it…?",
 * and the one-question rule threw every such follow-up away for the generic
 * one): up to two questions, a sensible length, no link or number, and not a
 * read-out of the step's buttons.
 */
export function acceptFollowUp(raw: unknown, step: Step): string | null {
  if (typeof raw !== "string") return null;
  const text = raw.replace(/\s+/g, " ").trim();
  if (text.length < 12 || text.length > 260) return null;
  if (LINK.test(text) || (text.match(/\?/g) ?? []).length > 2) return null;
  return namesOptions(text, step) ? null : text;
}

/**
 * What each follow-up-able question is about, as words a follow-up on it would
 * use (iteration 5, 9 Oct: matching the question's own words threw away "You
 * said she's great — what does she do well with your daughter?" for the
 * generic one). A step not listed falls back to sharing one of its own words.
 */
const TOPIC: Record<string, RegExp> = {
  what_makes_it_great: /\b(like|love|good|great|stood|stand|enjoy|special|well|work|made|make|best|favou?rite)/i,
  what_didnt_work: /\b(work|didn|wrong|fit|happen|issue|problem|bad|go)/i,
  caveat: /\b(know|before|watch|flag|expect|book|wait|heads|tip|warn)/i,
  who_for: /\b(who|kind of|which kids|age|suit|fit|best for|thrive|send|good for)/i,
  timing_note: /\b(when|time|day|hour|morning|afternoon|evening|busy|crowd|quiet)/i,
  tip: /\b(tip|do|know|when|how|specific|name|time)/i,
};

/** Is a follow-up about this question? */
export function onTopic(followup: string, step: Step): boolean {
  const topic = TOPIC[step.id];
  if (topic) return topic.test(followup);
  const own = new Set([...stems(step.prompt), ...stems(step.followUp?.ask ?? "")]);
  return stems(followup).some((w) => own.has(w));
}

const STOP = new Set([
  "what", "when", "where", "which", "would", "could", "should", "your", "their", "there", "about",
  "with", "that", "this", "they", "them", "were", "have", "been", "from", "into", "anything",
  "something", "another", "parent", "parents", "other", "child", "children", "kids",
]);

function stems(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z\s]+/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !STOP.has(w))
    .map((w) => w.slice(0, 5));
}

/**
 * Does a rewording still ask the same thing? At least half of the original's
 * own words (short stems, without the words every question shares) must still
 * be there. Crude by design: it refuses a question that drifted to another
 * subject, and a refusal only costs the canonical wording.
 */
export function keepsMeaning(canonical: string, reworded: string, share = 0.5): boolean {
  const own = [...new Set(stems(canonical))];
  /* Nothing to hold on to ("What's it about?"): a typed question may be
     reworded, a question with buttons may not (12 Oct: the tip's topic came
     back as "Which city rec classes are you talking about — schedules, costs…"). */
  if (own.length === 0) return share < 1;
  const said = new Set(stems(reworded));
  return own.filter((w) => said.has(w)).length / own.length >= share;
}

/** Which steps have been followed up, from the chat's own markers. */
export function followedUpIds(fields: Fields): string[] {
  return Object.keys(fields)
    .filter((k) => k.startsWith("__fu_"))
    .map((k) => k.slice("__fu_".length));
}

/** The markers back, for the rule-based follow-up on the server. */
export function withFollowUpMarks(fields: Fields, ids: readonly string[]): Fields {
  const out: Fields = { ...fields };
  for (const id of ids) out[followUpMark(id)] = "yes";
  return out;
}

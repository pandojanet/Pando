import { isNothingToFlag } from "../contribution-quality";
import { cleanAges, cleanText } from "../sanitize";
import { canonicalPrompt, formatAnswer, isEmptyValue } from "./engine";
import { followUpMark } from "./scripts";
import {
  isClassifiedKind,
  subcategoryFor,
  unsureSubcategory,
  type ClassifiedKind,
  type Subcategory,
} from "./subcategories";
import type { ChatMessage, FieldValue, Fields, Script, Step } from "./types";

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
  /**
   * The parent's own neighbourhood is known on the device (12 Oct, the
   * developer: "pull the parent's neighbourhood from their profile, not a
   * random one"). Like the name, only that it exists is sent: the model writes
   * `AREA_TOKEN` and the chat fills it in.
   */
  has_area: boolean;
  /**
   * Pando's reactions on the last turns of this card, oldest first, "" where it
   * said none (12 Oct): a model that never sees its last reaction opens every
   * one with "That's wonderful".
   */
  recent_reactions: string[];
  /**
   * The chat on this card so far, as the parent saw it (12 Oct, the developer:
   * *"why does the model not keep the context of the conversation?"*): the
   * structured answers alone left it blind to its own questions, reactions and
   * follow-ups. Context for the wording only — data is read from `fields`.
   * Never carries the parent's name (`conversationOf`).
   */
  conversation: Line[];
}

export interface Line {
  who: "pando" | "parent";
  text: string;
}

/** How much of a card's chat a turn carries — far more than any card asks. */
const CONVERSATION_LINES = 40;
const LINE_CHARS = 500;

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
    has_area: b.has_area === true,
    conversation: Array.isArray(b.conversation)
      ? b.conversation
          .filter(
            (x): x is Line =>
              !!x && typeof x === "object" && ((x as Line).who === "pando" || (x as Line).who === "parent") && typeof (x as Line).text === "string",
          )
          .slice(-CONVERSATION_LINES)
          .map((x) => ({ who: x.who, text: x.text.replace(/\s+/g, " ").trim().slice(0, LINE_CHARS) }))
          .filter((x) => x.text !== "")
      : [],
    recent_reactions: Array.isArray(b.recent_reactions)
      ? b.recent_reactions
          .slice(-3)
          .map((x) => (typeof x === "string" ? x.replace(/\s+/g, " ").trim().slice(0, 200) : ""))
      : [],
  };
}

/* ── Classification ──────────────────────────────────────────────────────── */

/**
 * The classifier's answer, believed only when it is sure enough and in range.
 * Unsure, it is the button's fallback (`unsureSubcategory`: specialists on the
 * Specialists & Doctors button, 12 Oct). No reply at all is still null here —
 * the chat applies the same fallback when the turn fails.
 */
export function readClassification(
  kind: ClassifiedKind,
  raw: { subcategory?: unknown; confidence?: unknown } | null,
): Subcategory | null {
  if (!raw) return null;
  const confidence = typeof raw.confidence === "number" ? raw.confidence : 0;
  const sure = confidence >= CLASSIFY_THRESHOLD ? subcategoryFor(kind, raw.subcategory) : null;
  return sure ?? unsureSubcategory(kind);
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
  /* The age before the opinions (12 Oct: asked last, it came out as "is he
     still that age?"). The prompt asks for facts first; this makes it so. */
  if (required.some((s) => s.id === "child_age")) {
    return required.filter((s) => !WHY.has(s.id) && s.id !== "caveat");
  }
  if (required.length > 0) return required;
  if (before.length > 0) return before;
  if (fork >= 0 && open(steps[fork], fields)) return [steps[fork]];
  /* The unit straight after the price (12 Oct: asked three turns later it read
     as a new subject, and "worth it" came before the price was whole). */
  const unit = steps.find((s) => s.id === "price_unit" && ready(s));
  if (unit && "price_band" in fields) return [unit];
  const after = steps.filter((s, i) => fork >= 0 && i > fork && s.id !== "extra_note" && ready(s));
  if (after.length > 0) return after;
  const last = steps.find((s) => s.id === "extra_note" && open(s, fields));
  return last ? [last] : [];
}

/** Her fixed sentences — the fork and the card's last question — said exactly as they are. */
export function isFixedStep(step: Step): boolean {
  return step.id === "more_detail" || step.id === "extra_note";
}

/**
 * What the model has to write on a turn — the rest is never read, and every
 * token it writes is ~13 ms the parent waits (12 Oct, measured: 45 more
 * tokens out cost 640 ms; 2,000 more tokens in cost nothing measurable).
 *
 *  - **A follow-up the rule already wants** is all the turn can say: `readTurn`
 *    returns it alone, so a next question and a reaction were ~35 tokens
 *    written to be thrown away.
 *  - **Only her fixed sentence can come next**: it is said as it is, so only
 *    the line before it is the model's. The question it wrote was discarded.
 *
 * Not on a classifying turn: a card classified as a product drops the tip's
 * follow-up and needs its next question after all (`describedProduct`).
 */
export function turnNeeds(
  candidates: readonly Step[],
  ruleFollowUp: boolean,
  classify: boolean,
): { next: boolean; ack: boolean; prefill: boolean } {
  if (ruleFollowUp && !classify) return { next: false, ack: false, prefill: false };
  const fixedOnly = !classify && candidates.length > 0 && candidates.every(isFixedStep);
  return { next: !fixedOnly, ack: true, prefill: true };
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

/**
 * This card's chat, for the model (12 Oct): every message since the parent
 * tapped the card's button, plus `said` — what they have just sent, which is
 * not on screen yet when the turn starts.
 *
 * ⚠ **The parent's first name is put back as `NAME_TOKEN`** in Pando's lines,
 * where the chat filled it in, so the name still never leaves the device.
 */
export function conversationOf(
  messages: readonly ChatMessage[],
  cardLabel: string,
  firstName: string | null,
  said?: string,
  area?: string | null,
): Line[] {
  let start = -1;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (m.role === "parent" && !m.step_id && m.text === cardLabel) {
      start = i;
      break;
    }
  }
  const name = (firstName ?? "").trim();
  const swap = (text: string, word: string, tok: string) =>
    word ? text.replace(new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g"), tok) : text;
  const home = (area ?? "").trim();
  /* The area too, where Pando said it (12 Oct): it never leaves the device either. */
  const token = (text: string) => swap(swap(text, name, NAME_TOKEN), home, AREA_TOKEN);
  const lines: Line[] = messages
    .slice(start + 1)
    .filter((m) => typeof m.text === "string" && m.text.trim() !== "" && !m.card && !m.invite)
    .map((m) =>
      m.role === "pando"
        ? { who: "pando" as const, text: token(m.text as string) }
        : { who: "parent" as const, text: m.skipped ? "(skipped)" : (m.text as string) },
    );
  if (said !== undefined) lines.push({ who: "parent", text: said.trim() === "" ? "(skipped)" : said });
  return lines.slice(-CONVERSATION_LINES).map((l) => ({ ...l, text: l.text.slice(0, LINE_CHARS) }));
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
 * The parent's own neighbourhood, as the model writes it (12 Oct). Allowed only
 * in the town question ("Is it in {area}, near you, or somewhere else?"); the
 * chat fills it in from the profile, so the area never leaves the device.
 */
export const AREA_TOKEN = "{area}";

/** The town question when their area is known and the model's own wording was not kept. */
export const AREA_PROMPT = `Is it in ${AREA_TOKEN}, near you, or somewhere else?`;

/** The chat's half: the area in. A token with no area to fill means the line is not said. */
export function fillArea(text: string, area: string | null | undefined): string | null {
  if (!text.includes(AREA_TOKEN)) return text;
  const a = (area ?? "").trim();
  return a ? text.split(AREA_TOKEN).join(a) : null;
}

/**
 * A question with this many buttons or fewer has the turn after each button
 * asked ahead while it is on screen (`ChatSeeding`, 12 Oct). More (a price
 * band, a topic) would be more calls than the second it saves is worth.
 */
export const PREFETCH_MAX_OPTIONS = 5;

/**
 * An answer typed or picked but not sent yet is asked ahead too (12 Oct, the
 * developer: *"reduce the time, keep the personalisation, no streaming"*): once
 * the parent stops typing for `typed` ms — or `picked` ms after a tap on an age
 * or a town — the turn for exactly that answer is asked, and Send uses it if
 * nothing changed. A tap is a decision, so it waits less than a pause in typing.
 */
export const ASK_AHEAD_PAUSE_MS = { typed: 700, picked: 300 } as const;
/** A typed answer shorter than this is still being started, not about to be sent. */
export const ASK_AHEAD_MIN_CHARS = 3;
/**
 * At most this many answers asked ahead per question: past it the parent is
 * drafting, and every guess is a model call (`seed_assist` allows 300 / 10 min).
 */
export const ASK_AHEAD_PER_QUESTION = 3;

/** Is a staged, unsent answer worth asking ahead? `asked` = already asked for this question. */
export function worthAskingAhead(value: FieldValue, asked: number): boolean {
  if (asked >= ASK_AHEAD_PER_QUESTION) return false;
  if (typeof value === "string") return value.trim().length >= ASK_AHEAD_MIN_CHARS;
  return Array.isArray(value) && value.length > 0;
}

/**
 * The parent's name at most this often on a card (12 Oct: once read as too
 * little; later the same day, the developer: "maybe raise the frequency a
 * little" — 2 → 3)…
 */
export const NAMES_PER_CARD = 3;
/** …and never closer than this many turns apart, so it never becomes a tic (4 → 3). */
export const NAME_GAP = 3;

/** May this turn use the name? The chat's half of the rule; `nameThisTurn` is the server's. */
export function nameAllowed(draft: { names_used?: number; named_at_turn?: number; turns?: number }, hasName: boolean): boolean {
  if (!hasName) return false;
  const used = draft.names_used ?? 0;
  if (used >= NAMES_PER_CARD) return false;
  return used === 0 || (draft.turns ?? 0) - (draft.named_at_turn ?? 0) >= NAME_GAP;
}

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
  /* 12 Oct, the developer's own walk: real parents answer in a few words
     ("patient teachers"), and the 40-character bar left the name to follow-ups
     only. Any typed answer, or their verdict on recommending it, will do; the
     chat still caps it (`NAMES_PER_CARD`, `NAME_GAP`). */
  if (lastStep.id === "recommendation") return true;
  const answer = fields[lastStep.id];
  return lastStep.widget === "text" && typeof answer === "string" && answer.trim().length >= 3;
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
  const lower = (t: string) => (/^([A-Z])(?=[a-z' ])/.test(t) && !/^I\b/.test(t) ? t.charAt(0).toLowerCase() + t.slice(1) : t);
  /* "Ha, I hear you! What made it fun?" → "Ha, I hear you! {name}, what made
     it fun?" — the name goes on the question, not on the laugh (12 Oct:
     "Dana, ha, I hear you!"). */
  const cut = lastSentenceStart(text);
  if (cut > 0 && text.endsWith("?")) return `${text.slice(0, cut).trimEnd()} ${NAME_TOKEN}, ${lower(text.slice(cut))}`;
  return thanks ? `Thanks, ${NAME_TOKEN} — ${lower(text)}` : `${NAME_TOKEN}, ${lower(text)}`;
}

/**
 * Where the last sentence starts, or -1 for one sentence. A full stop after a
 * title is not a sentence end ("Is she still seeing Dr. Kim?" — 12 Oct: the
 * name went in as "Dr. Dana, kim").
 */
function lastSentenceStart(text: string): number {
  let start = -1;
  for (const m of text.matchAll(/[.!]\s+(?=[A-Z])/g)) {
    const before = text.slice(0, m.index);
    if (/\b(Dr|Mr|Mrs|Ms|Mx|St|Jr|Sr|vs|No)$/i.test(before)) continue;
    start = (m.index ?? 0) + m[0].length;
  }
  return start;
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
    /** The parent's own area may be offered on the town question (`AREA_TOKEN`). */
    hasArea?: boolean;
    /** Pando's last reactions on this card (`TurnInput.recent_reactions`). */
    recentReactions?: readonly string[];
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
    /* The town asked again (12 Oct) asks openly: the town question already
       offered their own area and they passed on it, so it is not offered twice.
       Nor a place they never named. */
    const town = lastStep.id === "location";
    const text = String(raw?.followup?.text ?? "");
    const offered =
      text.includes(AREA_TOKEN) || (town && guessesAPlace(lastStep, withoutName(text), ctx.fields)) || guessesGender(text, ctx.fields)
        ? null
        : personal(acceptFollowUp(raw?.followup?.text, lastStep));
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
      const rule = ctx.ruleFollowUp;
      return { followup: addressOnce(own ?? rule), prefill: {}, next: null, ack: null };
    }
    /* 12 Oct, the quality review: when only the model asked, it followed up
       complete answers — a caveat "Fills up in February" got "But what made it
       click for her boys?", merged into the caveat. On its own the model may
       follow up only a thin "why". */
    const words = typeof lastAnswer === "string" ? lastAnswer.trim().split(/\s+/).filter(Boolean).length : 0;
    const thinWhy = WHY.has(lastStep.id) && words < 8;
    if (modelSaysYes && worded && thinWhy && onTopic(worded, lastStep)) {
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
  /* A reaction, only a safe one — after a tap too since 12 Oct (the developer:
     "it should feel like a real person asking"; a No deserves a "sorry").
     Never the name inside it ("Dana, so parents need to be ready…" read as a
     slip, 12 Oct): the question carries it. */
  const ackText = String(raw?.ack ?? "");
  const reaction =
    lastStep && !ackText.includes(AREA_TOKEN) && !guessesGender(ackText, ctx.fields) ? acceptAck(raw?.ack, lastAnswer) : null;
  const read = reaction && fitsAfter(reaction, lastStep, ctx.recentReactions ?? []) ? reaction : null;
  const ack = read === null ? null : readName(read, false);
  if (candidates.length === 0) return { followup: null, prefill, next: null, ack };
  const named = typeof raw?.next?.id === "string" ? candidates.find((s) => s.id === raw.next?.id) : undefined;
  const step = named ?? candidates[0];
  const canonical = canonicalPrompt(step, fields);
  /*
   * How far a question may be reworded — its third rule:
   *  - 9 Oct, after the walk: only typed questions, keeping half their words
   *    ("Is the studio still offering the workshop?" no longer fit its buttons);
   *  - 9 Oct, iteration 1: buttons too, keeping every word;
   *  - 12 Oct (the developer: "it should look like a real person asking — but
   *    still match the questions in the database"): **in its own words**. What
   *    may not change is what it asks, checked by its intent (`asksTheSame`):
   *    "Is she still dancing there?" asks `freshness`, and its buttons still
   *    answer it. The business-for-the-family slip is refused by `PERSON`.
   * Her fixed sentences (the fork, the card's last question) never.
   */
  const fixed = isFixedStep(step);
  const offered = named && !fixed ? personal(acceptPrompt(canonical, raw?.next?.question, step)) : null;
  const worded =
    offered &&
    asksTheSame(step, canonical, withoutName(offered), script, fields) &&
    !namesAnotherThing(offered, fields) &&
    !guessesAPlace(step, withoutName(offered), fields) &&
    !guessesGender(offered, fields) &&
    (!offered.includes(AREA_TOKEN) || (step.id === "location" && ctx.hasArea === true && namedTown(step, fields) === null))
      ? offered
      : null;
  /* Their own area, offered as a check, when the model did not word it (12 Oct). */
  /* 12 Oct, the developer: a town the parent already named on this card comes
     first; their profile's area only when they named none. */
  const townSaid = step.id === "location" ? namedTown(step, fields) : null;
  const fallback = townSaid
    ? `Is it in ${townSaid}, like you said, or somewhere else?`
    : step.id === "location" && ctx.hasArea === true
      ? AREA_PROMPT
      : canonical;
  /* Her fixed sentences are said as they are, so what makes them sound like
     this chat is the line before them (12 Oct: 10 of 13 forks came bare,
     usually after a skipped town). When the model gave none, a short one with
     the card's name. They are not addressed by name either. */
  const lead = fixed && ack === null ? fixedLead(fields, ctx.recentReactions ?? []) : ack;
  /* "Thanks, Dana —" after "he got knocked over twice" read as cold (12 Oct): no thanks after a No. */
  const sorry = lastStep?.id === "what_didnt_work" || (lastStep?.id === "recommendation" && /^(no|probably_not)$/.test(String(lastAnswer)));
  const prompt = fixed
    ? spoken(worded ?? canonical)
    : addressOnce(worded ?? fallback, ack === null && !sorry && substantial(lastStep, ctx.fields));
  return { followup: null, prefill, next: { id: step.id, prompt }, ack: lead };
}

/** The line before her fixed sentences when the model gave none — varied by how far the card is. */
function fixedLead(fields: Fields, recent: readonly string[]): string {
  const thing = typeof fields.name === "string" && fields.name.trim().length <= 40 ? fields.name.trim() : "";
  /* Tone-neutral, and never one said a moment ago (12 Oct, the quality review:
     the same line came twice in one card). */
  const leads = thing
    ? ["Okay — nearly there.", `Thanks — this helps someone deciding on ${thing}.`, `Good to have this on ${thing}.`]
    : ["Okay — nearly there.", "Thanks — this helps someone deciding.", "Good to have this."];
  const start = Object.keys(fields).length % leads.length;
  const order = [...leads.slice(start), ...leads.slice(0, start)];
  return order.find((l) => !recent.includes(l)) ?? order[0];
}

/**
 * Does a question name the thing they would buy or use *instead*? (12 Oct: on
 * a Graco card, after "the Clek Foonf, it's narrow", the price and "worth it"
 * were asked about the Clek — and the answers would have been stored as the
 * Graco's.) A capitalised word of that answer which is not in the card's own
 * name may not appear in a later question.
 */
function namesAnotherThing(question: string, fields: Fields): boolean {
  const instead = typeof fields.detail_note === "string" ? fields.detail_note : "";
  if (!instead) return false;
  const own = new Set(String(fields.name ?? "").toLowerCase().match(/[a-z0-9]+/g) ?? []);
  const others = (instead.match(/\b[A-Z][A-Za-z0-9]{2,}\b/g) ?? [])
    .map((w) => w.toLowerCase())
    .filter((w) => !own.has(w) && !COMMON_CAPITALS.has(w));
  const asked = new Set(question.toLowerCase().match(/[a-z0-9]+/g) ?? []);
  return others.some((w) => asked.has(w));
}
const COMMON_CAPITALS = new Set(["the", "nothing", "none", "this", "that", "it", "we", "our", "they", "she", "he", "and", "but", "honestly", "just", "any", "anything"]);

/**
 * Does a question about where it is name a place the parent never did? (12 Oct,
 * the developer's walk: "Which part of town is the park in, the area near Old
 * Town, or somewhere else?" — nobody had said Old Town; it came from the
 * neighbourhood list the model was given.) A capitalised word that is not the
 * question's first, not in the card's name and not in anything they typed is a
 * guess offered as knowledge.
 */
function guessesAPlace(step: Step, question: string, fields: Fields): boolean {
  if (step.id !== "location") return false;
  const known = new Set(
    `${String(fields.name ?? "")} ${saidOn(fields)}`.toLowerCase().match(/[a-z0-9']+/g) ?? [],
  );
  const words = question.match(/[A-Za-z][A-Za-z']*/g) ?? [];
  return words.slice(1).some((w) => /^[A-Z]/.test(w) && w !== "I" && !known.has(w.toLowerCase()));
}

/** A town from the step's own list that the parent named in their words on this card — the longest. */
function namedTown(step: Step, fields: Fields): string | null {
  const said = ` ${saidOn(fields).toLowerCase().replace(/[^a-z0-9ñ' ]+/g, " ")} `;
  const hits = (step.options ?? [])
    .map((o) => o.label)
    .filter((l) => l.length >= 4 && said.includes(` ${l.toLowerCase().replace(/[^a-z0-9ñ' ]+/g, " ")} `));
  return hits.sort((a, b) => b.length - a.length)[0] ?? null;
}

/**
 * Does Pando's line give the child a gender the parent never did? (12 Oct, the
 * developer: "Would you recommend Kids Shampoo… given your son was eight?" —
 * nobody had said son.) The prompt forbids the guess and the model still made
 * it. A child noun (son, daughter, boy, girl) needs the parent to have written
 * one on this card; a pronoun (he, she, him, her, his) the same — unless the
 * card's name carries a title (Mr., Ms.), when it is about the provider.
 */
const CHILD_GENDER = /\b(sons?|daughters?|boys?|girls?)\b/i;
const PRONOUN_GENDER = /\b(he|she|him|her|his|hers|himself|herself)\b/i;
function guessesGender(text: string, fields: Fields): boolean {
  const said = saidOn(fields);
  if (CHILD_GENDER.test(text) && !CHILD_GENDER.test(said)) return true;
  const titled = /^(mr|mrs|ms|miss)\b/i.test(String(fields.name ?? "").trim());
  return PRONOUN_GENDER.test(text) && !PRONOUN_GENDER.test(said) && !CHILD_GENDER.test(said) && !titled;
}

/** A follow-up quoting the parent — wrong when the answer was skipped. */
const SAID_BACK = /\byou (said|mentioned|told|noted|wrote)\b/i;

/**
 * What each question asks, as words any wording of it must use — every
 * pattern in the list must match (12 Oct). `freshness` and `firsthand` also
 * need a person: "Is the studio still offering the workshop?" (9 Oct) asks
 * about the business, and its buttons answer the family.
 */
const PERSON = /\b(you|your|yours|she|he|they|her|him|his|their|son|daughter|kids?|child|children|twins|girls|boys|little one|friend|neighbou?r|family)\b/i;
const INTENT: Record<string, RegExp[]> = {
  firsthand: [PERSON, /\b(go|went|been|do|did|take|took|use|used|try|tried|see|saw|seeing|yourselves|yourself|personally|own|doctor|attend)/i],
  /* "He was five then, right?" — a check of an age they already gave (12 Oct).
     Tightened after the quality review: "Your kid's in fifth grade now — how's
     the math going?" passed on "grade". */
  child_age: [/\b(how old|what age|which age|that age|the age|ages? (was|were)|old (was|were|is|are)|what grade|which grade|at the time|then, right|now, right)\b/i],
  freshness: [PERSON, /\b(still|last|recent|recently|ago|lately|stopped|anymore|these days|now)\b/i],
  recommendation: [/\b(recommend|suggest|send (a|another|other)|point (a|another|other))/i],
  what_makes_it_great: [/\b(like|love|good|great|stood|stand|enjoy|special|well|work|made|make|best|favou?rite|win|worth|click)/i],
  what_didnt_work: [/\b(work|didn|wrong|fit|happen|issue|problem|bad|miss|disappoint|off|sour)/i],
  caveat: [/\b(know|before|watch|flag|expect|heads|tip|warn|aware|prepare|tell)/i],
  location: [/\b(town|city|where|area|neighbou?rhood|located|part of)\b/i],
  who_for: [/\b(who|kind of (kid|child|family)|which kids|suit|fit|best for|thrive|send|good for|perfect for)/i],
  price_band: [/\b(pay|paid|cost|price|spend|spent|charge|tuition|how much|run you)\b/i],
  price_unit: [/\b(per|each|every)\b/i],
  worth_it: [/\b(worth|value|money)\b/i],
  best_for: [/\b(age|ages|who|best for|old|kids|little ones|toddlers|babies|suit)\b/i],
  amenities: [/\b(practical|highchair|changing|parking|stroller|menu|space|outdoor|bring|need|handy)/i],
  timing_note: [/\b(when|time|day|hour|hours|morning|afternoon|evening|busy|crowd|quiet|schedule)/i],
  appointment_ease: [/\b(book|appointment|wait|get in|schedule|easy|hard)/i],
  visit_reason: [/\b(for|reason|why|brought|kind of visit|checkup|sick)\b/i],
  used_for: [/\b(for|use|used|see|saw|help|need)\b/i],
};

/**
 * What a wording of the question may NOT say (12 Oct, the human-voice runs,
 * where the prompt alone did not hold): the field is the child's age at the
 * time, not when they started.
 */
const NOT_INTENT: Record<string, RegExp> = {
  child_age: /\b(start|started|starting|began|begin|first|caveats?|didn'?t|enjoy|best thing)\b/i,
  /* "since it's public, no tuition — but do families chip in for anything?" (12 Oct). */
  price_band: /\b(anything else|extras?|fees?|chip in|donat\w*|fundrais\w*)\b/i,
  /* "Which town are you in?" asks the parent's town, not the vendor's (12 Oct). */
  location: /\b(you|your family) live\b|\btown are you\b|\bare you in\b/i,
};

/* The steps checked on their question clause alone — the words after the
   last dash of the last sentence — so a reaction's words cannot carry them. */
const CLAUSE_STEPS = new Set(["child_age", "price_band", "location", "visit_reason"]);
function questionClause(text: string): string {
  const last = text.slice(Math.max(0, lastSentenceStart(text)));
  const tail = last.split(/\s[—–-]\s/).pop() ?? last;
  return tail.trim().split(/\s+/).length >= 3 ? tail : last;
}

/** Unit words, as the price buttons name them ("lesson" is a class, "monthly" a month). */
/* A unit is said as one — "per month", "a week", "each class", "for the
   summer", "monthly" — not "the lessons" naming what was paid for. */
const UNIT_PHRASE =
  /\b(?:per|a|an|each|every|by the)\s+(day|week|month|year|term|season|class|lesson|session|summer|visit|semester|event|item)s?\b|\bfor the(?: whole)?\s+(summer|season|year|term|month|week|day|semester)\b|\b(monthly|weekly|yearly|annual(?:ly)?)\b/gi;
const UNIT_SAME: Record<string, string> = { lesson: "class", session: "class", monthly: "month", weekly: "week", yearly: "year", annual: "year", annually: "year", semester: "term" };
function unitsIn(text: string): string[] {
  return [...text.matchAll(UNIT_PHRASE)].map((m) => {
    const u = (m[1] ?? m[2] ?? m[3] ?? "").toLowerCase();
    return UNIT_SAME[u] ?? u;
  });
}
/** A button label is a bare unit ("Class", "Per week"), so any unit word in it counts. */
function unitsOfLabel(label: string): string[] {
  return (label.toLowerCase().match(/\b(day|week|month|year|term|season|class|lesson|session|summer|visit|semester|event|item)s?\b/g) ?? []).map(
    (w) => UNIT_SAME[w.replace(/s$/, "")] ?? w.replace(/s$/, ""),
  );
}

/**
 * The price questions keep to their buttons (12 Oct, the quality review: "Was
 * that per week, or for the whole summer?" to Day / Week; a band asked "per
 * month" with Day / Week / Season to follow). A unit question names only units
 * its buttons have; a band question names no unit when a unit question
 * follows, and its own unit when it has one ("per month" for a school).
 */
function unitsFit(step: Step, canonical: string, reworded: string, script?: Script, fields?: Fields): boolean {
  if (step.id === "price_unit") {
    const allowed = new Set((step.options ?? []).flatMap((o) => unitsOfLabel(o.label)));
    return unitsIn(reworded).every((u) => allowed.has(u));
  }
  if (step.id === "price_band") {
    const own = unitsIn(canonical);
    const said = unitsIn(reworded);
    if (own.length > 0) return own.every((u) => said.includes(u)) && said.every((u) => own.includes(u));
    const unitFollows = !!script?.steps.some((x) => x.id === "price_unit") && !(fields && "price_unit" in fields);
    return !(unitFollows && said.length > 0);
  }
  return true;
}

/** Does a rewording still ask this question? */
function asksTheSame(step: Step, canonical: string, reworded: string, script?: Script, fields?: Fields): boolean {
  const asked = CLAUSE_STEPS.has(step.id) ? questionClause(reworded) : reworded;
  if (NOT_INTENT[step.id]?.test(asked)) return false;
  if (!unitsFit(step, canonical, reworded, script, fields)) return false;
  /* Buttons that open "Still…" answer a "still" question — "When did you last
     go to Hamilton?" does not take "Still there" for an answer. */
  if (step.options?.some((o) => /^still\b/i.test(o.label)) && !/\bstill\b/i.test(reworded)) return false;
  const intent = INTENT[step.id];
  if (intent) return intent.every((re) => re.test(asked));
  return keepsMeaning(canonical, reworded, step.widget === "text" ? 0.5 : 1);
}

/**
 * What a reaction may never be (12 Oct): knowledge Pando does not have — it
 * knows the place only through this parent ("I've heard great things") —
 * or a grade on the parent's answer.
 */
const NOT_A_REACTION = new RegExp(
  [
    "\\b(i('ve| have) heard|i know (it|them|the|that place)|everyone (loves|says)|it'?s (known|famous|popular) for|(great|good|nice|helpful|perfect) (answer|response|detail)|thanks for (the|your) (answer|response))\\b",
    /* 12 Oct, the quality review: verdicts on a price, grading the answer,
       and talking as if Pando were a parent. A word on the child's age
       ("Seven's a great age for karate") was refused too, then allowed again
       the same day — the developer: "the reactions must look like a real
       person", and it is what a person says. */
    "\\b(real|big|solid|serious|meaningful|significant) investment\\b|\\byou get what you pay for\\b",
    "\\bhonest\\b|\\binsightful\\b|\\b(being|so) (straight|upfront|candid)\\b|\\bstraight with me\\b|\\b(glad|love that) you('re| are)? (adding|want)|\\bfill in the picture\\b",
    "\\bi('ll| will) remember\\b|\\bif i('m| am)\\b|\\b(our|my) (kids?|son|daughter)\\b",
  ].join("|"),
  "i",
);

/** How a reaction opens: its first two words ("that's rough" is not "that's great"). */
function opener(text: string): string {
  return text.toLowerCase().replace(/[^a-z' ]+/g, " ").trim().split(/\s+/).slice(0, 2).join(" ");
}

/**
 * Does this reaction belong here, given the last ones? (12 Oct, the first
 * human-voice run: "That's wonderful —" five times in one card, and a reaction
 * after every tap.) Not the same opener as a recent reaction, and not right
 * after another reaction when all they did was tap.
 */
function fitsAfter(text: string, lastStep: Step | null, recent: readonly string[]): boolean {
  const said = recent.filter((r) => r !== "");
  /* 12 Oct, loosened twice after the developer's walk ("the reactions are not
     alive"): on Haiku 5.5 three in ten reactions were still dropped, the
     liveliest among them ("Three is so little to be struggling like that…").
     Now only: not the same two opening words as a recent reaction, and not the
     same thought again straight after (two shared stems with the one just
     said — "counselors who actually engage", then "counselors who actually
     play with them"). */
  if (said.some((r) => opener(r) === opener(text))) return false;
  const previous = recent[recent.length - 1] ?? "";
  const mine = new Set(stems(text));
  if (previous !== "" && stems(previous).filter((w) => mine.has(w)).length >= 2) return false;
  /* After a tap, a short line — not a paragraph. */
  const tapped = lastStep?.widget !== "text";
  return !(tapped && text.split(/\s+/).length > 22);
}

/**
 * A reaction to the last answer, or null — said before the next question.
 *
 * ⚠ 12 Oct, the developer: *"it should look like talking to a real person —
 * a reaction, praise and so on."* This reverses the 9 Oct "never compliment":
 * warmth, praise of what they describe and sympathy are allowed. Still never a
 * question, a link or number, a sentence cut off, their own words handed
 * back, or anything in `NOT_A_REACTION`.
 */
export function acceptAck(raw: unknown, answer?: unknown): string | null {
  if (typeof raw !== "string") return null;
  let text = raw.replace(/\s+/g, " ").trim();
  /* A reaction that ends by asking something keeps its reaction (12 Oct: "Five
     is such a good age for swimming. Is he still in the water with them?" was
     dropped whole); the question that follows it is the step's own. */
  if (text.endsWith("?")) {
    const cut = lastSentenceStart(text);
    text = cut > 0 ? text.slice(0, cut).trim() : "";
  }
  if (text.length < 3 || text.length > 200) return null;
  /* Short, as a text back is: one or two sentences (16 → 30 words, 12 Oct —
     "a teacher who means what they say but cares" was cut at 16). */
  if (text.split(/\s+/).length > 30) return null;
  /* Not a question of its own — the question follows it. A "?" inside is a
     reaction's own ("Free Lego and an empty room before 11? What a find."). */
  if (text.endsWith("?") || LINK.test(text) || NOT_A_REACTION.test(text)) return null;
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
  if (text.length < 12 || text.length > 300) return null;
  if (LINK.test(text) || (text.match(/\?/g) ?? []).length > 3) return null;
  /* 12 Oct, the quality review: "Nothing to flag" came back as Pando's own
     follow-up in every run, and the parent's reply was merged into the caveat.
     A follow-up asks something. */
  if (!text.includes("?")) return null;
  if (/^\s*(\{name\}\s*[,—–-]?\s*)?nothing\b/i.test(text) || isNothingToFlag(withoutName(text).replace(/[.!?]$/, ""))) return null;
  return namesOptions(text, step) ? null : text;
}

/**
 * What each follow-up-able question is about, as words a follow-up on it would
 * use (iteration 5, 9 Oct: matching the question's own words threw away "You
 * said she's great — what does she do well with your daughter?" for the
 * generic one). A step not listed falls back to sharing one of its own words.
 */
const TOPIC: Record<string, RegExp> = {
  what_makes_it_great: /\b(like|love|good|great|stood|stand|enjoy|special|well|work|made|make|best|favou?rite|help|click|difference|better|fun|win)/i,
  what_didnt_work: /\b(work|didn|wrong|fit|happen|issue|problem|bad|go)/i,
  caveat: /\b(know|before|watch|flag|expect|book|wait|heads|tip|warn|mind|aware|prepare|plan|surprise|should)/i,
  who_for: /\b(who|kind of|which kids|age|suit|fit|best for|thrive|send|good for)/i,
  /* The town asked again (12 Oct): "do you know how much the belt tests cost?" passed by sharing "roughly". */
  location: /\b(town|city|area|where|neighbou?rhood|located|near|part of)\b/i,
  timing_note: /\b(when|time|day|hour|morning|afternoon|evening|busy|crowd|quiet)/i,
  tip: /\b(tip|do|know|when|how|specific|name|time)/i,
};

/** Is a follow-up about this question? */
export function onTopic(followup: string, step: Step): boolean {
  /* 12 Oct: a follow-up on the "why" is about the why by construction, and the
     model now reads the whole conversation — "What is it about class that gets
     her excited?" was thrown away for the canned text for lacking a listed word. */
  if (WHY.has(step.id)) return true;
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

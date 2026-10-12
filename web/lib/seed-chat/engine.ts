import { AGE_OPTIONS } from "../questions";
import { formatPhone } from "../phone";
import { EXPECTING } from "../types";
import type {
  ChatDraft,
  FieldValue,
  Fields,
  Script,
  ShareKind,
  Step,
  Subcategory,
  Submission,
} from "./types";

/**
 * Pure conversation logic: which step comes next, what the parent's answer reads
 * as, and how a finished card recaps. No React, no fetch — so the server could
 * drive it later (it decides the next step; the UI just renders it).
 */

export function newDraft(kind: ShareKind): ChatDraft {
  return {
    id: `${kind}-${Date.now().toString(36)}`,
    kind,
    fields: {},
    step_index: 0,
  };
}

export function isEmptyValue(value: FieldValue | undefined): boolean {
  if (value === undefined) return true;
  if (typeof value === "string") return value.trim().length === 0;
  return value.length === 0;
}

/** Steps whose `when` guard passes for the answers so far. */
export function visibleSteps(script: Script, fields: Fields): Step[] {
  return script.steps.filter((s) => !s.when || s.when(fields));
}

/**
 * The script a draft or a saved card is asked from (9 Oct): its sub-category's
 * when the classifier chose one, otherwise its button's general script.
 */
export function scriptFor(
  scripts: Record<ShareKind, Script>,
  subScripts: Partial<Record<Subcategory, Script>>,
  card: { kind: ShareKind; subcategory?: Subcategory | null; fields?: Fields },
): Script {
  const sub =
    card.subcategory ??
    (typeof card.fields?.subcategory === "string" ? (card.fields.subcategory as Subcategory) : null);
  const picked = sub ? subScripts[sub] : undefined;
  return picked && picked.kind === card.kind ? picked : scripts[card.kind];
}

/** The script's own wording, in a friend's terms when the card is a friend's experience. */
export function canonicalPrompt(step: Step, fields?: Fields): string {
  if (fields?.firsthand === "secondhand" && step.friendPrompt) return step.friendPrompt;
  /* A name that reads as one: a long one would bury the question, and a
     person's ("what is Ms. Lee?", 12 Oct) is not a thing. */
  const name = typeof fields?.name === "string" ? fields.name.trim() : "";
  const person = PERSON_TITLE.test(name);
  if (step.namedPrompt && !person && name.length >= 2 && name.length <= 40) {
    return step.namedPrompt.replace("{thing}", name);
  }
  return name.length >= 2 && name.length <= 40 ? namedIn(step, step.prompt, name) : step.prompt;
}

/**
 * The script's own words with the card's name in them (12 Oct, the developer:
 * one more round of personalisation — "Who is it perfect for?" is what is said
 * whenever the model's wording is not kept). Only on questions where the name
 * reads right in place of "it" / "them": "Who is Splash Academy perfect for?",
 * "Which town is Ms. Lee in?", "Roughly what did you pay for Kidspace?".
 */
const NAMEABLE = new Set(["who_for", "location", "worth_it", "recommendation", "best_for", "caveat", "price_band"]);
function namedIn(step: Step, prompt: string, name: string): string {
  if (!NAMEABLE.has(step.id) || prompt.includes(name)) return prompt;
  if (/\bpay\?$/.test(prompt)) return prompt.replace(/pay\?$/, `pay for ${name}?`);
  if (/\bare they\b/.test(prompt)) return prompt.replace(/\bare they\b/, `is ${name}`);
  const m = prompt.match(/\b(it|them|they)\b/);
  return m && m.index !== undefined ? prompt.slice(0, m.index) + name + prompt.slice(m.index + m[0].length) : prompt;
}

/**
 * A follow-up's own words with the card's name (12 Oct): `{thing|it}` is the
 * name, or the word after the bar when the card has none; `{to thing|there}`
 * keeps "to" with the name only.
 */
export function withThing(text: string, fields?: Fields): string {
  const name = typeof fields?.name === "string" ? fields.name.trim() : "";
  const usable = name.length >= 2 && name.length <= 40;
  return text.replace(/\{(?:([a-z]+) )?thing\|([^}]*)\}/g, (_, prefix: string | undefined, alt: string) =>
    usable ? `${prefix ? `${prefix} ` : ""}${name}` : alt,
  );
}

/** A name that reads as a person ("Ms. Lee"), which "what is {thing}?" does not fit. */
const PERSON_TITLE = /^(mr|mrs|ms|miss|mx|dr|coach|teacher)\b\.?/i;

/**
 * One of a step's `variants`, filled — or null to say its `prompt` (12 Oct).
 * `seed` picks it, so two cards in a row do not open the same way; a variant
 * needing a name the card or the parent does not have is passed over, as is
 * "what is {thing}?" for a person.
 */
export function openerFor(step: Step, fields: Fields, seed: number, parent: string | null): string | null {
  if (!step.variants || step.variants.length === 0) return null;
  const thing = typeof fields.name === "string" ? fields.name.trim() : "";
  const thingOk = thing.length >= 2 && thing.length <= 40 && !(step.id === "what_is_it" && PERSON_TITLE.test(thing));
  const fits = (v: string) => (!v.includes("{thing}") || thingOk) && (!v.includes("{parent}") || !!parent);
  /* The script's own words only when no variant fits (12 Oct: kept in the
     pool, half the cards still opened word for word). */
  const usable = step.variants.filter(fits).length > 0 ? step.variants.filter(fits) : [step.prompt];
  const pick = usable[Math.abs(seed) % usable.length];
  return pick.replace("{thing}", thing).replace("{parent}", parent ?? "");
}

/** What Pando says for a step: the model's wording when it gave one (9 Oct). */
export function promptFor(step: Step, prompts?: Record<string, string>, fields?: Fields): string {
  return prompts?.[step.id] ?? canonicalPrompt(step, fields);
}

/**
 * The first step at or after `from` that should be asked **and is not
 * answered yet** — used once, when a card moves into its sub-category's
 * script, so the context questions already answered are never asked again.
 */
export function nextUnanswered(script: Script, fields: Fields, from: number): number {
  for (let i = from; i < script.steps.length; i += 1) {
    const step = script.steps[i];
    if (step.id in fields) continue;
    if (!step.when || step.when(fields)) return i;
  }
  return -1;
}

/** First index at or after `from` that should actually be asked. */
export function nextIndex(script: Script, fields: Fields, from: number): number {
  for (let i = from; i < script.steps.length; i += 1) {
    const step = script.steps[i];
    if (!step.when || step.when(fields)) return i;
  }
  return -1;
}

export function previousIndex(
  script: Script,
  fields: Fields,
  before: number,
): number {
  for (let i = before - 1; i >= 0; i -= 1) {
    const step = script.steps[i];
    if (!step.when || step.when(fields)) return i;
  }
  return -1;
}

/**
 * `total` is deliberately the raw step count, not `visibleSteps(...).length`. A
 * caregiver's answer can unlock later conditional questions (`needs_horizon` !==
 * "no_change" adds two; a real `pay_band` adds one) — using the filtered count
 * made the denominator grow mid-conversation, so a parent would see "15 of 18"
 * and then "16 of 20" for giving an entirely ordinary answer. `script.steps.length`
 * never changes, so progress only ever moves forward; a branch nobody takes just
 * means the bar doesn't quite reach the end, which reads as "almost done" rather
 * than "this got longer."
 */
export function progressOf(
  script: Script,
  fields: Fields,
  index: number,
): { current: number; total: number } {
  /* 9 Oct: the adaptive interview asks in any order and skips what the parent
     already said, so "where we are" is how many are answered, not the step's
     position — still only ever moving forward. */
  void index;
  /*
   * 12 Oct, the developer: "the number of questions is wrong after That's it" —
   * the raw count kept the whole detail block, so a card ended at "11 of 18".
   * Now a conditional step counts until it is **settled**: shown, or hidden
   * with every step before it already answered (its gate is always earlier).
   * So the total still never grows — a branch not yet decided is counted — and
   * it shrinks the moment one is decided against ("That's it", a No).
   */
  const open = (s: Step) => !s.when || s.when(fields);
  /* Could answers to earlier, still open steps show `s`? Each one's buttons
     are tried, or any answer for a typed one — alone and in pairs, since a
     gate is at most two earlier answers (the unit: "Add more detail" and a
     price; a caregiver's horizon: still working and would hire again). */
  const tries = (e: Step): FieldValue[] =>
    e.options ? e.options.map((o) => o.id) : e.widget === "ages" ? [[5]] : e.widget === "chips" ? [[]] : ["x"];
  const couldOpen = (s: Step, i: number) => {
    const pending = script.steps.slice(0, i).filter((e) => !(e.id in fields));
    return pending.some((a, ai) =>
      tries(a).some(
        (va) =>
          s.when?.({ ...fields, [a.id]: va }) === true ||
          pending
            .slice(ai + 1)
            .some((b) => tries(b).some((vb) => s.when?.({ ...fields, [a.id]: va, [b.id]: vb }) === true)),
      ),
    );
  };
  const counted = script.steps.filter((s, i) => s.id in fields || open(s) || couldOpen(s, i));
  const answered = counted.filter((s) => s.id in fields).length;
  return {
    current: Math.min(answered + 1, counted.length),
    total: counted.length,
  };
}

function labelFor(step: Step, id: string): string {
  return step.options?.find((o) => o.id === id)?.label ?? id;
}

function ageLabel(age: number): string {
  return (
    AGE_OPTIONS.find((o) => o.id === String(age))?.label ??
    (age === EXPECTING ? "Expecting" : String(age))
  );
}

/** What the parent's own bubble says once they've answered. */
export function formatAnswer(step: Step, value: FieldValue): string {
  if (isEmptyValue(value)) return "Skip";

  if (step.widget === "name" && Array.isArray(value)) {
    const [first, initial] = value as string[];
    return initial ? `${first} ${initial}.` : first;
  }

  if (step.widget === "phone" && typeof value === "string") {
    return formatPhone(value);
  }

  if (typeof value === "string") {
    return step.options ? labelFor(step, value) : value;
  }

  if (typeof value[0] === "number") {
    return (value as number[]).map(ageLabel).join(", ");
  }

  return (value as string[]).map((id) => labelFor(step, id)).join(" · ");
}

export interface RecapRow {
  field: string;
  label: string;
  value: string;
  /** Not answered. Only present in an editable recap, where it reads "Add". */
  empty?: boolean;
}

/**
 * Label/value pairs for the structured recap card. The field id travels with each
 * row so a recap row can be tapped to correct that one answer.
 *
 * ⚠ **`all` is the editable recap, and it lists every question the card asks —
 * not only the ones that were answered** (5 Oct, the developer: *"all fields
 * editable, not only some or the unfilled ones"*). It used to skip an empty
 * value, so a question a parent had skipped had no row and so no Edit: the only
 * way to add it afterwards was to start the card again. A question behind the
 * "more detail" fork is listed too — the parent who tapped *That's it* is the
 * one most likely to come back for it — and one whose own condition is false
 * (a price unit with no price) is not, because there is nothing to attach it
 * to yet.
 */
export function recapRows(
  script: Script,
  fields: Fields,
  options: { all?: boolean } = {},
): RecapRow[] {
  const rows: RecapRow[] = [];
  /* Asking to see the detail questions: the fork's own answer is "yes". */
  const asIfDetailWanted: Fields = { ...fields, more_detail: "yes" };
  for (const { field, label } of script.recap) {
    const step = script.steps.find((s) => s.id === field);
    if (!step) continue;
    const value = fields[field];
    if (isEmptyValue(value)) {
      if (!options.all) continue;
      if (step.when && !step.when(asIfDetailWanted)) continue;
      rows.push({ field, label, value: "", empty: true });
      continue;
    }
    /* An answer whose own question no longer applies is not shown (review,
       8 Oct): a doctor card edited from Yes to No still holds "what they like",
       and listing it under a No reads as the reason for the No. The server
       picks the "why" by the recommendation (`doctorWhy`) for the same reason. */
    if (step.when && !step.when(asIfDetailWanted)) continue;
    rows.push({ field, label, value: formatAnswer(step, value as FieldValue) });
  }
  return rows;
}

export function buildSubmission(draft: ChatDraft): Submission {
  return {
    id: draft.id,
    kind: draft.kind,
    fields: draft.fields,
    created_at: new Date().toISOString(),
    persisted: false,
  };
}

/**
 * A tip's title, made from its own words.
 *
 * ⚠ A tip has no name question, and asking a parent to title their own advice
 * is a chore (4 Oct, the developer). The record stores this until the
 * extraction pass replaces it with a better one, and only while it is still
 * exactly this — so an admin's rename is never overwritten.
 */
export function tipTitle(tip: string): string {
  const text = tip.replace(/\s+/g, " ").trim();
  if (text.length <= 48) return text;
  /* Cut on a word, and with three dots rather than "…": this name reaches SMS
     (a freshness ping, a thank-you), and one character outside GSM-7 moves the
     whole message to UCS-2. */
  const cut = text.slice(0, 48);
  const space = cut.lastIndexOf(" ");
  return `${(space > 20 ? cut.slice(0, space) : cut).replace(/[\s,;:.—-]+$/, "")}...`;
}

/** Headline used for a saved card in lists and on the completion screen. */
export function submissionTitle(submission: Submission): string {
  const { fields, kind } = submission;
  if (kind === "caregiver") {
    const name = fields.name;
    if (Array.isArray(name) && typeof name[0] === "string") {
      const [first, initial] = name as string[];
      return initial ? `${first} ${initial}.` : first;
    }
    return "Caregiver";
  }
  if (kind === "tip") {
    const tip = fields.tip;
    return typeof tip === "string" && tip.trim().length > 0 ? tipTitle(tip) : "Tip";
  }
  const name = fields.name;
  return typeof name === "string" && name.length > 0 ? name : "Untitled";
}

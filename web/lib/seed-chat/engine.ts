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
  void fields;
  return {
    current: Math.min(index + 1, script.steps.length),
    total: script.steps.length,
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

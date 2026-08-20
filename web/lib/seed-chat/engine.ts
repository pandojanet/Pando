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

/**
 * Label/value pairs for the structured recap card. The field id travels with each
 * row so a recap row can be tapped to correct that one answer.
 */
export function recapRows(
  script: Script,
  fields: Fields,
): Array<{ field: string; label: string; value: string }> {
  const rows: Array<{ field: string; label: string; value: string }> = [];
  for (const { field, label } of script.recap) {
    const step = script.steps.find((s) => s.id === field);
    const value = fields[field];
    if (!step || isEmptyValue(value)) continue;
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
    return typeof tip === "string" && tip.length > 0
      ? `${tip.slice(0, 48)}${tip.length > 48 ? "…" : ""}`
      : "Tip";
  }
  const name = fields.name;
  return typeof name === "string" && name.length > 0 ? name : "Untitled";
}

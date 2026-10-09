import {
  APPOINTMENT_EASE,
  HOW_MUCH,
  LAST_THERE,
  PLACE_LAST_GONE,
  PRICE_BAND,
  PRICE_UNIT,
  RECOMMENDATION_OPTIONS,
  VISIT_REASON,
  VISIT_UNIT,
  WORTH_IT,
} from "@/lib/seed-chat/scripts";
import { isNothingToFlag } from "@/lib/contribution-quality";

/**
 * Every "when were you last there" id a stored row can carry: the activity
 * list's four plus a place's `within_6m` (8 Oct). Which of them a card offers
 * is its own list; what the admin may write is this union.
 */
const ANY_LAST_THERE = [
  ...PLACE_LAST_GONE.filter((o) => !LAST_THERE.some((l) => l.id === o.id)),
  ...LAST_THERE,
];

/**
 * What an admin may change on a contribution, and how a patch is cleaned.
 *
 * The client's admin round (5 Oct): every field of a contribution is editable,
 * the answered ones and the empty ones, so a card that "needs follow-up" can be
 * completed by the person reading it. It used to be four text boxes.
 *
 * ⚠ **The parent's capture is never touched.** `submissions.fields` is the
 * answer to "did the parent actually say that"; this edits the curated columns
 * of `share_contributions` and nothing else, and every edit is audited with the
 * patch that made it.
 *
 * ⚠ **`firsthand` is deliberately not here.** It is the parent's own statement of
 * whose experience this is, and it decides the trust label and whether a card can
 * count toward Founding; an admin changing it would be writing a claim about a
 * family. Adding it is one line, and it is the client's to want.
 *
 * ⚠ **A key present in the patch sets that field, and an empty value clears it;
 * a key absent leaves it alone.** The old action read an empty string as "not
 * sent", so a wrong sentence could be replaced but never taken out.
 *
 * Pure apart from the option lists it imports, so `test:quality` loads it.
 */

export interface CleanPatch {
  what_makes_it_great?: string | null;
  caveat?: string | null;
  /** Asked and answered. Set with a caveat, or alone for "nothing to flag". */
  caveat_answered?: boolean;
  who_for?: string | null;
  who_not_for?: string | null;
  tip_text?: string | null;
  extra_note?: string | null;
  child_age_at_time?: number[];
  last_there?: string | null;
  how_much?: string | null;
  recommendation?: string | null;
  price_band?: string | null;
  price_unit?: string | null;
  worth_it?: string | null;
  follow_up_ok?: boolean;
  /** Doctor cards (8 Oct). */
  visit_reason?: string | null;
  appointment_ease?: string | null;
}

export type PatchResult = { ok: true; patch: CleanPatch } | { ok: false; error: string };

/** The text columns, whose edit retires the model's score (it describes the old words). */
export const TEXT_COLUMNS = [
  "what_makes_it_great",
  "caveat",
  "who_for",
  "who_not_for",
  "tip_text",
  "extra_note",
] as const;

const MAX_TEXT = 400;
const PAID = (band: string) => band !== "free" && band !== "prefer_not_to_say";

function cleanString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.replace(/\s+/g, " ").trim().slice(0, MAX_TEXT);
  return t === "" ? null : t;
}

function choice(
  key: string,
  v: unknown,
  options: ReadonlyArray<{ id: string }>,
  label: string,
): { value: string | null } | { error: string } {
  if (v === null || v === "") return { value: null };
  if (typeof v === "string" && options.some((o) => o.id === v)) return { value: v };
  return { error: `${label} is not one of the choices parents were offered (${key})` };
}

/**
 * `kind` is the record's kind when the caller knows it (the write path reads it
 * from the row). With it, a doctor's own questions are refused on any other
 * card, and an activity's "Not sure anymore" and its price units on a doctor —
 * "a value no question offered" is per card, not per product (review, 8 Oct).
 */
export function cleanContributionPatch(raw: unknown, kind?: string): PatchResult {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, error: "Nothing to change" };
  }
  const input = raw as Record<string, unknown>;
  if (kind !== undefined) {
    const doctorOnly = ["visit_reason", "appointment_ease"].filter((k) => k in input);
    if (kind !== "doctor" && doctorOnly.length > 0) {
      return { ok: false, error: `Only a doctor card asks that (${doctorOnly.join(", ")})` };
    }
    if (kind === "doctor" && input.last_there === "unsure") {
      return { ok: false, error: "A doctor card does not offer “Not sure anymore” (last_there)" };
    }
  }
  const out: CleanPatch = {};

  for (const key of TEXT_COLUMNS) {
    if (key in input) out[key] = cleanString(input[key]);
  }

  /* "Nothing to flag" is an answer and not a caveat — the rule `cards.ts`
     applies to what a parent types: no caveat, and the question answered. */
  if ("caveat" in input) {
    if (out.caveat && isNothingToFlag(out.caveat)) {
      out.caveat = null;
      out.caveat_answered = true;
    } else if (out.caveat) {
      out.caveat_answered = true;
    }
  }
  if ("caveat_answered" in input && typeof input.caveat_answered === "boolean") {
    out.caveat_answered = input.caveat_answered || out.caveat_answered === true;
  }

  if ("child_age_at_time" in input) {
    const ages = input.child_age_at_time;
    if (!Array.isArray(ages)) return { ok: false, error: "Ages must be a list of numbers" };
    const clean = [...new Set(ages.map(Number))];
    if (clean.some((a) => !Number.isInteger(a) || a < 0 || a > 25)) {
      return { ok: false, error: "An age is a whole number from 0 to 25" };
    }
    if (clean.length > 8) return { ok: false, error: "At most eight ages" };
    out.child_age_at_time = clean.sort((a, b) => a - b);
  }

  const enums: Array<[keyof CleanPatch, ReadonlyArray<{ id: string }>, string]> = [
    ["last_there", ANY_LAST_THERE, "When they were last there"],
    ["how_much", HOW_MUCH, "How long or how often"],
    ["recommendation", RECOMMENDATION_OPTIONS, "Whether they would recommend it"],
    ["worth_it", WORTH_IT, "Whether it was worth the money"],
    ["visit_reason", VISIT_REASON, "What they saw the doctor for"],
    ["appointment_ease", APPOINTMENT_EASE, "How easy appointments are"],
  ];
  for (const [key, options, label] of enums) {
    if (!(key in input)) continue;
    const r = choice(key, input[key], options, label);
    if ("error" in r) return { ok: false, error: r.error };
    (out as Record<string, unknown>)[key] = r.value;
  }

  /* The price and its unit are one answer: the database refuses a paid band with
     no unit (`price_shape`), and a unit with no price is meaningless. */
  if ("price_band" in input || "price_unit" in input) {
    const band = choice("price_band", input.price_band ?? null, PRICE_BAND, "The price");
    if ("error" in band) return { ok: false, error: band.error };
    /* A doctor's price is per visit (8 Oct) — the one unit the activity card does not offer. */
    const units = kind === undefined ? [...PRICE_UNIT, VISIT_UNIT] : kind === "doctor" ? [VISIT_UNIT] : PRICE_UNIT;
    const unit = choice("price_unit", input.price_unit ?? null, units, "What it is per");
    if ("error" in unit) return { ok: false, error: unit.error };
    if (band.value !== null && PAID(band.value) && unit.value === null) {
      return { ok: false, error: "A price needs what it is per — a class, a session, a month" };
    }
    out.price_band = band.value;
    out.price_unit = band.value !== null && PAID(band.value) ? unit.value : null;
  }

  if ("follow_up_ok" in input) out.follow_up_ok = input.follow_up_ok === true;

  return Object.keys(out).length === 0
    ? { ok: false, error: "Nothing to change" }
    : { ok: true, patch: out };
}

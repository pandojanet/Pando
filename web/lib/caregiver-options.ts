import type { Option } from "@/lib/types";

/**
 * The option lists both caregiver surfaces share.
 *
 * These lived as module-private consts in `lib/seed-chat/scripts.ts` while only the
 * parent's nomination (1.6, C1–C11) used them. 2C is the second surface asking the
 * same questions from the other side, and **the ids have to be identical or matching
 * silently fails**: a parent tapping "great with toddlers" and a caregiver tapping
 * their own "great with toddlers" only meet if both wrote `toddlers`. Duplicating the
 * lists would make that a copy-paste invariant, which is no invariant at all.
 *
 * So they live here, and `scripts.ts` imports them.
 */

/**
 * The client's wording (30 Sep, "Caregiver questions"): infants under 1, toddlers
 * 1–2, preschoolers 3–4, school-age children 5–10, preteens and teens 11+.
 *
 * ⚠ Verbatim, and the ranges she wrote do not meet: nothing covers a child of
 * 2 to 3 or of 4 to 5, where the old labels (1–3, 3–5) overlapped at the edges
 * instead. The ids are untouched, so stored answers and the matcher's bands
 * (`bandsForAge`) read as they did; only what a parent or a caregiver is shown
 * moved. Put to the client as a gap in her ranges rather than fixed here.
 */
export const CAREGIVER_AGE_BANDS: Option[] = [
  { id: "baby", label: "Infants under 1" },
  { id: "toddler", label: "Toddlers 1–2" },
  { id: "preschool", label: "Preschoolers 3–4" },
  { id: "grade", label: "School-age children 5–10" },
  { id: "tween", label: "Preteens and teens 11+" },
];

/** C2 / G3, in the client's own categories: the kind of care, not a job title. */
export const CAREGIVER_TYPES: Option[] = [
  { id: "occasional_sitting", label: "Occasional sitting" },
  { id: "regular_part_time", label: "Regular part-time" },
  { id: "full_time", label: "Full-time" },
  { id: "night_newborn", label: "Night / newborn" },
  { id: "before_after_school", label: "Before / after school" },
];

/** Closed strengths, so matching never waits on extraction from free text. */
export const CAREGIVER_STRENGTHS: Option[] = [
  { id: "calm_with_shy", label: "Calm with a shy kid" },
  { id: "plays_actively", label: "Actually plays" },
  { id: "reliable", label: "Reliable / on time" },
  { id: "newborns", label: "Newborn experience" },
  { id: "toddlers", label: "Great with toddlers" },
  { id: "big_kids", label: "Great with older kids" },
  { id: "homework", label: "Helps with homework" },
  { id: "special_needs", label: "Additional needs experience" },
  { id: "bilingual", label: "Bilingual" },
  { id: "drives", label: "Drives / can do pickups" },
  { id: "cooks", label: "Cooks / handles meals" },
  /* Caregiver only (30 Sep): a parent cannot know it, and nobody checks it.
     `PARENT_STRENGTHS` leaves it out; her own flow keeps it, labelled as what it
     is. The id is unchanged so a stored one still reads. */
  { id: "cpr", label: "CPR / first aid (self-reported, not verified)" },
  { id: "no_screens", label: "Not a screens babysitter" },
  { id: "flexible_hours", label: "Flexible hours" },
];

/** What a parent is asked to tick: every strength but the one only she can state. */
export const PARENT_STRENGTHS: Option[] = CAREGIVER_STRENGTHS.filter(
  (s) => s.id !== "cpr",
);

export const CAREGIVER_FIT: Option[] = [
  { id: "first_time_parents", label: "First-time parents" },
  { id: "multiple_kids", label: "Two or more kids" },
  { id: "regular_schedule", label: "A regular weekly schedule" },
  { id: "occasional_nights", label: "Occasional nights out" },
  { id: "work_from_home", label: "Parents working from home" },
  { id: "school_runs", label: "School runs / after-school" },
  { id: "shy_or_anxious", label: "A shy or anxious child" },
  { id: "high_energy", label: "A high-energy child" },
];

/**
 * Bands, never a number.
 *
 * On the parent's side this is the most they can say about someone else's rate
 * without it reading as that person's wage. On the caregiver's side it is what
 * lets Pando answer "the range around here is $22–26" without quoting anyone —
 * which is exactly what the client asked for on the kickoff call, and the reason
 * a single stored number would be the wrong shape even here.
 */
export const CAREGIVER_PAY_BANDS: Option[] = [
  { id: "under_18", label: "Under $18/hr" },
  { id: "18_22", label: "$18–22/hr" },
  { id: "22_26", label: "$22–26/hr" },
  { id: "26_32", label: "$26–32/hr" },
  { id: "over_32", label: "$32+/hr" },
  { id: "salaried", label: "Salaried / other" },
  { id: "prefer_not_to_say", label: "Prefer not to say" },
];

/**
 * The windows a week is described in, and the reason this list is shared rather
 * than written twice: a parent saying "she worked weekday mornings" and a caregiver
 * saying "I'm free weekday mornings" is precisely the match Pando exists to make.
 *
 * The last chip differs by surface and is deliberately not shared — "it varied" is
 * a fact about a finished job, "ask me" is an offer about a future one, and neither
 * carries any matching value.
 */
const SCHEDULE_WINDOWS: Option[] = [
  { id: "weekday_mornings", label: "Weekday mornings" },
  { id: "weekday_afternoons", label: "Weekday afternoons" },
  { id: "weekday_evenings", label: "Weekday evenings" },
  /* "Weeknights (overnight)" said the same thing twice with a bracket; the id
     stays, because stored answers on both sides resolve against it. */
  { id: "weeknights", label: "Overnights" },
  /* "Saturdays" and "Sundays" were windows here until 29 Sep and said the same
     thing as Saturday and Sunday under "Specific days", so a caregiver could
     tick both. They live only in CAREGIVER_WEEKDAYS now. */
  /* 28 Sep, the developer: a custom choice of weekdays behind an option. It
     opens CAREGIVER_WEEKDAYS underneath on both surfaces, and the days it
     reveals are stored in the same array as the windows, so the parent's "she
     worked Tuesdays" and her own "I am free Tuesdays" are one id and can meet. */
  { id: "specific_days", label: "Specific days of the week" },
];

/**
 * The two windows that left `SCHEDULE_WINDOWS` on 29 Sep. Never offered: kept so
 * a stored `saturday` / `sunday` on an older nomination or sign-up still reads
 * as words in the admin instead of as a raw id.
 */
export const RETIRED_SCHEDULE_WINDOWS: Option[] = [
  { id: "saturday", label: "Saturdays" },
  { id: "sunday", label: "Sundays" },
];

/** The days `specific_days` opens. Stored beside the windows, never instead. */
export const CAREGIVER_WEEKDAYS: Option[] = [
  { id: "mon", label: "Monday" },
  { id: "tue", label: "Tuesday" },
  { id: "wed", label: "Wednesday" },
  { id: "thu", label: "Thursday" },
  { id: "fri", label: "Friday" },
  { id: "sat", label: "Saturday" },
  { id: "sun", label: "Sunday" },
];

/** Whether a "when" answer asked for particular days. */
export function wantsWeekdays(value: unknown): boolean {
  return Array.isArray(value) && value.includes("specific_days");
}

/**
 * Stage 1, parent's side: the shape of the week they actually employed them for.
 * The Product Strategy lists "schedule pattern" first among the Stage 1 captures,
 * and it is what turns a rate into a comparable one.
 */
export const CAREGIVER_SCHEDULE: Option[] = [
  ...SCHEDULE_WINDOWS,
  { id: "varied", label: "It varied", exclusive: true },
];

/**
 * Stage 1, parent's side: how big the job was. A band, like everything else about
 * money here — and "it varied" is a real answer rather than a missing one, because
 * an occasional sitter has no weekly number to give.
 */
export const CAREGIVER_HOURS: Option[] = [
  { id: "under_10", label: "Under 10 a week" },
  { id: "10_20", label: "10–20 a week" },
  { id: "20_35", label: "20–35 a week" },
  { id: "35_45", label: "35–45 (full-time)" },
  { id: "over_45", label: "45+ a week" },
  { id: "varied", label: "It varied", exclusive: true },
];

/**
 * Stage 1, parent's side: what came with the job. Without this a pay benchmark
 * compares a guaranteed-hours role with paid holidays against cash for date nights
 * and calls them the same rate — which is worse than having no benchmark.
 */
export const CAREGIVER_BENEFITS: Option[] = [
  { id: "guaranteed_hours", label: "Guaranteed hours" },
  { id: "paid_time_off", label: "Paid time off" },
  { id: "paid_holidays", label: "Paid holidays" },
  { id: "health_contribution", label: "Health contribution" },
  { id: "mileage", label: "Mileage or gas" },
  { id: "on_payroll", label: "On the books / payroll" },
  { id: "bonus", label: "Year-end bonus" },
  { id: "none", label: "None of these", exclusive: true },
  { id: "prefer_not_to_say", label: "Prefer not to say", exclusive: true },
];

/* ── 2C only ──────────────────────────────────────────────────────────────── */

/** G6. Days, not hours: a grid of times is a scheduling product, and this isn't one. */
export const CAREGIVER_DAYS: Option[] = [
  ...SCHEDULE_WINDOWS,
  { id: "flexible", label: "Flexible — ask me", exclusive: true },
];

/**
 * G6b. The client's example was "available from August 2027" — a nanny rolling off
 * when a child starts school. Stored as a window rather than that date, because a
 * date is right once and then quietly wrong, and what a parent asks is "can you
 * start when I need you", not "what is your date".
 */
export const CAREGIVER_AVAILABLE_FROM: Option[] = [
  { id: "now", label: "Now" },
  { id: "1_3_months", label: "In 1–3 months" },
  { id: "3_6_months", label: "In 3–6 months" },
  { id: "6_12_months", label: "In 6–12 months" },
  { id: "not_looking", label: "Not looking right now" },
];

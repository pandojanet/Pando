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

export const CAREGIVER_AGE_BANDS: Option[] = [
  { id: "baby", label: "Babies (0–1)" },
  { id: "toddler", label: "Toddlers (1–3)" },
  { id: "preschool", label: "Preschool (3–5)" },
  { id: "grade", label: "School age (5–11)" },
  { id: "tween", label: "Tweens & teens (11+)" },
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
  { id: "cpr", label: "CPR / first aid" },
  { id: "no_screens", label: "Not a screens babysitter" },
  { id: "flexible_hours", label: "Flexible hours" },
];

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
  { id: "weeknights", label: "Weeknights (overnight)" },
  { id: "saturday", label: "Saturdays" },
  { id: "sunday", label: "Sundays" },
];

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

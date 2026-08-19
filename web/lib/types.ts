/**
 * Shared types for the Pando Seed Tool (Phase 1).
 *
 * Naming follows the engineering spec's database schema so the payloads we
 * hand to the repo layer need no translation layer:
 *   social_affinities(affinity_type, affinity_value, score_weight)
 *   life_relevance(dimension, value)
 *   market_options(market_id, category, option_value)
 *   pending_options(market_id, category, submitted_value)
 */

export type MarketId = "pasadena";

/** Spec §7.1 — social affinity signal types and their point values. */
export type AffinityType =
  | "school"
  | "activity"
  | "neighborhood"
  | "social_group"
  | "faith_community"
  | "age_range"
  | "adjacent_neighborhood";

/** Spec §15.3 — life_relevance.dimension */
export type RelevanceDimension =
  | "budget"
  | "logistics"
  | "family_setup"
  /** Split out of family_setup at the client's request: structure ≠ childcare. */
  | "childcare"
  /** P8a — how long they've been in the area. New families need other answers. */
  | "tenure"
  | "trust_circle";

/**
 * Spec §15.3 — the `market_options.category` values the **questionnaire** draws
 * chips from. `camps` is v3.2's addition (§8.4): camp registration season is the
 * highest-intent local search of the year, and the dataset has to be built during
 * the pilot rather than in January.
 *
 * The eighth category in §15.3, `focus`, is deliberately absent: it is not a place
 * a family belongs to but the list of things a parent is willing to be asked
 * about, and the questionnaire asks that as static topic chips (P11/P12). It
 * exists in the table — see `supabase/seed.sql` — because that is what an admin
 * promotes an "other" topic into, and `scripts/import-market-options.mjs` accepts
 * it for the same reason.
 */
export const MARKET_CATEGORIES = [
  "neighborhoods",
  "schools",
  "worship",
  "clubs",
  "parent_groups",
  "baby_activities",
  "camps",
] as const;

export type MarketCategory = (typeof MARKET_CATEGORIES)[number];

/** Child-age buckets used only to decide which options are worth showing. */
export type AgeBand =
  | "expecting"
  | "baby" // 0–1
  | "toddler" // 1–3
  | "preschool" // 3–5
  | "grade" // 5–11
  | "tween" // 11–14
  | "teen"; // 14–18

/** Sentinel age used for "expecting" so childAges stays a number[]. */
export const EXPECTING = -1;

export interface Option {
  id: string;
  label: string;
  /** Short clarifier under the label. Use sparingly — chips should read at a glance. */
  hint?: string;
  /** Only offered when one of the parent's children falls in one of these bands. */
  bands?: AgeBand[];
  /** "None / prefer not to say" — selecting it clears every other choice. */
  exclusive?: boolean;
  /** In grid layouts, take two columns (long labels next to short ones). */
  wide?: boolean;
}

export type QuestionId =
  | "neighborhood"
  | "child_ages"
  | "schools"
  | "classes"
  | "camps"
  | "faith"
  | "clubs"
  | "time_in_area"
  | "moved_from"
  | "family_structure"
  | "childcare_now"
  | "logistics"
  | "budget"
  | "trust_circles"
  | "topics"
  | "topics_lived"
  /** P13 — the one control over how this parent is named in an answer. */
  | "attribution"
  | "allowance"
  | "listening_ear";

export interface Question {
  id: QuestionId;
  /** Label shown above the chips when a screen holds more than one question. */
  label?: string;
  kind: "single" | "multi" | "ages";
  required?: boolean;
  /** Where the chips come from. */
  source: { type: "static"; options: Option[] } | { type: "market"; category: MarketCategory };
  /** Writes a social_affinities row per selection, at this weight. */
  affinity?: { type: AffinityType; weight: number };
  /** Writes a life_relevance row per selection. */
  relevance?: RelevanceDimension;
  /** Offer a free-text fallback → pending_options for admin review. */
  allowOther?: boolean;
  otherLabel?: string;
  /** Hide the question entirely unless the child ages make it relevant. */
  showForBands?: AgeBand[];
  /** Hide it unless an earlier answer makes it worth asking (P8b). */
  when?: (answers: ProfileAnswers) => boolean;
  /**
   * Each selection carries its own follow-up tap (P5: current · former · not yet ·
   * homeschool). Stored in `answers.school_status`, keyed by option id.
   */
  perSelectionStatus?: { label: string; options: Option[] };
  /**
   * The answer belongs to a **child**, not to the household — a school, a class,
   * a camp. Each selection then asks whose it is, by the birth year the parent
   * already tapped, and only when there is more than one child to choose between.
   *
   * Without it "same school" matches two families whose children are nine years
   * apart, which is the opposite of what that signal is for. Stored in
   * `answers.child_of` and written to `child_birth_years` on the row it produces.
   */
  perChild?: boolean;
  /**
   * How many answers each child may carry, when one is not enough. Defaults to 1.
   *
   * Schools take **2**, because this screen invites former ones in so many words
   * ("or has attended — Former counts") and a single child routinely has both a
   * preschool and the school they moved on to. A flat one-per-child would have
   * made the screen contradict its own copy. Classes and camps stay at 1: those
   * are things a child is doing, not a history.
   */
  perChildLimit?: number;
}

export interface Screen {
  id: string;
  /** Small uppercase category label. */
  eyebrow: string;
  title: string;
  help?: string;
  /**
   * A screen that states something instead of asking it — the privacy disclosure
   * and the Pando promise. `questions` is empty; the parent reads and continues,
   * and the opt-out named in `note` is a standing one (texting PRIVACY).
   */
  statement?: { body: string[]; note?: string };
  questions: Question[];
}

export interface ProfileAnswers {
  neighborhood: string | null;
  /**
   * The raw taps. The parent sees **birth years** (P4); the stored value is the
   * age, because that is what gates later questions. It round-trips exactly — the
   * payload converts it back to the year they tapped (`childrenFromAges`).
   */
  child_ages: number[];
  schools: string[];
  /** P5 — school option id → current | former | not_yet | homeschool. */
  school_status: Record<string, string>;
  /**
   * Whose it is. Question id → option id → the **ages** tapped in P4 (the same
   * numbers as `child_ages`; a birth year is what the parent sees and what gets
   * stored, converted at capture like everything else child-shaped).
   *
   * Only asked when a family has more than one child, and skippable — an empty
   * entry means "they didn't say", never "nobody's".
   */
  child_of: Partial<Record<QuestionId, Record<string, number[]>>>;
  classes: string[];
  /** v3.2 §8.4 — the seasonal half of the same signal as `classes`. */
  camps: string[];
  faith: string[];
  clubs: string[];
  time_in_area: string | null;
  moved_from: string | null;
  family_structure: string[];
  childcare_now: string[];
  logistics: string[];
  /** "How you choose" — multi-select: one label per human is what we avoid. */
  budget: string[];
  trust_circles: string[];
  /** P12, split into the two clusters the client's list shows. */
  topics: string[];
  topics_lived: string[];
  /** P13 — anonymous_verified | first_name_safe. */
  attribution: string | null;
  /** P14 — monthly community-question allowance. A consent control, default 5. */
  allowance: string | null;
  /**
   * The listening-ear opt-in (18 Aug strategy addition, no P-number of its own):
   * willingness to occasionally answer another parent's hard question,
   * anonymously. `"opted_in" | "declined" | null` — null means skipped, not
   * declined, same rule as every other optional tap.
   */
  listening_ear: string | null;
  /** Free-text "other" entries, keyed by question id → pending_options. */
  other: Partial<Record<QuestionId, string[]>>;
  /** Screens the parent deliberately skipped (analytics + admin insight). */
  skipped: string[];
}

/**
 * A child, stored the way it stays true: birth year rather than age. `expecting`
 * carries a due year instead. `captured_at` on the payload says when the ages were
 * taken, so anything derived from them can be recomputed.
 */
export interface ChildRecord {
  birth_year: number | null;
  expecting: boolean;
  due_year: number | null;
  /** How the due year was arrived at, so nobody mistakes it for something asked. */
  due_year_precision?: "assumed_capture_year";
}

/** Everything the Seed Tool keeps for a contributor mid-flow. */
export interface SeedSession {
  /** Chat-seeding transcript, current draft and saved cards (estimate 1.4). */
  chat: import("./seed-chat/types").ChatState | null;
  version: 1;
  /** The invite code the link carried. Identifies a **group**, never a person. */
  invite_code: string | null;
  market_id: MarketId;
  /** "qr" | "link" | "direct" — where this contributor came from. */
  source: string;
  /**
   * QA run, not a real contributor: entered via `?test=1`. Travels with every
   * payload so test rows can be excluded from the graph and from pilot metrics —
   * without it, the first week of numbers is polluted by our own walkthroughs.
   */
  is_test: boolean;
  /** Kept for existing sessions; new ones fill first_name / last_name. */
  name: string | null;
  first_name: string | null;
  last_name: string | null;
  /**
   * Founding status needs a real, reachable person behind it. A parent may still
   * contribute anonymously — this flag records which path they took, and the
   * completion screen says plainly what the anonymous one costs.
   */
  wants_founding: boolean;
  /** True only after a one-time code is confirmed. Never assumed. */
  phone_verified: boolean;
  /** The SMS consent record: exact text version, timestamp, status. */
  sms_consent: import("./consent").ConsentRecord | null;
  /** E.164, optional at entry. Identity proper arrives with OTP in Phase 2. */
  phone: string | null;
  answers: ProfileAnswers;
  /** Index into the visible screen list. */
  screen_index: number;
  profile_saved_at: string | null;
  /**
   * Completion screen state (estimate 1.7). `follow_up_opt_in` is the one Phase 1
   * field that unlocks Phase 2 — it maps to blast_opt_in at migration — so it is
   * stored with the consent record that produced it, never as a bare boolean.
   */
  follow_up_opt_in: boolean | null;
  consent: import("./consent").ConsentRecord | null;
  /**
   * D1 — the one question this parent wants answered. `sensitivity` routes what
   * Pando says back, and a peer-support question is only stored on `may_save`.
   */
  demand: {
    question_text: string;
    category: string | null;
    sensitivity?: import("./demand").DemandSensitivity;
    may_save?: boolean;
  } | null;
  completed_at: string | null;
  started_at: string;
  updated_at: string;
}

/* ── Derived payload (what the backend stores) ───────────────────── */

export interface AffinityRow {
  affinity_type: AffinityType;
  affinity_value: string;
  score_weight: number;
  /**
   * Birth years, for the edges that belong to a child (school, class, camp).
   * Null on household-level edges and when the parent skipped saying whose it is.
   */
  child_birth_years?: number[] | null;
}

export interface RelevanceRow {
  dimension: RelevanceDimension;
  value: string;
}

export interface PendingOptionRow {
  market_id: MarketId;
  category: MarketCategory | QuestionId;
  submitted_value: string;
}

export interface ProfilePayload {
  invite_code: string | null;
  market_id: MarketId;
  source: string;
  is_test: boolean;
  name: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  /** Only true once a one-time code has been confirmed. */
  phone_verified: boolean;
  sms_consent: import("./consent").ConsentRecord | null;
  /**
   * The listening-ear opt-in, recorded the same way every other consent is —
   * append-only, with its own wording version — never as a bare boolean.
   * Null when the parent skipped the question rather than declined it.
   */
  listening_ear_consent: import("./consent").ConsentRecord | null;
  /** False = the anonymous path: contributions welcome, no founding status. */
  wants_founding: boolean;
  neighborhood: string | null;
  children: ChildRecord[];
  child_ages_at_capture: number[];
  profile_captured_at: string;
  /**
   * P14. Null when the parent chose "as many as are genuinely relevant" — the cap
   * is then the spacing and relevance rules alone, which is why `allowance_mode`
   * travels with it instead of a magic number.
   */
  monthly_contact_allowance: number | null;
  allowance_mode: "fixed" | "as_relevant";
  /**
   * P13 — how this parent may be named. Nothing else in the profile gates this.
   *
   * Two values or nothing, in the type as well as at runtime: the route already
   * fails an unrecognised attribution closed to null, and widening this to
   * `string` let that narrowing get lost again on the way to the database, where
   * the column is an enum and a stray value aborts the write.
   */
  attribution: "anonymous_verified" | "first_name_safe" | null;
  /**
   * Anonymous group mentions ("five parents at Oakwood…"), disclosed rather than
   * asked, so it defaults true. Texting PRIVACY sets it false.
   */
  aggregate_display: boolean;
  /** P12, both clusters, flattened — plus the lived-experience half on its own. */
  topic_preferences: string[];
  topics_lived_experience: string[];
  /** P5 — school option id → current | former | not_yet | homeschool. */
  school_status: Record<string, string>;
  time_in_area: string | null;
  moved_from: string | null;
  answers: ProfileAnswers;
  social_affinities: AffinityRow[];
  life_relevance: RelevanceRow[];
  pending_options: PendingOptionRow[];
  profile_completeness: number;
  client_started_at: string;
  client_submitted_at: string;
}

export interface InviteResult {
  valid: boolean;
  market_id: MarketId;
  market_label: string;
  /** Copy the landing page shows when the code is wrong or missing. */
  reason?: "missing" | "unknown";
  /**
   * Set only when the code resolved to a row in `invites` — a **group**, never a
   * person (see `lib/server/invite.ts`). The env-var codes carry no group, and an
   * unknown code carries nothing at all, so all three of these stay undefined
   * rather than being guessed.
   */
  invite_id?: string;
  /** How the group is named to the parent: "Field Elementary PTA". */
  group_label?: string;
  /**
   * The `market_options.parent_groups` value this group maps to, when an admin
   * linked it. It lets P6 *confirm* the group instead of asking — and only the
   * parent's yes turns it into an affinity edge.
   */
  group_option_value?: string | null;
}

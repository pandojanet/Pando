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
  /**
   * Item 11 (24 Aug): where a parent lived *before* here — "San Francisco, CA",
   * "London, UK". Canonical records, never free text, because the coarse signal
   * ("elsewhere in California" / "another state" / "another country") is
   * **derived** from the place rather than asked for separately.
   *
   * It sits in `market_options` with the rest so that search, the "add it"
   * fallback and an admin's promotion all work unchanged. It carries **no
   * starter set**, deliberately: there is no sensible list of 8-12 familiar
   * previous cities, so this question is search-only.
   */
  "previous_places",
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
  /**
   * Selecting this clears **these** options, and only these.
   *
   * The middle ground `exclusive` could not express, and the 1 Sep feedback
   * asked for it by name: *"'Parenting on my own' must clear 'Parenting with a
   * partner' and 'Co-parenting across households'"* — while "Blended family"
   * and "Grandparent involved" combine with it perfectly well. `exclusive`
   * would have cleared those too, which is a different and wrong answer.
   *
   * One direction only, deliberately. Tapping a partner option does **not**
   * clear "on my own": a parent correcting themselves taps the wrong one off,
   * and a rule that fired both ways would make the two chips fight each other
   * as the parent worked along the row.
   */
  clears?: string[];
  /** In grid layouts, take two columns (long labels next to short ones). */
  wide?: boolean;
  /**
   * The city or area this record belongs to. Only the searchable directories
   * carry it, and only because two records can share a name — there are three
   * "Willard Elementary School"s across districts, and her rule is not to merge
   * them, so the screen has to be able to say which one this is.
   */
  area?: string;
  /**
   * `area` as a slug, for comparing against the neighborhood id the parent
   * tapped — never compare against `area` itself.
   *
   * They are different vocabularies: `area` is the client's display name ("La
   * Cañada Flintridge") and the answer is an option id
   * ("la-canada-flintridge"). Comparing them with `toLowerCase()` bridged
   * single-word names and nothing else, so nine of seventeen areas silently
   * never matched and the parents in them were shown twelve schools in
   * alphabetical order, none in their own city.
   */
  area_slug?: string;
  /**
   * A visible grouping inside one question. Clubs use it for the two she asked
   * for ("Private, recreational & social clubs" vs "Service leagues & member
   * organizations"); faith carries the tradition, which is metadata and must
   * never become the displayed identity.
   */
  section?: string;
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
  /**
   * Item 11 split current tenure from local roots. Somebody can have grown up
   * here, moved away and come back — which the old single list could not say,
   * because "I grew up here" was one of the tenure options and therefore
   * mutually exclusive with all of them.
   */
  | "grew_up_here"
  | "previous_places"
  /**
   * Superseded by `previous_places` and no longer asked. Kept because stored
   * profiles point at it, and it is still what the coarse tenure signal is
   * *derived into* — "elsewhere in California" is now computed from the city the
   * parent actually named.
   */
  | "moved_from"
  | "family_structure"
  /**
   * The 24 Aug splits. Each was one screen mixing two different facts, and the
   * client's objection was not length — it was that the answers were not
   * comparable. "Two parents, one at home" could mean a stay-at-home parent or
   * one working from home; "solo parent" does not mean there is no co-parent.
   * Both halves keep the *same* `life_relevance` dimension as the screen they
   * came from, so no migration and nothing downstream changes shape.
   */
  | "work_setup"
  | "childcare_now"
  | "childcare_backup"
  | "travel_time"
  | "logistics"
  | "budget"
  | "trust_circles"
  | "topics"
  | "topics_lived"
  /** P13 — the one control over how this parent is named in an answer. */
  | "attribution"
  /**
   * Item 18's second half: whether a *shared connection* may stand in for the
   * name. Separate from `attribution` because it is a different amount of
   * exposure, and because the client's model shows a connection **instead of** a
   * name rather than alongside it.
   */
  | "shared_connections"
  /**
   * Privacy Guidance §A: which of the parent's own named connections may be
   * mentioned, one decision each. Its options are built from their earlier
   * answers, which is why `Question.source` has an `affiliations` kind.
   */
  | "shared_affiliations"
  | "allowance"
  | "listening_ear";

export interface Question {
  id: QuestionId;
  /** Label shown above the chips when a screen holds more than one question. */
  label?: string;
  kind: "single" | "multi" | "ages";
  required?: boolean;
  /** Where the chips come from. */
  source:
    | { type: "static"; options: Option[] }
    | { type: "market"; category: MarketCategory }
    /**
     * The parent's **own named connections**, built from what they already
     * tapped — schools, classes, camps, clubs, faith communities.
     *
     * A third kind rather than a static list, because the options are different
     * for every parent and cannot be written down in advance. It exists for one
     * question: the client's Privacy Guidance §A, which requires permission to
     * be available *separately for each affiliation* ("A parent may share their
     * school but keep their golf club or faith community private").
     */
    | { type: "affiliations" };
  /** Writes a social_affinities row per selection, at this weight. */
  affinity?: { type: AffinityType; weight: number };
  /** Writes a life_relevance row per selection. */
  relevance?: RelevanceDimension;
  /** Offer a free-text fallback → pending_options for admin review. */
  allowOther?: boolean;
  otherLabel?: string;
  /**
   * A hard ceiling on selections, for the questions that are a *ranking
   * instruction* rather than a description. The client asked for "up to three"
   * on both trust circles and practical priorities, and the reason is the same
   * in both: ten ticks is not a priority order, so an uncapped multi-select
   * produces no usable signal.
   *
   * Distinct from `perChildLimit`, which derives its cap from how many children
   * the family has. This one is a flat number.
   */
  maxSelections?: number;
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
  /**
   * **Ask this question once per child**, each with its own heading and its own
   * chip list — rather than once for the household with a "whose is it?" row
   * underneath every selection.
   *
   * 1 Sep, items 4 and 10: *"Repeat or associate the question separately for
   * each child"* and *"Capture care separately for each child."* The subject of
   * both sentences is **separately for each child**, which the old shape did
   * not do: it asked once and attributed *backwards*.
   *
   * Two things that were wrong with attributing backwards, and the second is
   * the one a parent actually felt. The screen asked a household question and
   * then made the parent do the sorting — six chips and six "which child?" rows
   * to fill in. And the chip list was the **union of every age band the family
   * covers**, so a family with a toddler and a teenager was shown preschools
   * and high schools together: her *"безліч опцій"* from 24 Aug, one level down
   * from where it was fixed.
   *
   * Per child, the list is filtered to *that* child's band, so each block is
   * short and every chip is plausible.
   *
   * **The storage does not change.** `answers[id]` stays the union of option
   * ids and `child_of[id][optionId]` stays the attribution, written forward
   * instead of backward — so `derive.ts`, the payload, the review screen and
   * the admin are all untouched, and there is no migration.
   *
   * Only for a family with more than one child; with one there is nothing to
   * repeat and the question renders exactly as it always did.
   */
  perChildRepeat?: boolean;
  /**
   * The heading over one child's block. `{year}` is replaced by their birth
   * year — her own suggested wording, so it is a template rather than prose
   * assembled in the component.
   */
  childHeading?: string;
  /**
   * Offer "use the same answers for every child".
   *
   * Item 10's own suggestion: *"If useful, offer 'Use the same care
   * arrangements for all children' to reduce repetition."* Only on the care
   * question — a school is the one thing siblings genuinely do not share, so
   * offering it there would invite a wrong answer.
   */
  sameForAll?: string;
}

export interface Screen {
  id: string;
  /** Small uppercase category label. */
  eyebrow: string;
  title: string;
  help?: string;
  /**
   * A line under the questions rather than above them — for a caveat that belongs
   * *after* the decision, not before it. The client's per-affiliation control has
   * one: "Members may sometimes be able to guess who you are, particularly in a
   * small community." It is the thing the control cannot promise, so it must be
   * read and not hidden in a tooltip.
   */
  footnote?: string;
  /**
   * Skip the whole screen unless an earlier answer makes it worth asking.
   *
   * `Question.when` already gates one question; this gates a screen, which is
   * different: a screen whose only question is hidden would otherwise render as
   * a title with nothing under it and a Continue button.
   */
  when?: (answers: ProfileAnswers) => boolean;
  /**
   * A screen that states something instead of asking it — the privacy disclosure
   * and the Pando promise. `questions` is empty; the parent reads and continues,
   * and the opt-out named in `note` is a standing one (texting PRIVACY).
   */
  /**
   * A screen that states rather than asks. `examples` renders as quoted lines —
   * the privacy explainer needs to *show* the sentence another parent would see,
   * because "an anonymous shared-connection mention" means nothing until you read
   * "A parent at your golf club recommends this."
   */
  statement?: {
    body: string[];
    examples?: string[];
    /**
     * Paragraphs that come **after** the examples.
     *
     * The privacy screen needed one (1 Sep, item 6): "your name and contact
     * information stay private unless you separately agree to an introduction"
     * is the answer to the question the examples raise, so it has to follow
     * them. Appending it to `body` would have put it above the sentences it
     * qualifies.
     */
    bodyAfter?: string[];
    note?: string;
    link?: { href: string; label: string };
  };
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
  /** Item 11: local roots, separate from tenure. Null means they didn't say. */
  grew_up_here: string | null;
  /** Item 11: canonical places, multi-select and optional. */
  previous_places: string[];
  /** No longer asked — derived from `previous_places`. See QuestionId. */
  moved_from: string | null;
  /** Who is in the household and how they parent. */
  family_structure: string[];
  /** How that household works — separated from the above on 24 Aug. */
  work_setup: string[];
  /** Each child's *regular* arrangement. */
  childcare_now: string[];
  /** What the household falls back on when the regular arrangement fails. */
  childcare_backup: string[];
  /** How far they will usually travel. Single-select, capped at one value. */
  travel_time: string[];
  logistics: string[];
  /**
   * How Pando should weigh cost. Single-select since 24 Aug, so this holds at
   * most one value — kept as an array because the relevance derivation, the route
   * sanitiser and the stored `life_relevance` rows all take lists, and a
   * one-element list needs none of them to change.
   */
  budget: string[];
  trust_circles: string[];
  /** P12, split into the two clusters the client's list shows. */
  topics: string[];
  topics_lived: string[];
  /** P13 — anonymous_verified | first_name_safe. */
  attribution: string | null;
  /**
   * Item 18's second half. Null means off, and that is the client's rule rather
   * than a convenience: skipping the page keeps the name private and shared
   * connections off, because "Continue" is not consent.
   */
  shared_connections: string | null;
  /**
   * Privacy Guidance §A: which named connections may be mentioned. Absence *is*
   * the private default — an affiliation is never shareable unless it appears
   * here, so nothing a parent skips can grant anything.
   */
  shared_affiliations: string[];
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

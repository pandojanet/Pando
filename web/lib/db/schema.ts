import { sql } from "drizzle-orm";
import {
  boolean,
  char,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * The data model, in Drizzle.
 *
 * Ported from `supabase/migrations/0001_schema.sql`, which stays in the repo as
 * the applied baseline. This file is the source of truth from here on.
 *
 * The principle the SQL was written under still holds, and matters more now that
 * the logic sits in TypeScript rather than on an n8n canvas: **an invariant that
 * can be a constraint is a constraint.** Application code is where the rules are
 * expressed, but a CHECK is what makes a wrong write fail instead of storing
 * something unsafe. Every constraint below is load-bearing — the comment says
 * which invariant from CLAUDE.md it encodes. Do not relax one to make a query
 * pass.
 */

/* ── Types ──────────────────────────────────────────────────────────────────
   Enums only where the value set is safety-critical. Anything Janet may want to
   extend later (care_type, price_band, category) stays text + CHECK or free
   text, so adding a value is not a migration. */

export const foundingStatus = pgEnum("founding_status", [
  "none",
  "pending_founding",
  "founding",
  "request_invite",
]);
export const allowanceMode = pgEnum("allowance_mode", ["fixed", "as_relevant"]);
export const attributionMode = pgEnum("attribution_mode", [
  "anonymous_verified",
  "first_name_safe",
]);
export const provenance = pgEnum("provenance", [
  "parent_submitted",
  "admin_entered",
  "migrated",
]);
export const reviewStatus = pgEnum("review_status", [
  "pending_review",
  "needs_detail",
  "approved",
  "rejected",
]);
export const consentStatus = pgEnum("consent_status", [
  "mentioned",
  "invited",
  "consented",
  "declined",
  "revoked",
]);
export const shareKind = pgEnum("share_kind", [
  "activity",
  "caregiver",
  "place",
  "tip",
]);

/* ── 0. Invites (estimate 1.1) ────────────────────────────────────────────── */

/**
 * One invite per **group**, never per parent.
 *
 * The 31 Jul decision — reaffirmed 12 Aug against QC Answers Q3 — is that there is
 * no unique link per founding contributor. A row here is a parent group, shared by
 * everyone in it; the day a row means one person, cross-device resume, automatic
 * referral attribution and `/seed/[token]` arrive with it, and that is a different
 * decision that has been made twice already.
 *
 * The code is a **soft gate**, not authentication: it keeps the tool off the open
 * web and says which group a contributor came through. `SEED_INVITE_CODES` stays
 * as the fallback for an unconfigured database.
 */
export const invites = pgTable(
  "invites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** What goes in the URL: `?i=pta-field`. */
    code: text("code").notNull().unique(),
    marketId: text("market_id").notNull(),
    /** Shown to the parent, so it reads like a person wrote it. */
    label: text("label").notNull(),
    /**
     * Optional `market_options.parent_groups` value. When set, P6 confirms the
     * group instead of asking for it — and **only the parent's yes writes the
     * affinity edge**. A link that was forwarded out of the group is not evidence
     * that the person who opened it belongs to it.
     */
    groupOptionValue: text("group_option_value"),
    active: boolean("active").notNull().default(true),
    /** The admin's own note: where it was posted, who runs the group. */
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdBy: text("created_by"),
  },
  (t) => [
    check("invites_code_check", sql`${t.code} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
  ],
);

/* ── 1. Identity (estimate 1.1, 1.10 · invariants 10, 11) ─────────────────── */

/**
 * One person, one row, keyed by phone. "Contributor" is a derived status from
 * approved contributions, never a second table (invariant 10).
 */
export const people = pgTable(
  "people",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** E.164. Null = the anonymous path. */
    phone: text("phone").unique(),
    firstName: text("first_name"),
    lastName: text("last_name"),
    marketId: text("market_id").notNull().default("pasadena"),
    neighborhood: text("neighborhood"),
    inviteCode: text("invite_code"),
    /**
     * The resolved `invites` row, so "which group delivered contributors" is a
     * join rather than string-matching `invite_code`. Null is ordinary: no code,
     * a retired one, or a parent who arrived before invites existed.
     */
    inviteId: uuid("invite_id").references(() => invites.id, {
      onDelete: "set null",
    }),
    /** P6: which group the link came from — the parent's own answer, not the link's. */
    invitedViaGroup: text("invited_via_group"),
    /** 'link' | 'qr' | 'direct' */
    source: text("source"),
    /** P8a */
    timeInArea: text("time_in_area"),
    /** P8b */
    movedFrom: text("moved_from"),

    /**
     * P13 + the disclosed aggregate rule. Display only: matching always uses the
     * full profile (client's design rule 7).
     */
    attribution: attributionMode("attribution"),
    aggregateDisplay: boolean("aggregate_display").notNull().default(true),

    /**
     * P14. Null allowance with mode 'as_relevant' means spacing and relevance
     * rules alone decide — the send layer must not invent a number.
     */
    monthlyContactAllowance: integer("monthly_contact_allowance"),
    allowanceMode: allowanceMode("allowance_mode").notNull().default("fixed"),

    /**
     * P12 — what this parent is willing to be asked about. It decides which
     * questions Pando brings them, so it is a first-class column, not something
     * to re-derive from `raw_answers` later. The lived-experience half is kept
     * separately because it is the sensitive one: it is about willingness to
     * help, never about whether they went through it.
     */
    topicPreferences: text("topic_preferences")
      .array()
      .notNull()
      .default(sql`'{}'`),
    topicsLivedExperience: text("topics_lived_experience")
      .array()
      .notNull()
      .default(sql`'{}'`),

    /**
     * Which path they took at the entry screen. `founding = 'none'` implies it,
     * but the funnel question "how many chose anonymous" deserves a real answer.
     */
    wantsFounding: boolean("wants_founding").notNull().default(true),

    /**
     * Every tap, as captured. Not a substitute for the derived tables — matching
     * never reads this — but it is the answer to "what did the parent actually
     * choose", including their skipped list and their free-text "other" entries.
     */
    rawAnswers: jsonb("raw_answers"),
    childAgesAtCapture: integer("child_ages_at_capture").array(),

    /** A server fact from a completed OTP, never a claim from a browser. */
    phoneVerifiedAt: timestamp("phone_verified_at", { withTimezone: true }),
    founding: foundingStatus("founding").notNull().default("none"),
    profileCompleteness: integer("profile_completeness").notNull().default(0),
    profileCapturedAt: timestamp("profile_captured_at", { withTimezone: true }),
    isTest: boolean("is_test").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check(
      "allowance_shape",
      sql`(${t.allowanceMode} = 'as_relevant' and ${t.monthlyContactAllowance} is null) or (${t.allowanceMode} = 'fixed' and ${t.monthlyContactAllowance} in (1,3,5))`,
    ),
    /* Nothing about a named parent is stored before verification (invariant 11). */
    check(
      "verified_if_named",
      sql`${t.phone} is null or ${t.phoneVerifiedAt} is not null`,
    ),
    index("people_market_idx")
      .on(t.marketId)
      .where(sql`not is_test`),
    index("people_founding_idx")
      .on(t.founding)
      .where(sql`not is_test`),
    index("people_created_idx").on(sql`${t.createdAt} desc`),
  ],
);

/**
 * Consents are append-only records, never booleans: the wording version and the
 * timestamp are the artefact. Bumping wording means a new text_version, never an
 * edit (web/lib/consent.ts).
 */
export const consents = pgTable(
  "consents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    scope: text("scope").notNull(),
    status: text("status").notNull(),
    source: text("source").notNull(),
    textVersion: text("text_version").notNull(),
    capturedAt: timestamp("captured_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    /** Widened by 0004 for 2C — the caregiver's own four permissions (G2, G8–G10). */
    check(
      "consents_scope_check",
      sql`${t.scope} in ('sms','follow_up','blast','reference','caregiver_profile','caregiver_listing','caregiver_introduction','caregiver_reference')`,
    ),
    check(
      "consents_status_check",
      sql`${t.status} in ('opted_in','declined','revoked')`,
    ),
    index("consents_person_idx").on(
      t.personId,
      t.scope,
      sql`${t.capturedAt} desc`,
    ),
  ],
);

/**
 * The list the send layer reads first (invariant 6, step 1). STOP writes here;
 * START and UNSTOP are the only keywords that clear it — never YES, because
 * "yes" is an answer to a Network Ask.
 */
export const smsOptOuts = pgTable("sms_opt_outs", {
  phone: text("phone").primaryKey(),
  keyword: text("keyword").notNull(),
  optedOutAt: timestamp("opted_out_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/* ── 2. Children and matching (estimate 1.3) ─────────────────────────────── */

/**
 * Birth years, not ages (client, explicit). due_year_precision records that an
 * expecting parent's year was assumed from the capture date, not asked.
 */
export const children = pgTable(
  "children",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    birthYear: integer("birth_year"),
    expecting: boolean("expecting").notNull().default(false),
    dueYear: integer("due_year"),
    dueYearPrecision: text("due_year_precision"),
  },
  (t) => [
    check(
      "children_due_year_precision_check",
      sql`${t.dueYearPrecision} in ('assumed_capture_year','stated')`,
    ),
    check(
      "year_shape",
      sql`(${t.expecting} and ${t.birthYear} is null and ${t.dueYear} is not null) or (not ${t.expecting} and ${t.birthYear} is not null)`,
    ),
    index("children_person_idx").on(t.personId),
  ],
);

/**
 * Weights are resolved from config at query time (spec §18.1 wins over §8.1), so
 * weight_at_capture is informational: nothing may join on it.
 */
export const socialAffinities = pgTable(
  "social_affinities",
  {
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    affinityType: text("affinity_type").notNull(),
    affinityValue: text("affinity_value").notNull(),
    weightAtCapture: integer("weight_at_capture"),
  },
  (t) => [
    primaryKey({ columns: [t.personId, t.affinityType, t.affinityValue] }),
    index("social_affinities_lookup_idx").on(t.affinityType, t.affinityValue),
  ],
);

export const lifeRelevance = pgTable(
  "life_relevance",
  {
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    dimension: text("dimension").notNull(),
    value: text("value").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.personId, t.dimension, t.value] }),
    check(
      "life_relevance_dimension_check",
      sql`${t.dimension} in ('budget','logistics','family_setup','childcare','tenure','trust_circle')`,
    ),
  ],
);

/** Weights as data, so a change is a config edit and not a migration. */
export const affinityWeights = pgTable(
  "affinity_weights",
  {
    affinityType: text("affinity_type").primaryKey(),
    weight: integer("weight").notNull(),
  },
  (t) => [check("affinity_weights_weight_check", sql`${t.weight} > 0`)],
);

/** P5: a former school is a different signal from a current one, and both matter. */
export const personSchools = pgTable(
  "person_schools",
  {
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    optionValue: text("option_value").notNull(),
    status: text("status").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.personId, t.optionValue] }),
    check(
      "person_schools_status_check",
      sql`${t.status} in ('current','former','not_yet','homeschool')`,
    ),
  ],
);

/* ── 3. Taxonomy (estimate 2.6) ──────────────────────────────────────────── */

export const marketOptions = pgTable(
  "market_options",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    marketId: text("market_id").notNull(),
    category: text("category").notNull(),
    optionValue: text("option_value").notNull(),
    label: text("label").notNull(),
    bands: text("bands").array(),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("market_options_market_id_category_option_value_key").on(
      t.marketId,
      t.category,
      t.optionValue,
    ),
    index("market_options_lookup_idx")
      .on(t.marketId, t.category)
      .where(sql`active`),
  ],
);

/**
 * "Other" answers are not matchable until an admin promotes them (invariant 9).
 * Nothing in a matching or answering path may read this table.
 */
export const pendingOptions = pgTable(
  "pending_options",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    marketId: text("market_id").notNull(),
    category: text("category").notNull(),
    submittedValue: text("submitted_value").notNull(),
    submittedBy: uuid("submitted_by").references(() => people.id, {
      onDelete: "set null",
    }),
    occurrences: integer("occurrences").notNull().default(1),
    status: text("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check(
      "pending_options_status_check",
      sql`${t.status} in ('pending','approved','rejected')`,
    ),
    unique("pending_options_market_id_category_submitted_value_key").on(
      t.marketId,
      t.category,
      t.submittedValue,
    ),
  ],
);

/* ── 4. Contributions (estimate 1.4–1.6, 1.8, 2.4) ───────────────────────── */

/**
 * The card exactly as captured, never edited. Corrections re-send the same
 * client_id and overwrite `fields`; the curated rows below are what an admin
 * edits. This is the answer to "did the parent actually say that".
 */
export const submissions = pgTable(
  "submissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** The idempotency key. */
    clientId: text("client_id").notNull().unique(),
    personId: uuid("person_id").references(() => people.id, {
      onDelete: "set null",
    }),
    kind: shareKind("kind").notNull(),
    fields: jsonb("fields").notNull(),
    isTest: boolean("is_test").notNull().default(false),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("submissions_person_idx").on(t.personId, sql`${t.receivedAt} desc`),
  ],
);

/**
 * **The subject of a recommendation** — an activity, a camp, a place or a tip.
 * Renamed from `places` on 12 Aug (drizzle 0009): the structure was right and the
 * word was wrong, because a music class is not a place and a piece of advice
 * certainly isn't.
 *
 * Not to be confused with `submissions`, which is the raw card exactly as it was
 * typed. A submission is an event — "did the parent actually say that". A share is
 * the thing it was about, and five parents recommending one class is five
 * `share_contributions` rows against one `shares` row.
 *
 * Activities, camps, places and tips share one subject table: they differ by
 * `kind`, not by shape, and an admin reviews them in one queue.
 */
export const shares = pgTable(
  "shares",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    marketId: text("market_id").notNull(),
    kind: shareKind("kind").notNull(),
    name: text("name").notNull(),
    venue: text("venue"),
    neighborhoods: text("neighborhoods").array(),
    ageBands: text("age_bands").array(),
    /** park | library | … (place cards) */
    placeType: text("place_type"),
    /** tip cards */
    topic: text("topic"),
    status: reviewStatus("status").notNull().default("pending_review"),
    provenance: provenance("provenance").notNull().default("parent_submitted"),
    confidence: numeric("confidence", { precision: 3, scale: 2 }),

    /**
     * Spec v3.2 §17.1 — the pre-launch golden-answer pass. An admin marks the
     * records already complete enough to answer a common local question with no
     * Blast behind them, prioritised by the demand signals in `demand_signals`.
     *
     * Set only by an admin (`place.answer_ready`), and only on an approved place:
     * the CHECK below is what stops it becoming a route for unreviewed parent
     * text to reach an answer.
     */
    answerReady: boolean("answer_ready").notNull().default(false),

    /** Freshness (v3.2 pings). last_confirmed_at is what a ping refreshes. */
    lastConfirmedAt: timestamp("last_confirmed_at", { withTimezone: true }),
    lastPingedAt: timestamp("last_pinged_at", { withTimezone: true }),
    freshnessState: text("freshness_state").notNull().default("fresh"),
    validatedCount: integer("validated_count").notNull().default(0),
    isTest: boolean("is_test").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check("shares_kind_check", sql`${t.kind} <> 'caregiver'`),
    /* "Good enough to answer with" must be a superset of "a human read it". */
    check(
      "shares_answer_ready_check",
      sql`not ${t.answerReady} or ${t.status} = 'approved'`,
    ),
    check(
      "shares_confidence_check",
      sql`${t.confidence} is null or (${t.confidence} >= 0 and ${t.confidence} <= 1)`,
    ),
    check(
      "shares_freshness_state_check",
      sql`${t.freshnessState} in ('fresh','ageing','stale')`,
    ),
    index("shares_market_idx")
      .on(t.marketId, t.kind, t.status)
      .where(sql`not is_test`),
    index("shares_name_trgm_idx").using(
      "gin",
      sql`lower(${t.name}) gin_trgm_ops`,
    ),
  ],
);

/**
 * One parent's experience of one place. R1–R11 land here, so five parents
 * recommending the same class is five rows and one place.
 */
export const shareContributions = pgTable(
  "share_contributions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shareId: uuid("share_id")
      .notNull()
      .references(() => shares.id, { onDelete: "cascade" }),
    personId: uuid("person_id").references(() => people.id, {
      onDelete: "set null",
    }),
    submissionId: uuid("submission_id").references(() => submissions.id, {
      onDelete: "set null",
    }),

    /**
     * R2. The label system and Founding eligibility both rest on this column: a
     * secondhand contribution is welcome, labelled, and never qualifying.
     */
    firsthand: boolean("firsthand").notNull(),
    childAgeAtTime: integer("child_age_at_time").array(),
    /** current | recent | over_year | unsure */
    lastThere: text("last_there"),
    howMuch: text("how_much"),
    /** yes | yes_with_caveats | probably_not | no */
    recommendation: text("recommendation"),
    whatMakesItGreat: text("what_makes_it_great"),
    caveat: text("caveat"),
    /**
     * R7: "nothing comes to mind" counts as answered, and Founding depends on
     * the distinction between answered-and-empty and never-asked.
     */
    caveatAnswered: boolean("caveat_answered").notNull().default(false),
    whoFor: text("who_for"),
    whoNotFor: text("who_not_for"),
    priceBand: text("price_band"),
    /** per_class | per_session | per_month | per_term | per_camp_week */
    priceUnit: text("price_unit"),
    /** great_value | fair | pricey_worth_it | pricey_not_worth_it | free */
    worthIt: text("worth_it"),
    followUpOk: boolean("follow_up_ok").notNull().default(false),
    /** tip cards keep their one sentence here */
    tipText: text("tip_text"),

    /**
     * 1.8's score for *this contribution's* free text — not for the place. The
     * extractor reads `what_makes_it_great` / `caveat` / `tip_text` / `who_for` /
     * `who_not_for`, all of which live on this row, and the admin's
     * "Low confidence" filter counts contributions below 0.6.
     *
     * Null is a real state and must stay nullable: no API key, a pure-tap card
     * with nothing to judge, or a declined classification all leave it unset, and
     * a guessed number would sort a card out of the queue meant to catch it.
     */
    confidence: numeric("confidence", { precision: 3, scale: 2 }),

    status: reviewStatus("status").notNull().default("pending_review"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approvedBy: text("approved_by"),
    isTest: boolean("is_test").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    /**
     * A band without a unit is unusable: $100/month and $100/term are different
     * recommendations.
     */
    check(
      "price_shape",
      sql`${t.priceBand} is null or ${t.priceBand} in ('free','prefer_not_to_say') or ${t.priceUnit} is not null`,
    ),
    check(
      "share_contributions_confidence_check",
      sql`${t.confidence} is null or (${t.confidence} >= 0 and ${t.confidence} <= 1)`,
    ),
    /* One parent, one contribution per place. A correction upserts, never doubles. */
    unique("share_contributions_share_id_submission_id_key").on(
      t.shareId,
      t.submissionId,
    ),
    index("share_contributions_share_idx").on(t.shareId),
    index("share_contributions_person_idx").on(t.personId, t.status),
    index("share_contributions_review_idx")
      .on(t.status, t.createdAt)
      .where(sql`not is_test`),
  ],
);

/* ── 5. Caregivers (estimate 1.6, 2.5, 2C · invariants 1, 2, 12, 13, 14) ─── */

/**
 * The visibility ladder: mentioned → invited → consented → discoverable →
 * introducible. It only ever increases, and only by the caregiver's own action.
 * Note what is absent: no phone, no email, no address. Pando does not contact a
 * nominated caregiver and stores no way to (invariant 13).
 */
export const caregivers = pgTable(
  "caregivers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    marketId: text("market_id").notNull(),
    firstName: text("first_name").notNull(),
    lastInitial: char("last_initial", { length: 1 }),
    isAdult: boolean("is_adult").notNull(),
    consentStatus: consentStatus("consent_status").notNull().default("mentioned"),
    active: boolean("active").notNull().default(false),
    discoverable: boolean("discoverable").notNull().default(false),
    introducible: boolean("introducible").notNull().default(false),
    /** Set only by the caregiver's own flow (2C), when she creates her profile. */
    profilePersonId: uuid("profile_person_id").references(() => people.id, {
      onDelete: "set null",
    }),
    /** { method, note, at } — required to reach 'consented'. */
    consentEvidence: jsonb("consent_evidence"),
    provenance: provenance("provenance").notNull().default("parent_submitted"),
    isTest: boolean("is_test").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    /* No minors, ever. Not "stored as pending" — refused (invariant 2). */
    check("adults_only", sql`${t.isAdult}`),
    /* Invariant 1 as a constraint, not a hope. */
    check(
      "visibility_requires_consent",
      sql`(not ${t.active} and not ${t.discoverable} and not ${t.introducible}) or ${t.consentStatus} = 'consented'`,
    ),
    check("ladder_order", sql`not ${t.introducible} or ${t.discoverable}`),
    /* Recording consent requires evidence (31 Jul decision). */
    check(
      "consent_needs_evidence",
      sql`${t.consentStatus} <> 'consented' or ${t.consentEvidence} is not null`,
    ),
    index("caregivers_market_idx")
      .on(t.marketId, t.consentStatus)
      .where(sql`not is_test`),
    index("caregivers_name_trgm_idx").using(
      "gin",
      sql`lower(${t.firstName}) gin_trgm_ops`,
    ),
  ],
);

/** One nomination by one parent (C1–C11). */
export const caregiverNominations = pgTable(
  "caregiver_nominations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    caregiverId: uuid("caregiver_id")
      .notNull()
      .references(() => caregivers.id, { onDelete: "cascade" }),
    personId: uuid("person_id").references(() => people.id, {
      onDelete: "set null",
    }),
    submissionId: uuid("submission_id").references(() => submissions.id, {
      onDelete: "set null",
    }),

    /** C1, the hard gate. */
    workedForFamily: boolean("worked_for_family").notNull(),
    /** C2 */
    careType: text("care_type"),
    howKnown: text("how_known"),
    howLong: text("how_long"),
    /** C3. Also answers "are they still employed by you": `current`. */
    lastWorked: text("last_worked"),
    /**
     * Stage 1 of the Product Strategy's caregiver ladder: "schedule pattern …
     * rate, hours and benefits". The band alone cannot separate a guaranteed-hours
     * 40-hour role from ten hours of date nights, and pay benchmarking (C9) on the
     * first without the second is a misleading aggregate rather than a useful one.
     * All three are skippable.
     */
    schedulePattern: text("schedule_pattern").array(),
    hoursPerWeek: text("hours_per_week"),
    benefits: text("benefits").array(),
    /** C4 */
    caredForAges: text("cared_for_ages").array(),
    /** C5, closed */
    strengths: text("strengths").array(),
    inTheirWords: text("in_their_words"),
    /** C6a */
    goodFitFor: text("good_fit_for").array(),
    /** C6a, shareable after review */
    caveat: text("caveat"),
    /** C7 */
    hireAgain: text("hire_again"),
    /** C10 */
    needsHorizon: text("needs_horizon"),
    needsChangeType: text("needs_change_type"),
    recontactOk: boolean("recontact_ok").notNull().default(false),
    /** C9 */
    payBand: text("pay_band"),
    /** A separate decision from the band itself. */
    payBenchmarkConsent: boolean("pay_benchmark_consent")
      .notNull()
      .default(false),
    /** C8, from the parent not the caregiver. */
    referenceWilling: text("reference_willing"),
    /** C11 */
    inviteSentByParent: boolean("invite_sent_by_parent").notNull().default(false),

    reviewHold: boolean("review_hold").notNull().default(false),
    holdReasons: text("hold_reasons")
      .array()
      .notNull()
      .default(sql`'{}'`),
    status: reviewStatus("status").notNull().default("pending_review"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approvedBy: text("approved_by"),
    isTest: boolean("is_test").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check(
      "caregiver_nominations_hire_again_check",
      sql`${t.hireAgain} in ('yes','hesitant','no')`,
    ),
    /* Firsthand only. A secondhand nomination is refused, not stored weaker
       (invariant 14). */
    check("firsthand_only", sql`${t.workedForFamily}`),
    /* Anything short of a clear yes cannot be released automatically. */
    check(
      "hold_when_hesitant",
      sql`${t.hireAgain} is null or ${t.hireAgain} = 'yes' or ${t.reviewHold}`,
    ),
    unique("caregiver_nominations_caregiver_id_submission_id_key").on(
      t.caregiverId,
      t.submissionId,
    ),
    index("caregiver_nominations_cg_idx").on(t.caregiverId),
    index("caregiver_nominations_review_idx")
      .on(t.status, t.reviewHold, t.createdAt)
      .where(sql`not is_test`),
  ],
);

/**
 * C6b, and the reason behind a hesitant C7. Never shown to a family, never shown
 * to the caregiver, never AI-summarized — and in its own table so that
 * `select * from caregiver_nominations` cannot leak it (invariant 12).
 */
export const restrictedNotes = pgTable(
  "restricted_notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    nominationId: uuid("nomination_id")
      .notNull()
      .references(() => caregiverNominations.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check(
      "restricted_notes_kind_check",
      sql`${t.kind} in ('private_note','hesitation_reason')`,
    ),
    index("restricted_notes_nom_idx").on(t.nominationId),
  ],
);

/** 2C, G3–G7. Created by the caregiver herself, after G2 consent. */
export const caregiverProfiles = pgTable("caregiver_profiles", {
  caregiverId: uuid("caregiver_id")
    .primaryKey()
    .references(() => caregivers.id, { onDelete: "cascade" }),
  rolesWanted: text("roles_wanted").array(),
  ageExperience: text("age_experience").array(),
  /** Same closed list as the parent's nomination — see lib/caregiver-options.ts. */
  strengths: text("strengths").array(),
  areasServed: text("areas_served").array(),
  drives: boolean("drives"),
  daysAvailable: text("days_available").array(),
  hoursNote: text("hours_note"),
  rateBand: text("rate_band"),
  /** A window, not a date: "available from August 2027" goes stale silently. */
  availableFrom: text("available_from"),
  openToReferenceIntros: boolean("open_to_reference_intros")
    .notNull()
    .default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * 2C — a caregiver's self-registration, before an admin has decided which
 * nomination it belongs to.
 *
 * Deliberately **not** a `caregivers` row. The invite is one shared link with no
 * token (there is no contact detail to key one against — invariant 13), so a
 * caregiver arrives unlinked and we cannot know which nomination is theirs;
 * matching on a first name and an initial is the one thing `cards.ts` already
 * refuses to do. And the client's rule is that a caregiver reaches Pando only
 * through a parent's invite, so a self-made listing must not exist: a claim is
 * invisible to every answering path until a human attaches it.
 *
 * `drizzle/0004_caregiver_claims.sql` carries the long version of the reasoning.
 */
export const caregiverClaims = pgTable(
  "caregiver_claims",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** G1. Their own identity, verified — invariant 10 applies to them too. */
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    marketId: text("market_id").notNull().default("pasadena"),
    firstName: text("first_name").notNull(),
    lastInitial: char("last_initial", { length: 1 }),
    rolesWanted: text("roles_wanted").array().notNull().default([]),
    ageExperience: text("age_experience").array().notNull().default([]),
    /** Same ids as the parent side, or a claim and a nomination never meet. */
    strengths: text("strengths").array().notNull().default([]),
    areasServed: text("areas_served").array().notNull().default([]),
    drives: boolean("drives"),
    daysAvailable: text("days_available").array().notNull().default([]),
    hoursNote: text("hours_note"),
    rateBand: text("rate_band"),
    availableFrom: text("available_from"),
    /** G8–G10 — three decisions, never one visibility level. */
    openToReferenceIntros: boolean("open_to_reference_intros")
      .notNull()
      .default(false),
    appearInAnswers: boolean("appear_in_answers").notNull().default(false),
    openToIntroductions: boolean("open_to_introductions")
      .notNull()
      .default(false),
    consentTextVersion: text("consent_text_version").notNull(),
    status: text("status").notNull().default("pending"),
    linkedCaregiverId: uuid("linked_caregiver_id").references(
      () => caregivers.id,
      { onDelete: "set null" },
    ),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedBy: text("resolved_by"),
    isTest: boolean("is_test").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check(
      "caregiver_claims_status_check",
      sql`${t.status} in ('pending','linked','declined')`,
    ),
    /** Being introduced is more exposure than being named. It cannot be the only yes. */
    check(
      "claim_ladder_order",
      sql`not ${t.openToIntroductions} or ${t.appearInAnswers}`,
    ),
    unique("caregiver_claims_person_key").on(t.personId),
  ],
);

/* ── 6. Review, demand, audit (estimate 1.9, 2.7, 2.8 · v3.2) ────────────── */

export const flags = pgTable(
  "flags",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    severity: text("severity").notNull(),
    reason: text("reason").notNull(),
    subjectKind: text("subject_kind"),
    subjectId: uuid("subject_id"),
    personId: uuid("person_id").references(() => people.id, {
      onDelete: "set null",
    }),
    field: text("field"),
    /** Shown on the admin surface only. */
    excerpt: text("excerpt"),
    confidence: numeric("confidence", { precision: 3, scale: 2 }),
    status: text("status").notNull().default("open"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedBy: text("resolved_by"),
    resolutionNote: text("resolution_note"),
  },
  (t) => [
    check(
      "flags_severity_check",
      sql`${t.severity} in ('escalation','review','note')`,
    ),
    check(
      "flags_status_check",
      sql`${t.status} in ('open','resolved','escalated')`,
    ),
    index("flags_open_idx").on(t.status, t.severity, sql`${t.createdAt} desc`),
  ],
);

/**
 * D1. `sensitivity` decides what Pando said back; `requires_human_review` keeps a
 * sensitive question out of the knowledge base until a person has read it.
 */
export const demandSignals = pgTable(
  "demand_signals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    personId: uuid("person_id").references(() => people.id, {
      onDelete: "set null",
    }),
    questionText: text("question_text").notNull(),
    category: text("category"),
    /**
     * Spec v3.2 §9 / §15.1 and QC Answers Q7. Read from the asker's own profile on
     * the server, never from the request body — this column is the market-expansion
     * signal ("demand by area"), and a client-supplied value would be a way to vote
     * for where Pando launches next. Null on the anonymous path, which has no
     * identity to read it from.
     */
    neighborhood: text("neighborhood"),
    sensitivity: text("sensitivity").notNull(),
    requiresHumanReview: boolean("requires_human_review")
      .notNull()
      .default(false),
    status: text("status").notNull().default("open"),
    isTest: boolean("is_test").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check(
      "demand_signals_sensitivity_check",
      sql`${t.sensitivity} in ('ordinary','peer_support','high_stakes','named_allegation')`,
    ),
    /**
     * The Product Strategy rule for a claim about a named person, made structural:
     * "human review only; never broadly circulated or automatically written into
     * the knowledge base". A code path can forget to set the flag; this cannot.
     */
    check(
      "demand_signals_allegation_review_check",
      sql`${t.sensitivity} <> 'named_allegation' or ${t.requiresHumanReview}`,
    ),
    check(
      "demand_signals_status_check",
      sql`${t.status} in ('open','matched','answered','closed')`,
    ),
    index("demand_signals_queue_idx")
      .on(t.status, t.sensitivity, sql`${t.createdAt} desc`)
      .where(sql`not is_test`),
  ],
);

/** Written by one path only, so it cannot be forgotten (admin write, §3.7). */
export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    actor: text("actor").notNull(),
    action: text("action").notNull(),
    resource: text("resource").notNull(),
    resourceId: text("resource_id"),
    before: jsonb("before"),
    after: jsonb("after"),
  },
  (t) => [index("audit_log_at_idx").on(sql`${t.at} desc`)],
);

/**
 * Who may act at all — the other half of `audit_log`, and the reason the actor in
 * those rows means something (estimate 2.1, spec §13).
 *
 * One scrypt record per person, exactly as `ADMIN_CREDENTIALS` held it, moved
 * here so that granting and — the one that matters — **revoking** access is a
 * statement rather than a deploy. `password_hash` carries its own cost
 * parameters, so raising them later needs no migration and cannot silently
 * mismatch; `admin_users_hash_check` is what stops anything but a hash landing in
 * the column.
 *
 * Nobody is ever deleted from here: `active = false` keeps their name resolvable
 * in the audit log after they leave.
 */
export const adminUsers = pgTable(
  "admin_users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** The actor string in every audit row. */
    name: text("name").notNull().unique(),
    /** `scrypt:<N>:<r>:<p>:<salt>:<hash>`, base64url. Never a password. */
    passwordHash: text("password_hash").notNull(),
    active: boolean("active").notNull().default(true),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    passwordChangedAt: timestamp("password_changed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastSignInAt: timestamp("last_sign_in_at", { withTimezone: true }),
  },
  (t) => [
    check("admin_users_name_check", sql`${t.name} ~ '^[a-z0-9][a-z0-9._-]*$'`),
    check(
      "admin_users_hash_check",
      sql`${t.passwordHash} ~ '^scrypt:[0-9]+:[0-9]+:[0-9]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$'`,
    ),
    index("admin_users_active_idx").on(t.name).where(sql`active`),
  ],
);

/* ── 7. Messaging + entitlements (Phase 2, estimate 1.7 D2/D3) ───────────── */

/**
 * Every message, because the frequency rules are computed from it, and the
 * response-rate governor needs the inbound half.
 */
export const messageLog = pgTable(
  "message_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    personId: uuid("person_id").references(() => people.id, {
      onDelete: "set null",
    }),
    direction: text("direction").notNull(),
    category: text("category").notNull(),
    template: text("template"),
    templateVersion: text("template_version"),
    providerMessageId: text("provider_message_id"),
    respondedTo: uuid("responded_to"),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("message_log_direction_check", sql`${t.direction} in ('out','in')`),
    check(
      "message_log_category_check",
      sql`${t.category} in ('transactional','outreach')`,
    ),
    index("message_log_person_idx").on(t.personId, sql`${t.sentAt} desc`),
  ],
);

/**
 * Per-category freshness thresholds, as data: camps are seasonal, playgrounds
 * are not, and Janet changes these without a deploy.
 */
export const freshnessPolicy = pgTable(
  "freshness_policy",
  {
    kind: shareKind("kind").primaryKey(),
    staleDays: integer("stale_days").notNull(),
    ageingDays: integer("ageing_days").notNull(),
  },
  (t) => [
    check("freshness_policy_stale_days_check", sql`${t.staleDays} > 0`),
    check("freshness_policy_ageing_days_check", sql`${t.ageingDays} > 0`),
  ],
);

/** D2/D3. Credits are earned on approval, never on submission. */
export const referrals = pgTable(
  "referrals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    referrerId: uuid("referrer_id").references(() => people.id, {
      onDelete: "set null",
    }),
    referredId: uuid("referred_id").references(() => people.id, {
      onDelete: "set null",
    }),
    status: text("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    creditedAt: timestamp("credited_at", { withTimezone: true }),
  },
  (t) => [
    check(
      "referrals_status_check",
      sql`${t.status} in ('pending','profile_complete','credited','void')`,
    ),
    unique("referrals_referrer_id_referred_id_key").on(
      t.referrerId,
      t.referredId,
    ),
  ],
);

export const credits = pgTable(
  "credits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    reason: text("reason").notNull(),
    spentAt: timestamp("spent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check(
      "credits_kind_check",
      sql`${t.kind} in ('network_ask','targeted_network_ask')`,
    ),
    index("credits_person_idx")
      .on(t.personId)
      .where(sql`spent_at is null`),
  ],
);

/**
 * Kept for the admin's data-quality review (2.3 contributor detail). The app does
 * not send transcripts yet — the chat stays on the device — so this stays empty
 * until that is a deliberate decision.
 */
export const seedConversations = pgTable("seed_conversations", {
  id: uuid("id").primaryKey().defaultRandom(),
  personId: uuid("person_id").references(() => people.id, {
    onDelete: "cascade",
  }),
  messages: jsonb("messages").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/* ── Row types ───────────────────────────────────────────────────────────── */

export type Person = typeof people.$inferSelect;
export type NewPerson = typeof people.$inferInsert;
export type Share = typeof shares.$inferSelect;
export type ShareContribution = typeof shareContributions.$inferSelect;
export type Caregiver = typeof caregivers.$inferSelect;
export type CaregiverNomination = typeof caregiverNominations.$inferSelect;
export type Submission = typeof submissions.$inferSelect;
export type Flag = typeof flags.$inferSelect;
export type DemandSignal = typeof demandSignals.$inferSelect;
export type AuditEntry = typeof auditLog.$inferSelect;
export type AdminUser = typeof adminUsers.$inferSelect;

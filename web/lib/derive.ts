import { movedFromPlaces } from "./places";
import { buildConsentRecord } from "./consent";
import {
  ageBandsOf,
  childrenFor,
  profileCompleteness,
  questionById,
  SCREENS,
} from "./questions";
import { EXPECTING } from "./types";
import type {
  AffinityRow,
  AffinityType,
  ChildRecord,
  PendingOptionRow,
  ProfilePayload,
  RelevanceDimension,
  RelevanceRow,
  SeedSession,
  QuestionId,
} from "./types";

/**
 * Turns tapped answers into the rows the backend stores (estimate 1.3,
 * spec §8.1: "Each selection writes to social_affinities with its score
 * weight — no post-processing or fuzzy matching at blast time").
 *
 * We derive on the client too, so the route receives a ready-to-insert shape and the
 * weights live in exactly one place the whole team can read. The backend stays
 * free to re-derive (weights are config, per spec §18.1) — this is a
 * convenience, never the source of truth.
 */

const NON_ANSWERS = new Set(["prefer_not_to_say"]);

/**
 * Ages are what a parent can answer; birth years are what stays true. The taps are
 * converted here, at capture, and the capture date travels with them so anything
 * derived from an age can be recomputed later.
 *
 * "Expecting" has no birth year yet. We record a due year, but mark how we got it:
 * it is the capture year, not something the parent told us.
 */
export function childrenFromAges(ages: number[], capturedAt: Date): ChildRecord[] {
  const year = capturedAt.getFullYear();
  return ages.map((age) =>
    age === EXPECTING
      ? {
          birth_year: null,
          expecting: true,
          due_year: year,
          due_year_precision: "assumed_capture_year" as const,
        }
      : { birth_year: year - age, expecting: false, due_year: null },
  );
}

/**
 * The three functions below take only what they actually read — the answers and
 * the market — rather than the whole browser session. That is what lets the
 * **server** call them: `app/api/seed/profile/route.ts` derives from its own
 * sanitised answers instead of trusting the rows a client sent, so a stale build
 * cannot write the matching graph. A full `SeedSession` still satisfies this
 * shape, so the client keeps calling them unchanged.
 */
export interface DerivationInput {
  answers: SeedSession["answers"];
  market_id: SeedSession["market_id"];
}

export function deriveAffinities(session: DerivationInput): AffinityRow[] {
  const { answers } = session;
  const rows: AffinityRow[] = [];
  const seen = new Set<string>();
  const capturedAt = new Date();

  const push = (id: QuestionId, values: string[]) => {
    const q = questionById(id);
    if (!q.affinity) return;
    for (const value of values) {
      if (NON_ANSWERS.has(value)) continue;
      // The invite group can repeat a parent-group pick — one edge, not two.
      const key = `${q.affinity.type}|${value}`;
      if (seen.has(key)) continue;
      seen.add(key);
      /**
       * Whose it is, for the edges that belong to a child. Stored as birth years
       * — the same conversion `childrenFromAges` makes, and for the same reason:
       * an age stops being true in a year, a birth year does not.
       */
      const ages = childrenFor(q, answers, value);
      rows.push({
        affinity_type: q.affinity.type,
        affinity_value: value,
        score_weight: q.affinity.weight,
        child_birth_years:
          ages.length > 0
            ? ages
                .filter((age) => age !== EXPECTING)
                .map((age) => capturedAt.getFullYear() - age)
            : null,
      });
    }
  };

  if (answers.neighborhood) push("neighborhood", [answers.neighborhood]);
  push("schools", answers.schools);
  push("classes", answers.classes);
  push("camps", answers.camps);
  push("faith", answers.faith);
  push("clubs", answers.clubs);
  // Age is matched as overlapping bands, not exact years (spec §6.4 / M6.4).
  // Bands are "as of capture" — the backend recomputes them from birth_year.
  push("child_ages", ageBandsOf(answers.child_ages));

  return rows;
}

export function deriveLifeRelevance(session: DerivationInput): RelevanceRow[] {
  const { answers } = session;
  const rows: RelevanceRow[] = [];

  const push = (id: QuestionId, values: string[]) => {
    const q = questionById(id);
    if (!q.relevance) return;
    for (const value of values) {
      if (NON_ANSWERS.has(value)) continue;
      rows.push({ dimension: q.relevance, value });
    }
  };

  /**
   * 1 Sep, item 13: *"If the parent skips or selects 'Prefer not to say',
   * default to 'Show me good options across price points.'"*
   *
   * Applied **here, on the server**, and not by preselecting the chip — the
   * screen must still show nothing chosen, because a preselected answer is the
   * app asserting a preference nobody expressed, and her third universal
   * comment is that skipping opts a parent into nothing. Ranking preferences
   * are the one place a default is harmless: it improves an ordering and
   * *"must never be used to infer income"*, which nothing here does.
   *
   * `prefer_not_to_say` reaches this as an empty list, because `NON_ANSWERS`
   * already drops it — so both of her cases are the same case.
   */
  const budget = answers.budget.filter((v) => !NON_ANSWERS.has(v));
  push("budget", budget.length > 0 ? budget : ["across_price_points"]);
  /**
   * Item 11: local roots, and it is a `tenure` row of its own rather than one of
   * the tenure *bands*. Somebody can have grown up here, moved away and come
   * back — the old single list forced them to pick one of those and drop the
   * other.
   */
  if (answers.grew_up_here) push("grew_up_here", [answers.grew_up_here]);
  /* The 24 Aug splits. Each new question carries the *same* `relevance`
     dimension as the screen it came out of, so `life_relevance` gains rows and
     never a new dimension — which is why none of this needed a migration. */
  push("travel_time", answers.travel_time);
  push("logistics", answers.logistics);
  if (answers.time_in_area) push("time_in_area", [answers.time_in_area]);
  /**
   * The coarse "where from" signal, **derived** rather than asked.
   *
   * Her instruction, verbatim: "Pando can derive 'elsewhere in California,'
   * 'another state' or 'another country' from the actual location. The parent
   * shouldn't have to provide both."
   *
   * The place ids are canonical slugs from `market_options.previous_places`, and
   * the **prefix** carries the geography: `us-san-francisco-ca`,
   * `intl-london-uk`.
   *
   * **It was the suffix first, and `seed-places.mjs`'s own check refused that.**
   * Country codes collide with US state codes across the board — DE is Germany
   * and Delaware, IN India and Indiana, IL Israel and Illinois, MA Morocco and
   * Massachusetts — so twelve seeded cities would have filed a Berlin family as
   * domestic. The ambiguity is in the vocabulary itself, so no special-casing
   * fixes it; a prefix we own does.
   *
   * **Why the slug and not a lookup:** `derive.ts` is pure and runs on the server
   * over answers it has already sanitised, with no access to the options table
   * (see the 11 Aug decision — the graph is derived from the answers, never taken
   * from the request). Encoding the geography in the id is what keeps that true.
   * The cost is that the importer must produce ids in this shape, which is why it
   * is asserted rather than assumed.
   */
  for (const value of movedFromPlaces(answers.previous_places)) {
    rows.push({ dimension: "tenure", value });
  }
  push("family_structure", answers.family_structure);
  push("work_setup", answers.work_setup);
  push("childcare_now", answers.childcare_now);
  push("childcare_backup", answers.childcare_backup);
  /**
   * 1 Sep, item 14: *"'No fixed preference — use the best available match' …
   * should be the default when the page is skipped."*
   *
   * Same treatment as cost, and the same reason it is safe: these are ranking
   * signals only, and she says so twice — they *"must never override stronger
   * firsthand experience, become hard filters or authorize Pando to display an
   * affiliation."* Recording "no fixed preference" is the weakest of the ten
   * answers, so defaulting to it asserts nothing the parent did not.
   */
  const trust = answers.trust_circles.filter((v) => !NON_ANSWERS.has(v));
  push("trust_circles", trust.length > 0 ? trust : ["no_fixed_preference"]);

  return rows;
}

/**
 * Free-text "other" answers are never trusted as canonical options — they
 * queue for admin review and promotion (spec §8.1, estimate 2.6).
 */
export function derivePendingOptions(session: DerivationInput): PendingOptionRow[] {
  const rows: PendingOptionRow[] = [];
  for (const screen of SCREENS) {
    for (const question of screen.questions) {
      const entries = session.answers.other[question.id] ?? [];
      for (const submitted_value of entries) {
        rows.push({
          market_id: session.market_id,
          category:
            question.source.type === "market"
              ? question.source.category
              : question.id,
          submitted_value,
        });
      }
    }
  }
  return rows;
}

/**
 * The mirror of `derivePendingOptions`: given the `category` it stored, what does
 * that value become in the graph once an admin promotes it?
 *
 * It exists because a parked "other" answer produces **no edge at all** — the
 * whole point of invariant 9 is that an unreviewed free-text value is not
 * matchable. So the parent who typed it is missing the row every other answer on
 * that question got, and stays missing it unless promotion puts it back.
 *
 * Keyed exactly as `derivePendingOptions` keys it — a market question by its
 * category, a static one by its question id — so the two cannot drift into a state
 * where something is parked under a name nothing can resolve.
 */
export type GraphTarget =
  | { kind: "affinity"; type: AffinityType; weight: number }
  | { kind: "relevance"; dimension: RelevanceDimension };

export function graphTargetForCategory(category: string): GraphTarget | null {
  for (const screen of SCREENS) {
    for (const question of screen.questions) {
      const key =
        question.source.type === "market" ? question.source.category : question.id;
      if (key !== category) continue;
      if (question.affinity) {
        return {
          kind: "affinity",
          type: question.affinity.type,
          weight: question.affinity.weight,
        };
      }
      if (question.relevance) {
        return { kind: "relevance", dimension: question.relevance };
      }
      return null;
    }
  }
  return null;
}

export function buildProfilePayload(session: SeedSession): ProfilePayload {
  const capturedAt = new Date();
  const { answers } = session;

  return {
    invite_code: session.invite_code,
    market_id: session.market_id,
    source: session.source,
    is_test: session.is_test === true,
    name: session.name,
    first_name: session.first_name,
    last_name: session.last_name,
    phone: session.phone,
    /** False until SMS verification exists — never implied (see lib/consent.ts). */
    phone_verified: session.phone_verified === true,
    sms_consent: session.sms_consent,
    /**
     * Unlike `sms_consent` (taken early, at the phone field, and carried on the
     * session from that moment) this is an ordinary mid-profile tap — built here
     * from the answer at payload time, the same way `attribution` is narrowed
     * here rather than stored pre-shaped. Null when skipped, never assumed.
     */
    listening_ear_consent:
      answers.listening_ear === "opted_in" || answers.listening_ear === "declined"
        ? buildConsentRecord(
            "listening_ear",
            answers.listening_ear === "opted_in",
            "seed_tool_profile",
          )
        : null,
    wants_founding: session.wants_founding !== false,
    neighborhood: answers.neighborhood,
    /** Stable: birth years, plus the date the ages were taken. */
    children: childrenFromAges(answers.child_ages, capturedAt),
    child_ages_at_capture: answers.child_ages,
    profile_captured_at: capturedAt.toISOString(),
    /**
     * Consent control, not a preference: the cap Pando must honour. Five,
     * not three — 18 Aug's reciprocity agreement replaced the 1/3/5 scheme,
     * and the server validates against the same 5/10 allow-list.
     *
     * **Null lands on five, never on `as_relevant`** — and that matters more
     * since 1 Sep, because the screen no longer preselects a level, so null is
     * now reachable. Five is the community minimum she named as required; the
     * open-ended option is the *most* permissive answer on the screen, and
     * falling into it from a missing answer would grant Pando more access than
     * anybody agreed to. The screen itself makes the choice `required`, so this
     * branch only ever runs for a request that skipped the screen.
     */
    monthly_contact_allowance:
      answers.allowance === "as_relevant"
        ? null
        : answers.allowance
          ? Number(answers.allowance)
          : 5,
    allowance_mode: answers.allowance === "as_relevant" ? "as_relevant" : "fixed",
    /**
     * P13 — the single control over how this parent is named in an answer.
     *
     * Narrowed here rather than passed through: this is a raw tap id, and an
     * unrecognised one must fail closed to anonymous. Naming a parent because a
     * stale option slipped through is the one mistake this field can make.
     */
    attribution:
      answers.attribution === "first_name_safe" ||
      answers.attribution === "anonymous_verified"
        ? answers.attribution
        : null,
    /** Disclosed, not asked, so it starts true; texting PRIVACY turns it off. */
    aggregate_display: true,
    /** What this parent is the person to ask about (users.topic_preferences). */
    topic_preferences: [...answers.topics, ...answers.topics_lived].filter(
      (v) => !NON_ANSWERS.has(v),
    ),
    topics_lived_experience: answers.topics_lived.filter((v) => !NON_ANSWERS.has(v)),
    /** P5 — a former school is a different signal from a current one. */
    school_status: answers.school_status,
    time_in_area: answers.time_in_area,
    moved_from: answers.moved_from,
    answers,
    social_affinities: deriveAffinities(session),
    life_relevance: deriveLifeRelevance(session),
    pending_options: derivePendingOptions(session),
    profile_completeness: profileCompleteness(answers),
    client_started_at: session.started_at,
    client_submitted_at: capturedAt.toISOString(),
  };
}

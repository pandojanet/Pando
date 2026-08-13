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
  push("parent_groups", answers.parent_groups);
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

  push("budget", answers.budget);
  push("logistics", answers.logistics);
  if (answers.time_in_area) push("time_in_area", [answers.time_in_area]);
  push("family_structure", answers.family_structure);
  push("childcare_now", answers.childcare_now);
  push("trust_circles", answers.trust_circles);

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
    wants_founding: session.wants_founding !== false,
    neighborhood: answers.neighborhood,
    /** Stable: birth years, plus the date the ages were taken. */
    children: childrenFromAges(answers.child_ages, capturedAt),
    child_ages_at_capture: answers.child_ages,
    profile_captured_at: capturedAt.toISOString(),
    /** Consent control, not a preference: the cap Pando must honour. */
    monthly_contact_allowance:
      answers.allowance === "as_relevant"
        ? null
        : answers.allowance
          ? Number(answers.allowance)
          : 3,
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

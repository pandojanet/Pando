import { resolveAffiliations } from "@/lib/affiliations";
import { AFFILIATION_CONSENT_TEXT_VERSION } from "@/lib/consent";
import "server-only";

import { and, eq, sql } from "drizzle-orm";
import type { Db } from "@/lib/server/db";
import {
  children,
  affiliationVisibility,
  consents,
  lifeRelevance,
  pendingOptions,
  people,
  personSchools,
  socialAffinities,
} from "@/lib/db/schema";

/**
 * Estimate 1.3 — the profile write, and the derivation that hangs off it.
 *
 * This replaced the `pando-1.3-profile` n8n workflow. Two things it does that a
 * chain of webhook nodes could not:
 *
 *  - **one transaction.** A profile is a person plus their children plus their
 *    affinities plus their relevance rows plus their schools. Half of that
 *    written is worse than none of it: matching would run against a parent whose
 *    children are recorded but whose neighborhood affinity is missing, and
 *    nothing would report the gap.
 *  - **re-derivation server-side.** The client sends `social_affinities` and
 *    `life_relevance` for convenience, but they arrive from a browser and are
 *    not trusted. Spec §18.1 says weights resolve from config at query time
 *    anyway, so what the client sent is stored as `weight_at_capture` —
 *    informational, and nothing joins on it.
 */

export interface ChildInput {
  birth_year: number | null;
  /** 1–12, optional. Never set for an expecting child — see `drizzle/0031`. */
  birth_month?: number | null;
  expecting: boolean;
  due_year: number | null;
  due_year_precision?: "assumed_capture_year" | "stated";
}

export interface AffinityInput {
  affinity_type: string;
  affinity_value: string;
  score_weight?: number | null;
  /** Whose it is, for a school / class / camp edge. Null on household edges. */
  child_birth_years?: number[] | null;
}

export interface RelevanceInput {
  dimension: string;
  value: string;
}

export interface PendingOptionInput {
  market_id: string;
  category: string;
  submitted_value: string;
}

export interface ProfileInput {
  invite_code: string | null;
  /** The `invites` row the code resolved to, when it resolved to one. */
  invite_id?: string | null;
  market_id: string;
  source: string;
  is_test: boolean;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  /** A server fact read from the verification cookie, never from the body. */
  phone_verified_at: string | null;
  sms_consent: { status: string; text_version: string; source?: string } | null;
  /** 18 Aug — willingness to occasionally answer another parent's hard question. */
  listening_ear_consent: { status: string; text_version: string; source?: string } | null;
  recurring_messages_consent: {
    status: string;
    text_version: string;
    source?: string;
  } | null;
  wants_founding: boolean;
  /**
   * Null when the parent **typed** their neighborhood instead of tapping one.
   *
   * The column is nullable and stays null on purpose: their words are not a
   * taxonomy value, and storing them here would be the unmatchable state that
   * admin promotion exists to end (invariant 9). The text travels in
   * `pending_options` instead, and promoting it writes the affinity row for
   * everyone who typed it.
   *
   * This was `string` while the route refused any profile without a canonical
   * id — which is what made a typed neighborhood cost a founding contributor
   * their entire completed session.
   */
  neighborhood: string | null;
  children: ChildInput[];
  child_ages_at_capture: number[];
  profile_captured_at: string;
  allowance_mode: "fixed" | "as_relevant";
  monthly_contact_allowance: number | null;
  attribution: "anonymous_verified" | "first_name_safe" | null;
  aggregate_display: boolean;
  topic_preferences: string[];
  topics_lived_experience: string[];
  school_status: Record<string, string>;
  time_in_area: string | null;
  moved_from: string | null;
  invited_via_group: string | null;
  answers: unknown;
  /**
   * Privacy Guidance §A: the connections the parent has said may be mentioned,
   * as `type:value` refs. **Absence is a revocation, not a no-op** — see the
   * write below.
   */
  shared_affiliations: string[];
  social_affinities: AffinityInput[];
  life_relevance: RelevanceInput[];
  pending_options: PendingOptionInput[];
  profile_completeness: number;
}

/**
 * The dimensions `life_relevance` accepts. The column has a CHECK for exactly
 * this list, so an unrecognised dimension would abort the whole transaction and
 * lose the profile. A value we don't know is dropped instead — the profile is
 * worth more than one relevance row.
 */
const RELEVANCE_DIMENSIONS = new Set([
  "budget",
  "logistics",
  "family_setup",
  "childcare",
  "tenure",
  "trust_circle",
]);

const SCHOOL_STATUSES = new Set(["current", "former", "not_yet", "homeschool"]);

export interface ProfileWriteResult {
  person_id: string;
  /** Counts only — this is what gets logged (invariant 7). */
  counts: {
    children: number;
    affinities: number;
    relevance: number;
    schools: number;
    pending_options: number;
  };
}

export async function writeProfile(
  db: Db,
  input: ProfileInput,
): Promise<ProfileWriteResult> {
  return db.transaction(async (tx) => {
    const personValues = {
      phone: input.phone,
      firstName: input.first_name,
      lastName: input.last_name,
      marketId: input.market_id,
      neighborhood: input.neighborhood,
      inviteCode: input.invite_code,
      inviteId: input.invite_id ?? null,
      invitedViaGroup: input.invited_via_group,
      source: input.source,
      timeInArea: input.time_in_area,
      movedFrom: input.moved_from,
      attribution: input.attribution,
      aggregateDisplay: input.aggregate_display,
      monthlyContactAllowance: input.monthly_contact_allowance,
      allowanceMode: input.allowance_mode,
      topicPreferences: input.topic_preferences,
      topicsLivedExperience: input.topics_lived_experience,
      wantsFounding: input.wants_founding,
      rawAnswers: input.answers,
      childAgesAtCapture: input.child_ages_at_capture,
      phoneVerifiedAt: input.phone_verified_at
        ? new Date(input.phone_verified_at)
        : null,
      profileCompleteness: input.profile_completeness,
      profileCapturedAt: new Date(input.profile_captured_at),
      isTest: input.is_test,
    };

    /**
     * One person, one identity, keyed by phone (invariant 10). A parent who
     * comes back and finishes the flow again updates their row rather than
     * creating a second contributor.
     *
     * The anonymous path has no phone, and `unique` treats every NULL as
     * distinct, so an upsert would silently do nothing useful — those always
     * insert. That is correct: an anonymous contribution has no identity to
     * merge with.
     */
    let personId: string;
    if (input.phone) {
      const [row] = await tx
        .insert(people)
        .values(personValues)
        .onConflictDoUpdate({ target: people.phone, set: personValues })
        .returning({ id: people.id });
      personId = row.id;
    } else {
      const [row] = await tx
        .insert(people)
        .values(personValues)
        .returning({ id: people.id });
      personId = row.id;
    }

    /**
     * Replace rather than merge, for all four derived sets. A parent who edits
     * their profile and removes a school must not keep matching on it — a stale
     * affinity is a wrong answer sent to the wrong person, which is the failure
     * this product cannot afford.
     */
    await tx.delete(children).where(eq(children.personId, personId));
    const childRows = input.children.filter(
      // The `year_shape` CHECK: expecting needs a due year and no birth year;
      // everyone else needs a birth year.
      (c) => (c.expecting ? c.due_year !== null : c.birth_year !== null),
    );
    if (childRows.length > 0) {
      await tx.insert(children).values(
        childRows.map((c) => ({
          personId,
          birthYear: c.expecting ? null : c.birth_year,
          /* `children_month_needs_year` refuses a month on an expecting row, so
             the ternary is the constraint restated rather than defensiveness. */
          birthMonth: c.expecting ? null : (c.birth_month ?? null),
          expecting: c.expecting,
          dueYear: c.expecting ? c.due_year : null,
          dueYearPrecision: c.expecting
            ? (c.due_year_precision ?? "assumed_capture_year")
            : null,
        })),
      );
    }

    await tx
      .delete(socialAffinities)
      .where(eq(socialAffinities.personId, personId));
    const affinityRows = dedupeAffinities(input.social_affinities);
    if (affinityRows.length > 0) {
      await tx.insert(socialAffinities).values(
        affinityRows.map((a) => ({
          personId,
          affinityType: a.affinity_type,
          affinityValue: a.affinity_value,
          weightAtCapture: a.score_weight ?? null,
          childBirthYears:
            a.child_birth_years && a.child_birth_years.length > 0
              ? a.child_birth_years
              : null,
        })),
      );
    }

    /**
     * Per-affiliation visibility (Privacy Guidance §A) — and the **one derived
     * table here that is not deleted and rewritten.**
     *
     * Everything above is a computed fact, so re-deriving it is free. This is a
     * recorded consent carrying the wording version and the moment it was given,
     * and §I asks that an attributed statement be reconstructable from its
     * supporting records. Rewriting the row on every save would reset
     * `consented_at` to whenever the parent last edited anything, which makes
     * that impossible.
     *
     * So three cases, and the third is the one a delete-and-rewrite would lose:
     *
     *  1. **Newly granted** — insert as `shared_anonymously`, stamped now.
     *  2. **Still granted** — leave it entirely. Not even a touched timestamp:
     *     the parent decided once, and re-confirming it is not a new decision.
     *  3. **No longer granted** — a **revocation**. Back to `private` with
     *     `revoked_at = now()`, because §G says to record the effective time of
     *     the change rather than quietly stop honouring it.
     */
    const granted = resolveAffiliations(input.shared_affiliations);

    if (granted.length > 0) {
      await tx
        .insert(affiliationVisibility)
        .values(
          granted.map((a) => ({
            personId,
            affiliationType: a.type,
            affiliationValue: a.value,
            visibility: "shared_anonymously",
            consentTextVersion: AFFILIATION_CONSENT_TEXT_VERSION,
            consentedAt: new Date(),
          })),
        )
        /* Re-granting something already granted must not restamp it, so the
           update only ever moves a row *into* the shared state. */
        .onConflictDoUpdate({
          target: [
            affiliationVisibility.personId,
            affiliationVisibility.affiliationType,
            affiliationVisibility.affiliationValue,
          ],
          set: {
            visibility: "shared_anonymously",
            consentTextVersion: AFFILIATION_CONSENT_TEXT_VERSION,
            consentedAt: sql`coalesce(${affiliationVisibility.consentedAt}, now())`,
            /* Granting again after a revocation clears it: the row's state is
               "shared", and the CHECK refuses a revoked row that is shareable. */
            revokedAt: null,
          },
          setWhere: sql`${affiliationVisibility.visibility} <> 'shared_anonymously'`,
        });
    }

    /* The revocation half. Written as one statement rather than a read-then-write
       so a concurrent save cannot slip between them. */
    const grantedValues = granted.map((a) => `${a.type}/${a.value}`);
    await tx.execute(
      sql`update affiliation_visibility
             set visibility = 'private',
                 revoked_at = now()
           where person_id = ${personId}::uuid
             and visibility = 'shared_anonymously'
             and (affiliation_type || '/' || affiliation_value) <> all(
               ${sql.raw(
                 grantedValues.length > 0
                   ? "ARRAY[" +
                     grantedValues
                       .map((v) => "'" + v.replace(/'/g, "''") + "'")
                       .join(",") +
                     "]::text[]"
                   : "ARRAY[]::text[]",
               )}
             )`,
    );

    await tx.delete(lifeRelevance).where(eq(lifeRelevance.personId, personId));
    const relevanceRows = dedupeRelevance(
      input.life_relevance.filter((r) => RELEVANCE_DIMENSIONS.has(r.dimension)),
    );
    if (relevanceRows.length > 0) {
      await tx.insert(lifeRelevance).values(
        relevanceRows.map((r) => ({
          personId,
          dimension: r.dimension,
          value: r.value,
        })),
      );
    }

    await tx.delete(personSchools).where(eq(personSchools.personId, personId));
    const schoolRows = Object.entries(input.school_status).filter(([, status]) =>
      SCHOOL_STATUSES.has(status),
    );
    if (schoolRows.length > 0) {
      /* Whose school it is comes from the affinity row derived for the same
         value — one derivation, so the two tables cannot disagree about which
         child a school belongs to. */
      const schoolChildren = new Map(
        input.social_affinities
          .filter((a) => a.affinity_type === "school")
          .map((a) => [a.affinity_value, a.child_birth_years ?? null]),
      );
      await tx.insert(personSchools).values(
        schoolRows.map(([optionValue, status]) => ({
          personId,
          optionValue,
          status,
          childBirthYears: schoolChildren.get(optionValue) ?? null,
        })),
      );
    }

    /**
     * "Other" answers queue for promotion and are not matchable until an admin
     * promotes them (invariant 9). Two parents typing the same thing is the
     * signal Janet acts on, so a repeat bumps the count rather than inserting a
     * duplicate.
     */
    for (const option of input.pending_options) {
      await tx
        .insert(pendingOptions)
        .values({
          marketId: option.market_id,
          category: option.category,
          submittedValue: option.submitted_value,
          submittedBy: personId,
        })
        .onConflictDoUpdate({
          target: [
            pendingOptions.marketId,
            pendingOptions.category,
            pendingOptions.submittedValue,
          ],
          set: { occurrences: sql`${pendingOptions.occurrences} + 1` },
        });
    }

    /**
     * Consent is an append-only record with its wording version, never a
     * boolean (lib/consent.ts). Re-running the flow must not silently overwrite
     * what the parent agreed to last time — both records stand, newest wins on
     * read.
     */
    if (input.sms_consent && input.phone) {
      await tx.insert(consents).values({
        personId,
        scope: "sms",
        status: input.sms_consent.status === "opted_in" ? "opted_in" : "declined",
        source: input.sms_consent.source ?? "seed_tool",
        textVersion: input.sms_consent.text_version,
      });
    }

    /**
     * The recurring SMS/RCS opt-in (2 Sep), and it **is** gated on `input.phone`
     * — the same rule as the SMS consent above and for the same reason: it is
     * permission to send recurring messages to a number, so without a number
     * there is nothing it could permit. The anonymous path is never shown it.
     *
     * `opted_in` unconditionally: the route drops any other status rather than
     * storing a refusal that the flow cannot produce.
     */
    if (input.recurring_messages_consent && input.phone) {
      await tx.insert(consents).values({
        personId,
        scope: "sms_recurring",
        status: "opted_in",
        source: input.recurring_messages_consent.source ?? "seed_tool",
        textVersion: input.recurring_messages_consent.text_version,
      });
    }

    /**
     * Not gated on `input.phone` the way SMS consent is — this is a willingness
     * flag about being matched later, not a permission to text a number, so it
     * means the same thing on the anonymous path.
     */
    if (input.listening_ear_consent) {
      await tx.insert(consents).values({
        personId,
        scope: "listening_ear",
        status:
          input.listening_ear_consent.status === "opted_in" ? "opted_in" : "declined",
        source: input.listening_ear_consent.source ?? "seed_tool",
        textVersion: input.listening_ear_consent.text_version,
      });
    }

    return {
      person_id: personId,
      counts: {
        children: childRows.length,
        affinities: affinityRows.length,
        relevance: relevanceRows.length,
        schools: schoolRows.length,
        pending_options: input.pending_options.length,
      },
    };
  });
}

/**
 * The composite primary keys make a repeated pair a hard error mid-transaction,
 * and the client can legitimately send one: the invite group often repeats a
 * parent-group pick. One edge, not two.
 */
function dedupeAffinities(rows: AffinityInput[]): AffinityInput[] {
  const seen = new Set<string>();
  return rows.filter((r) => {
    if (!r.affinity_type || !r.affinity_value) return false;
    const key = `${r.affinity_type}|${r.affinity_value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function dedupeRelevance(rows: RelevanceInput[]): RelevanceInput[] {
  const seen = new Set<string>();
  return rows.filter((r) => {
    if (!r.dimension || !r.value) return false;
    const key = `${r.dimension}|${r.value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Used by the completion route to attach later writes to the same person. */
export async function findPersonByPhone(
  db: Db,
  phone: string,
): Promise<{ id: string } | null> {
  const [row] = await db
    .select({ id: people.id })
    .from(people)
    .where(eq(people.phone, phone))
    .limit(1);
  return row ?? null;
}

/** P14 / D3 — the completion screen's follow-up consent. */
export async function recordConsent(
  db: Db,
  input: {
    person_id: string;
    scope: "sms" | "follow_up" | "blast" | "reference" | "caregiver_profile";
    status: "opted_in" | "declined" | "revoked";
    text_version: string;
    source?: string;
  },
): Promise<void> {
  await db.insert(consents).values({
    personId: input.person_id,
    scope: input.scope,
    status: input.status,
    source: input.source ?? "seed_tool",
    textVersion: input.text_version,
  });
}

/** Newest consent per scope, for the admin contributor detail. */
export async function consentsFor(db: Db, personId: string) {
  return db
    .select({
      scope: consents.scope,
      status: consents.status,
      text_version: consents.textVersion,
      captured_at: consents.capturedAt,
    })
    .from(consents)
    .where(eq(consents.personId, personId))
    .orderBy(sql`${consents.capturedAt} desc`);
}

/** Guard used by the save routes: does this person exist and is it them? */
export async function personExists(
  db: Db,
  personId: string,
  isTest: boolean,
): Promise<boolean> {
  const [row] = await db
    .select({ id: people.id })
    .from(people)
    .where(and(eq(people.id, personId), eq(people.isTest, isTest)))
    .limit(1);
  return row !== undefined;
}

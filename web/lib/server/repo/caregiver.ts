import "server-only";

import { eq, sql } from "drizzle-orm";
import type { Db } from "@/lib/server/db";
import { CAREGIVER_CONSENT_TEXT_VERSION } from "@/lib/consent";
import { caregiverClaims, consents, people } from "@/lib/db/schema";

/**
 * 2C — writing a caregiver's own claim.
 *
 * One transaction, because the three things it writes are one moment: the person,
 * their claim, and the consents that authorise it. A claim stored without the
 * consent record that permits it is the same failure as a nomination stored without
 * its restricted note — the artefact that makes it legitimate has to land with it.
 *
 * What this never does: read anything from the parent side. A caregiver's own
 * profile is not allowed to be informed by, echo, or leak the nomination — the
 * private note and the hesitant "why" never leave the admin surface in any form
 * (invariant 12), and the safest way to keep that true is that this file has no
 * query against `caregiver_nominations` or `restricted_notes` at all.
 *
 * Written with the query builder rather than raw `sql` for one concrete reason:
 * drizzle's `sql` template expands a JS array into a **record**, so
 * `${["a","b"]}` against a `text[]` column fails with "expression is of type
 * record". Six of these columns are arrays. The builder encodes them properly.
 */

export interface CaregiverClaimInput {
  phone: string;
  first_name: string;
  last_initial: string | null;
  market_id: string;
  roles_wanted: string[];
  age_experience: string[];
  strengths: string[];
  areas_served: string[];
  drives: boolean | null;
  days_available: string[];
  available_from: string | null;
  hours_note: string | null;
  rate_band: string | null;
  open_to_reference_intros: boolean;
  appear_in_answers: boolean;
  open_to_introductions: boolean;
  is_test: boolean;
}

export interface CaregiverClaimResult {
  claim_id: string;
  person_id: string;
  /** True when this person had already claimed and is revising it. */
  updated: boolean;
}

export async function saveCaregiverClaim(
  db: Db,
  input: CaregiverClaimInput,
): Promise<CaregiverClaimResult> {
  return db.transaction(async (tx) => {
    /**
     * One person, one identity, keyed by phone (invariant 10). A caregiver may
     * also be a parent on Pando — same human, same row — so this upserts rather
     * than assuming they are new, and it touches none of the columns the seed flow
     * owns. In particular it never sets `founding`: being recommended as a
     * caregiver is not a contribution and must not read as one.
     */
    const [person] = await tx
      .insert(people)
      .values({
        phone: input.phone,
        firstName: input.first_name,
        marketId: input.market_id,
        phoneVerifiedAt: new Date(),
        isTest: input.is_test,
      })
      .onConflictDoUpdate({
        target: people.phone,
        set: {
          phoneVerifiedAt: new Date(),
          /* Their own name wins only if we had none — a parent who already told
             us their name is not renamed by their caregiver profile. */
          firstName: sql`coalesce(${people.firstName}, excluded.first_name)`,
        },
      })
      .returning({ id: people.id });

    const [existing] = await tx
      .select({ id: caregiverClaims.id })
      .from(caregiverClaims)
      .where(eq(caregiverClaims.personId, person.id))
      .limit(1);

    /**
     * `open_to_introductions` is forced false without `appear_in_answers` rather
     * than rejected. The screen already prevents the pair and the CHECK would
     * refuse it — but a client sending the impossible combination should lose the
     * *larger* permission, never have the whole claim fail and take the smaller
     * one with it.
     */
    const introductions = input.appear_in_answers && input.open_to_introductions;

    const values = {
      personId: person.id,
      marketId: input.market_id,
      firstName: input.first_name,
      lastInitial: input.last_initial,
      rolesWanted: input.roles_wanted,
      ageExperience: input.age_experience,
      strengths: input.strengths,
      areasServed: input.areas_served,
      drives: input.drives,
      daysAvailable: input.days_available,
      hoursNote: input.hours_note,
      rateBand: input.rate_band,
      availableFrom: input.available_from,
      openToReferenceIntros: input.open_to_reference_intros,
      appearInAnswers: input.appear_in_answers,
      openToIntroductions: introductions,
      consentTextVersion: CAREGIVER_CONSENT_TEXT_VERSION,
      isTest: input.is_test,
    };

    const [claim] = await tx
      .insert(caregiverClaims)
      .values(values)
      .onConflictDoUpdate({
        target: caregiverClaims.personId,
        /* A revision replaces the answers and leaves the resolution alone: an
           admin who already matched this person should not have to do it again
           because they changed their hours. */
        set: { ...values, updatedAt: new Date() },
      })
      .returning({ id: caregiverClaims.id });

    /**
     * Four consents, recorded separately and re-recorded on every revision — a
     * decision reversed is a new decision, and the old row stays as the record of
     * what was true before. `caregiver_profile` is the one that authorises the
     * claim existing; the other three are what a family may eventually see.
     */
    await tx.insert(consents).values(
      (
        [
          ["caregiver_profile", true],
          ["caregiver_listing", input.appear_in_answers],
          ["caregiver_introduction", introductions],
          ["caregiver_reference", input.open_to_reference_intros],
        ] as Array<[string, boolean]>
      ).map(([scope, optedIn]) => ({
        personId: person.id,
        scope,
        status: optedIn ? "opted_in" : "declined",
        source: "caregiver_flow",
        textVersion: CAREGIVER_CONSENT_TEXT_VERSION,
      })),
    );

    return {
      claim_id: claim.id,
      person_id: person.id,
      updated: existing !== undefined,
    };
  });
}

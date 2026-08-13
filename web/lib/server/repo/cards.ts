import "server-only";

import { and, eq, sql } from "drizzle-orm";
import type { Db } from "@/lib/server/db";
import {
  caregiverNominations,
  caregivers,
  flags,
  shareContributions,
  shares,
  restrictedNotes,
  submissions,
} from "@/lib/db/schema";

/**
 * Estimates 1.5 and 1.6 — turning a finished capture card into stored rows.
 *
 * This replaced `pando-1.5-card-save`. What it must get right:
 *
 *  - **the raw card is kept, always.** `submissions.fields` is the answer to
 *    "did the parent actually say that", and it is written even when the shaped
 *    rows below are partial. Curation happens on the derived rows; the capture
 *    is never edited.
 *  - **one transaction per card.** A caregiver nomination and its restricted
 *    notes are a single fact. A nomination stored without the private note that
 *    was supposed to hold it back is exactly the failure invariant 12 exists to
 *    prevent.
 *  - **`client_id` is the idempotency key.** Tapping a recap row to fix one
 *    answer re-sends the same card; that must update in place, never create a
 *    second contribution (unique on share_id + submission_id backs this up).
 */

export type CardKind = "activity" | "caregiver" | "place" | "tip";

export interface CardInput {
  kind: CardKind;
  market_id: string;
  is_test: boolean;
  client_id: string | null;
  /** Resolved from the verified phone; null on the anonymous path. */
  person_id: string | null;
  fields: Record<string, unknown>;
  /** Caregiver only — split out by the route, never stored as a full surname. */
  first_name?: string | null;
  last_initial?: string | null;
  /** Re-derived server-side by the route; a client may add a hold, never clear one. */
  review_hold?: boolean;
  hold_reasons?: string[];
  private_note?: string | null;
  hesitation_reason?: string | null;
  pay_band?: string | null;
  pay_benchmark_consent?: boolean;
  reference_willing?: string | null;
  consent_outreach?: string;
}

export interface CardWriteResult {
  record_id: string;
  submission_id: string;
  /** True when an existing card was corrected rather than a new one created. */
  updated: boolean;
}

const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim() !== "" ? v.trim() : null;

const bool = (v: unknown): boolean => v === true || v === "yes" || v === "true";

const strArray = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

const intArray = (v: unknown): number[] =>
  Array.isArray(v) ? v.filter((x): x is number => typeof x === "number") : [];

export async function saveCard(
  db: Db,
  input: CardInput,
): Promise<CardWriteResult> {
  return db.transaction(async (tx) => {
    /**
     * The capture row first, so everything below can hang off it. A correction
     * overwrites `fields` under the same client_id — that is what makes the
     * "tap a recap row to fix one answer" flow safe to repeat.
     */
    const clientId = input.client_id ?? `${input.kind}-${crypto.randomUUID()}`;
    const [existing] = await tx
      .select({ id: submissions.id })
      .from(submissions)
      .where(eq(submissions.clientId, clientId))
      .limit(1);

    const [submission] = await tx
      .insert(submissions)
      .values({
        clientId,
        personId: input.person_id,
        kind: input.kind,
        fields: input.fields,
        isTest: input.is_test,
      })
      .onConflictDoUpdate({
        target: submissions.clientId,
        set: { fields: input.fields, personId: input.person_id },
      })
      .returning({ id: submissions.id });

    const updated = existing !== undefined;

    if (input.kind === "caregiver") {
      const recordId = await writeCaregiver(tx, input, submission.id, updated);
      return { record_id: recordId, submission_id: submission.id, updated };
    }

    const recordId = await writeShareCard(tx, input, submission.id);
    return { record_id: recordId, submission_id: submission.id, updated };
  });
}

/* ── Activities, camps, places and tips ─────────────────────────────────────────── */

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

async function writeShareCard(
  tx: Tx,
  input: CardInput,
  submissionId: string,
): Promise<string> {
  const f = input.fields;
  const name = str(f.name) ?? str(f.place_name) ?? "Untitled";

  /**
   * Five parents recommending one class is five contributions and one place, so
   * an exact name match in the same market and kind is reused. Anything less
   * exact is *not* merged here — a near-match becomes a flag for a human below,
   * because silently folding two different places together corrupts both.
   */
  const [found] = await tx
    .select({ id: shares.id })
    .from(shares)
    .where(
      and(
        eq(shares.marketId, input.market_id),
        eq(shares.kind, input.kind),
        sql`lower(${shares.name}) = lower(${name})`,
      ),
    )
    .limit(1);

  let shareId: string;
  if (found) {
    shareId = found.id;
  } else {
    const [created] = await tx
      .insert(shares)
      .values({
        marketId: input.market_id,
        kind: input.kind,
        name,
        venue: str(f.venue),
        neighborhoods: strArray(f.neighborhoods ?? f.neighborhood),
        ageBands: strArray(f.age_bands),
        placeType: str(f.place_type),
        topic: str(f.topic),
        isTest: input.is_test,
      })
      .returning({ id: shares.id });
    shareId = created.id;

    await flagNearDuplicateShare(tx, {
      shareId,
      marketId: input.market_id,
      kind: input.kind,
      name,
      isTest: input.is_test,
    });
  }

  /**
   * R5 price. The `price_shape` CHECK refuses a band without a unit, because
   * $100/month and $100/term are different recommendations — so a band that
   * arrived without one is dropped rather than allowed to abort the card.
   */
  const priceBand = str(f.price_band);
  const priceUnit = str(f.price_unit);
  const bandNeedsUnit =
    priceBand !== null && priceBand !== "free" && priceBand !== "prefer_not_to_say";
  const safeBand = bandNeedsUnit && priceUnit === null ? null : priceBand;

  const values = {
    shareId,
    personId: input.person_id,
    submissionId,
    /** R2 — decides the label, and whether this can ever count toward Founding. */
    firsthand: f.firsthand === "secondhand" ? false : true,
    childAgeAtTime: intArray(f.child_age_at_time ?? f.age_at_time),
    lastThere: str(f.freshness ?? f.last_there),
    howMuch: str(f.how_much),
    recommendation: str(f.recommendation),
    whatMakesItGreat: str(f.what_makes_it_great ?? f.what_makes_special),
    caveat: str(f.caveat),
    /** R7 — "nothing comes to mind" is an answer, and Founding counts it. */
    caveatAnswered: f.caveat !== undefined,
    whoFor: str(f.who_for),
    whoNotFor: str(f.who_not_for),
    priceBand: safeBand,
    priceUnit: safeBand === null ? null : priceUnit,
    worthIt: str(f.worth_it),
    followUpOk: bool(f.follow_up_ok),
    tipText: str(f.tip ?? f.tip_text),
    isTest: input.is_test,
  };

  const [row] = await tx
    .insert(shareContributions)
    .values(values)
    .onConflictDoUpdate({
      target: [shareContributions.shareId, shareContributions.submissionId],
      set: values,
    })
    .returning({ id: shareContributions.id });

  return row.id;
}

/**
 * Duplicate detection is a suggestion, never an action (2.5). The flag is raised
 * only when something similar already exists — raising one for every new place
 * would make the queue meaningless.
 */
async function flagNearDuplicateShare(
  tx: Tx,
  place: {
    shareId: string;
    marketId: string;
    kind: CardKind;
    name: string;
    isTest: boolean;
  },
): Promise<void> {
  if (place.isTest) return;

  const similar = await tx
    .select({ id: shares.id })
    .from(shares)
    .where(
      and(
        eq(shares.marketId, place.marketId),
        eq(shares.kind, place.kind),
        sql`${shares.id} <> ${place.shareId}`,
        sql`similarity(lower(${shares.name}), lower(${place.name})) > 0.55`,
      ),
    )
    .limit(1);

  if (similar.length === 0) return;

  await tx.insert(flags).values({
    severity: "note",
    reason: "possible_duplicate_share",
    subjectKind: "place",
    subjectId: place.shareId,
    field: "name",
  });
}

/* ── Caregivers ──────────────────────────────────────────────────────────── */

async function writeCaregiver(
  tx: Tx,
  input: CardInput,
  submissionId: string,
  updated: boolean,
): Promise<string> {
  const f = input.fields;

  /**
   * A correction reuses the caregiver behind the existing nomination. A *new*
   * card always creates a new caregiver row, even when the name matches one we
   * already hold — "name and initial aren't an identifier", and folding two
   * different people called Maria G. into one record would blend their
   * strengths, their pay bands and their consent state. Merging is an explicit
   * admin action against the duplicates panel, never a side effect of capture.
   */
  let caregiverId: string;
  const [priorNomination] = await tx
    .select({ id: caregiverNominations.id, caregiverId: caregiverNominations.caregiverId })
    .from(caregiverNominations)
    .where(eq(caregiverNominations.submissionId, submissionId))
    .limit(1);

  if (updated && priorNomination) {
    caregiverId = priorNomination.caregiverId;
    await tx
      .update(caregivers)
      .set({
        firstName: input.first_name ?? "Unknown",
        lastInitial: input.last_initial ?? null,
      })
      .where(eq(caregivers.id, caregiverId));
  } else {
    const [created] = await tx
      .insert(caregivers)
      .values({
        marketId: input.market_id,
        firstName: input.first_name ?? "Unknown",
        lastInitial: input.last_initial ?? null,
        /**
         * The route refuses the card unless the 18+ gate said yes, so reaching
         * here means it did. The `adults_only` CHECK is the backstop, and it is
         * deliberately not something this function can talk its way around
         * (invariant 2).
         */
        isAdult: true,
        /**
         * Never activatable from the contributor side. The ladder starts at
         * `mentioned` and only the caregiver's own action moves it
         * (invariants 1 and 13).
         */
        consentStatus: "mentioned",
        active: false,
        discoverable: false,
        introducible: false,
        isTest: input.is_test,
      })
      .returning({ id: caregivers.id });
    caregiverId = created.id;
  }

  /**
   * `hold_when_hesitant` refuses a non-yes hire_again without a hold. The route
   * already derives the hold from the same answers; this recomputes the
   * relationship rather than trusting the pair to be consistent, because a
   * mismatch would abort the transaction and lose the card.
   */
  const hireAgain = str(f.hire_again);
  const validHireAgain =
    hireAgain === "yes" || hireAgain === "hesitant" || hireAgain === "no"
      ? hireAgain
      : null;
  const reviewHold =
    input.review_hold === true || (validHireAgain !== null && validHireAgain !== "yes");

  const values = {
    caregiverId,
    personId: input.person_id,
    submissionId,
    /** C1 — the route refuses anything else; `firsthand_only` is the backstop. */
    workedForFamily: true,
    careType: str(f.care_type),
    howKnown: str(f.how_known),
    howLong: str(f.how_long),
    lastWorked: str(f.last_worked),
    /**
     * Stage 1 of the caregiver ladder — schedule, size and terms of the job. All
     * three are skippable in the flow, so all three are nullable here, and none of
     * them is ever shown next to a name: they exist to make a pay band comparable
     * and to tell a ten-hour sitter from a full-time role.
     */
    schedulePattern: strArray(f.schedule_pattern),
    hoursPerWeek: str(f.hours_per_week),
    benefits: strArray(f.benefits),
    caredForAges: strArray(f.cared_for_ages),
    strengths: strArray(f.strengths),
    inTheirWords: str(f.in_their_words),
    goodFitFor: strArray(f.good_fit_for),
    caveat: str(f.know_first ?? f.caveat),
    hireAgain: validHireAgain,
    needsHorizon: str(f.needs_horizon),
    needsChangeType: str(f.needs_change_type),
    recontactOk: bool(f.recontact_ok),
    payBand: input.pay_band ?? str(f.pay_band),
    payBenchmarkConsent: input.pay_benchmark_consent === true,
    referenceWilling: input.reference_willing ?? str(f.reference_willing),
    inviteSentByParent: input.consent_outreach === "parent_sent_invite",
    reviewHold,
    holdReasons: input.hold_reasons ?? [],
    isTest: input.is_test,
  };

  const [nomination] = await tx
    .insert(caregiverNominations)
    .values(values)
    .onConflictDoUpdate({
      target: [
        caregiverNominations.caregiverId,
        caregiverNominations.submissionId,
      ],
      set: values,
    })
    .returning({ id: caregiverNominations.id });

  /**
   * The restricted notes travel with the nomination or not at all. Rewritten on
   * a correction so an edited note does not leave the old text behind — these
   * are the rows a human reads to decide whether to list someone.
   */
  await tx
    .delete(restrictedNotes)
    .where(eq(restrictedNotes.nominationId, nomination.id));

  const notes: Array<{ kind: string; body: string }> = [];
  if (input.private_note) {
    notes.push({ kind: "private_note", body: input.private_note });
  }
  if (input.hesitation_reason) {
    notes.push({ kind: "hesitation_reason", body: input.hesitation_reason });
  }
  if (notes.length > 0) {
    await tx.insert(restrictedNotes).values(
      notes.map((n) => ({
        nominationId: nomination.id,
        kind: n.kind,
        body: n.body,
      })),
    );
  }

  return nomination.id;
}

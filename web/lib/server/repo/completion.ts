import "server-only";

import { eq } from "drizzle-orm";
import type { Db } from "@/lib/server/db";
import {
  consents,
  demandSignals,
  flags,
  people,
} from "@/lib/db/schema";

/**
 * Estimate 1.7 — what the completion screen records.
 *
 * Replaced the tail of the `pando-1.7-complete` workflow. The three writes are
 * one transaction because they are one moment: a follow-up consent stored
 * without the allowance it was given under, or a high-stakes question stored
 * without the flag that routes it to a person, are both worse than nothing.
 */

export interface CompletionInput {
  /** Resolved from the verified phone. Null on the anonymous path. */
  person_id: string | null;
  follow_up_opt_in: boolean;
  consent_text_version: string;
  monthly_contact_allowance: number | null;
  demand: {
    question_text: string;
    category: string | null;
    sensitivity: "ordinary" | "peer_support" | "high_stakes";
    requires_human_review: boolean;
  } | null;
  is_test: boolean;
}

export interface CompletionResult {
  person_id: string | null;
  demand_signal_id: string | null;
  flagged: boolean;
}

export async function writeCompletion(
  db: Db,
  input: CompletionInput,
): Promise<CompletionResult> {
  return db.transaction(async (tx) => {
    /**
     * Founding is never self-granted. Finishing the form moves a named parent to
     * `pending_founding` — the admin queue is what makes it real, and the screen
     * they just saw promises a text, not a badge.
     */
    if (input.person_id) {
      await tx
        .update(people)
        .set({
          founding: "pending_founding",
          monthlyContactAllowance: input.monthly_contact_allowance,
        })
        .where(eq(people.id, input.person_id));

      /**
       * Recorded either way. A decline is as much a consent decision as an
       * opt-in, and only an explicit record can prove which one the parent made
       * and under what wording.
       */
      await tx.insert(consents).values({
        personId: input.person_id,
        scope: "follow_up",
        status: input.follow_up_opt_in ? "opted_in" : "declined",
        source: "seed_completion_screen",
        textVersion: input.consent_text_version,
      });
    }

    let demandSignalId: string | null = null;
    let flagged = false;

    if (input.demand) {
      const [signal] = await tx
        .insert(demandSignals)
        .values({
          personId: input.person_id,
          questionText: input.demand.question_text,
          category: input.demand.category,
          sensitivity: input.demand.sensitivity,
          requiresHumanReview: input.demand.requires_human_review,
          isTest: input.is_test,
        })
        .returning({ id: demandSignals.id });
      demandSignalId = signal.id;

      /**
       * A health, legal or safety question is owed a person today. The parent
       * already saw professional resources in the flow; this is the other half
       * of that promise — an admin queue entry that cannot be answered by an
       * automated path.
       */
      if (input.demand.sensitivity === "high_stakes" && !input.is_test) {
        await tx.insert(flags).values({
          severity: "escalation",
          reason: "high_stakes_demand",
          subjectKind: "demand_signal",
          subjectId: signal.id,
          personId: input.person_id,
        });
        flagged = true;
      }
    }

    return { person_id: input.person_id, demand_signal_id: demandSignalId, flagged };
  });
}

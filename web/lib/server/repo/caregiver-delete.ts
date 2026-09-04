import "server-only";

import { sql } from "drizzle-orm";
import { withDb, type Db } from "@/lib/server/db";
import { deleteCaregiverClaim } from "@/lib/server/repo/caregiver";

/**
 * 11.3 — a caregiver deleting themselves by text.
 *
 * The estimate's words are "can remove themselves at any time via a simple
 * message". That was unbuildable until 2 Sep for a plain reason recorded in
 * CLAUDE.md: **there was no channel.** The inbound pipeline now has two doors
 * (Twilio, and the Slack relay standing in for it), so the promise the 2C flow
 * has been making since 11 Aug — "Text DELETE and the whole profile goes" — can
 * finally be kept by the thing that made it.
 *
 * ## Why this is its own module
 *
 * `repo/caregiver.ts` owns the cascade and is imported by the admin write path;
 * this owns the *lookup by phone*, which only the inbound path needs. Keeping
 * them apart means the admin action carries no query it never uses, and this
 * file's one job — "is the person on this number a caregiver who may delete
 * themselves?" — is readable on its own.
 */

export type DeleteOutcome =
  /** Gone. The profile, the copied fields, the caregiver-scope consents. */
  | { deleted: true }
  /**
   * Nobody on that number has a caregiver profile.
   *
   * **Not an error, and deliberately not silent.** A *parent* texting DELETE is
   * the likely case — they meant something else, or they want their own data
   * gone, which is a different request with a different answer (a person handles
   * it; there is no self-serve parent delete and inventing one here would be a
   * product decision made in a repo function). So this is reported back so the
   * caller can say something true rather than nothing.
   */
  | { deleted: false; reason: "no_claim" | "unavailable" };

/**
 * Delete the caregiver profile belonging to this number, if there is one.
 *
 * **Keyed on the phone, which is the only thing an inbound message carries**,
 * and resolved through `people` — the same identity the claim was created
 * against (invariant 10: one person, one identity, keyed by phone). A caregiver
 * who signed themselves up at `/caregiver` verified that number to do it, so the
 * number *is* the authorisation. Nothing else is asked for, which is the point:
 * a delete that required a code would be a delete the flow's own copy lied
 * about.
 *
 * ## Two things it will not do
 *
 * **It never touches a parent's record.** The lookup starts from
 * `caregiver_claims`, so a number with no claim finds nothing — and the cascade
 * itself keeps the `people` row whenever a submission, a nomination or a
 * non-caregiver consent is attached to it. Somebody who is both a contributing
 * parent and a signed-up caregiver loses only the caregiver half.
 *
 * **It is not idempotent-by-accident.** A second DELETE finds no claim and says
 * so, rather than reporting a second success — which matters because the reply
 * is the only receipt the caregiver gets.
 */
export async function deleteCaregiverByPhone(phone: string): Promise<DeleteOutcome> {
  const result = await withDb(async (db: Db) =>
    db.transaction(async (tx) => {
      const rows = (await tx.execute(sql`
        select cc.id::text as claim_id
          from caregiver_claims cc
          join people p on p.id = cc.person_id
         where p.phone = ${phone}
         limit 1
      `)) as unknown as Array<Record<string, unknown>>;

      const claimId = rows[0]?.claim_id ? String(rows[0].claim_id) : null;
      if (!claimId) return { deleted: false as const, reason: "no_claim" as const };

      await deleteCaregiverClaim(tx, { claimId });

      /**
       * The record that a deletion happened, in the same transaction as the
       * deletion — the 6 Aug rule, and the same thing `claim.delete` gets for
       * free by going through `applyAction`.
       *
       * It carries **how they asked and nothing else.** The admin action
       * "records *how* they asked and never asks why" (11 Aug), and this is the
       * SMS answer to the same question: `resource_id` is deliberately null,
       * because storing the id of the profile we just deleted would keep a
       * pointer to the person this row exists to have removed. What survives is
       * a count Janet can see, with nobody in it.
       */
      await tx.execute(sql`
        insert into audit_log (actor, action, resource, resource_id, after)
        values ('caregiver:sms', 'claim.delete', 'caregiver_claim', null,
                ${JSON.stringify({ channel: "sms", self_service: true })}::jsonb)
      `);

      return { deleted: true as const };
    }),
  );

  /**
   * An unreachable database is reported, never treated as "nothing to delete".
   *
   * The fail-closed reasoning from `repo/outreach.ts` applies in mirror image
   * here: there, refusing means not sending, which is safe. Here, answering
   * "you had no profile" to somebody who does would be a lie about their own
   * data — the one thing this feature exists not to do. So the caller is told
   * the request could not be carried out, and the caregiver is asked to try
   * again rather than reassured falsely.
   */
  if (!result.persisted || !result.data) {
    return { deleted: false, reason: "unavailable" };
  }
  return result.data;
}

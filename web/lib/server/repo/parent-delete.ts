import "server-only";

import { sql } from "drizzle-orm";
import { withDb, type Db } from "@/lib/server/db";
import { deleteCaregiverClaim } from "@/lib/server/repo/caregiver";

/**
 * Somebody deletes everything Pando holds about their number.
 *
 * Client §1, 9 Sep — her question in the row about the Join page: *"Also how do
 * people delete their profile if they want to?"* A caregiver has been able to
 * text DELETE since 3 Sep (11.3); a contributing parent could not, from any
 * surface, and the flow made no promise it could keep about it.
 *
 * **Two callers since 14 Sep, and one rule between them.** `/api/seed/delete`
 * is the control on the review screen; `handleInboundMessage` is the DELETE
 * keyword, which `/privacy` had been offering every parent for months while
 * only caregivers could use it (see `isDeleteRequest`). Both mean the same
 * thing — *remove me* — so both run this, and the shape of "me" is decided
 * here once rather than per channel.
 *
 * ## What "the profile" means, and the schema already decided it
 *
 * This is one `delete from people` plus one exception, and the foreign keys do
 * the rest — which is not laziness, it is where the decision was taken. The
 * exception is the caregiver ladder, and the reason is in the comment on it
 * below: `caregivers` is the one table describing this person that the cascade
 * cannot reach. Every other table that
 * describes **the person** cascades: `consents`, `children`,
 * `social_affinities`, `life_relevance`, `person_schools`,
 * `affiliation_visibility`, `caregiver_claims`. Every table that holds
 * **something they contributed** is `on delete set null`:
 * `share_contributions`, `caregiver_nominations`, `submissions`,
 * `pending_options`, `message_log`.
 *
 * So the profile goes and the recommendations stay, detached. ⚠ That is
 * deliberate and it is what the product already tells them: the privacy
 * screen's own wording for the private option is *"Your recommendation is
 * still shared — your name is not."* A parent asking to be forgotten is asking
 * about themselves, and other parents' answers rest on what they shared.
 *
 * ⚠⚠ **The consequence to state rather than discover:** a record keeps the
 * firsthand count it earned, so *"Validated by multiple parents"* still counts
 * a parent who has left. That is the honest reading — two parents really did
 * use it — and the alternative silently weakens every answer built on a
 * departed contributor's experience. It is hers to reverse if she wants the
 * count to fall.
 *
 * ## Why it is not an admin action
 *
 * `admin-write.ts` is the one write path that cannot forget an audit row, and
 * every action there is *somebody deciding about somebody else*. This is a
 * person deciding about themselves, proved by the same verification the write
 * routes already demand (invariant 11) — so it takes the `claim.delete` shape
 * instead: one statement, its own audit row, and **how they asked** recorded
 * with no `resource_id`, because storing the id of the row just deleted keeps
 * a pointer to the person this exists to have removed.
 *
 * ## One word, one meaning
 *
 * ⚠ **DELETE removes everything, including the caregiver half, and that is a
 * widening of 11.3's boundary rather than a bug in it.** `deleteCaregiverClaim`
 * deliberately keeps the `people` row when a submission or a nomination is
 * attached — right for the **admin** action, where somebody is resolving a
 * claim and has no business touching that person's parent record. It is wrong
 * for a person asking to be removed: a keyword that deletes a different amount
 * depending on which role you happen to hold is one the sender cannot predict,
 * and they would be told they are gone while a profile of eighteen answers
 * stayed. So the admin path keeps the boundary and the self-service path does
 * not, and the receipt names each thing that went.
 */
export type ParentDeleteOutcome =
  | {
      status: "deleted";
      /** Recommendations left behind, pointing at nobody. The receipt says so. */
      contributions: number;
      /** They had signed themselves up at `/caregiver`, so a listing went too. */
      caregiver: boolean;
      /** They had finished the questionnaire, as against a bare inbound row. */
      profile: boolean;
    }
  /** Nothing at all on this number — `/join` is where they go. */
  | { status: "no_profile" }
  /** The database could not be reached. ⚠ Never reported as "no profile". */
  | { status: "unavailable" };

export async function deleteParentByPhone(
  phone: string,
  how: string,
): Promise<ParentDeleteOutcome> {
  const result = await withDb(async (db: Db) =>
    db.transaction(async (tx) => {
      const found = (await tx.execute(sql`
        select p.id,
               (p.profile_captured_at is not null) as has_profile,
               exists (
                 select 1 from caregiver_claims cc where cc.person_id = p.id
               ) as is_caregiver
          from people p
         where p.phone = ${phone}
         limit 1
      `)) as unknown as Array<Record<string, unknown>>;
      const person = found[0];
      if (!person) return { status: "no_profile" as const };

      const id = String(person.id);
      const caregiver = person.is_caregiver === true;
      const profile = person.has_profile === true;

      /* Counted **before** the delete, because afterwards the rows are still
         there and simply point at nobody — so this number is the one thing
         that cannot be recovered from the table once the person is gone, and
         it is what the audit row needs to say what was detached. */
      const counted = (await tx.execute(sql`
        select count(*)::int as n from share_contributions where person_id = ${id}::uuid
      `)) as unknown as Array<Record<string, unknown>>;
      const contributions = Number(counted[0]?.n ?? 0);

      await tx.execute(sql`
        insert into audit_log (actor, action, resource, resource_id, after)
        values (
          'parent',
          'profile.delete',
          'people',
          null,
          ${JSON.stringify({
            how,
            contributions_detached: contributions,
            caregiver,
            profile,
          })}::jsonb
        )
      `);

      /**
       * ⚠⚠ **The caregiver ladder comes down first, and the order is the
       * correctness of the whole function.**
       *
       * `caregiver_claims.person_id` cascades, so a bare `delete from people`
       * takes the claim with it — but `caregivers.profile_person_id` is
       * `on delete set null`, and that row is a **different table**. So the
       * listing would survive with `consent_status = 'consented'`, `active`
       * and `discoverable` still true, the copied `caregiver_profiles` row
       * still beside it, and the claim that pointed at the person gone: a
       * caregiver who asked to be deleted still answerable under invariant 1,
       * with nothing left to trace it back by.
       *
       * ⚠ Reached by both channels — this was latent in the web control from
       * the day it shipped and would have fired the first time a contributing
       * parent had also signed themselves up at `/caregiver`. Nobody is in
       * that state today (measured: 0 of 34), which is why it was invisible.
       *
       * `deleteCaregiverClaim` is the one copy of that cascade, run **inside
       * this transaction** rather than beside it: two transactions would leave
       * a window where the listing is revoked and the person is not, and a
       * retry would then report "nothing to delete" to somebody half-deleted.
       * Its own trailing `delete from people` is conditional and will refuse
       * while contributions are attached — so the unconditional one below is
       * what finishes the job, and is a harmless no-op when it already did.
       */
      if (caregiver) await deleteCaregiverClaim(tx, { personId: id });

      await tx.execute(sql`delete from people where id = ${id}::uuid`);

      return { status: "deleted" as const, contributions, caregiver, profile };
    }),
  );

  /* The one lie this must never tell: somebody who *has* a profile being told
     they never did. An unreachable database says so — the `persisted: false`
     honesty rule, applied to the read inside a delete. */
  if (!result.persisted) return { status: "unavailable" };
  return result.data ?? { status: "unavailable" };
}

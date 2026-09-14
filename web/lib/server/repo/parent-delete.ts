import "server-only";

import { sql } from "drizzle-orm";
import { withDb, type Db } from "@/lib/server/db";

/**
 * A parent deletes their own profile (client §1, 9 Sep).
 *
 * Her question, in the row about the Join page: *"Also how do people delete
 * their profile if they want to?"* A caregiver has been able to text DELETE
 * since 3 Sep (11.3); a contributing parent could not, from any surface, and
 * the flow makes no promise it could keep about it.
 *
 * ## What "the profile" means, and the schema already decided it
 *
 * This is one `delete from people`, and the foreign keys do the rest — which
 * is not laziness, it is where the decision was taken. Every table that
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
 */
export type ParentDeleteOutcome =
  | { status: "deleted"; contributions: number }
  /** The number is verified and has no profile — `/join` is where they go. */
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
        select id from people where phone = ${phone} limit 1
      `)) as unknown as Array<Record<string, unknown>>;
      const person = found[0];
      if (!person) return { status: "no_profile" as const };

      const id = String(person.id);

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
          ${JSON.stringify({ how, contributions_detached: contributions })}::jsonb
        )
      `);

      await tx.execute(sql`delete from people where id = ${id}::uuid`);

      return { status: "deleted" as const, contributions };
    }),
  );

  /* The one lie this must never tell: somebody who *has* a profile being told
     they never did. An unreachable database says so — the `persisted: false`
     honesty rule, applied to the read inside a delete. */
  if (!result.persisted) return { status: "unavailable" };
  return result.data ?? { status: "unavailable" };
}

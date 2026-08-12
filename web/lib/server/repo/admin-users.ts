import "server-only";

import { eq, sql } from "drizzle-orm";
import type { Db } from "@/lib/server/db";
import { adminUsers } from "@/lib/db/schema";

/**
 * The credential store (estimate 2.1).
 *
 * **Who may sign in** is not something the app can change from inside itself:
 * creating a person and taking access away go through `npm run admin:user`,
 * because a page that grants access is a session granting a session, and the
 * client asked for one admin and maybe two (QC Answers Q6).
 *
 * Two writes are allowed here, and both change *nothing* about who has access:
 *
 *  - `stampSignIn`, a fact about a sign-in that already happened;
 *  - `changeOwnPassword`, which lets a signed-in admin replace **their own**
 *    password. It cannot name anyone else, and it cannot create or enable
 *    anybody — the row has to exist and be active before it will do anything.
 */

export interface StoredCredential {
  name: string;
  /** `scrypt:<N>:<r>:<p>:<salt>:<hash>` — never a password (CHECK, 0008). */
  password_hash: string;
}

/**
 * Everyone who may sign in, ordered by name so the derived session key is stable
 * across processes and restarts (see `keyMaterial` in `lib/admin/auth.ts`).
 *
 * Inactive people are not returned at all — not "returned and filtered later".
 * A list that ever carries a revoked credential is one refactor away from
 * verifying against it.
 */
export async function activeCredentials(db: Db): Promise<StoredCredential[]> {
  const rows = await db
    .select({ name: adminUsers.name, password_hash: adminUsers.passwordHash })
    .from(adminUsers)
    .where(eq(adminUsers.active, true))
    .orderBy(adminUsers.name);
  return rows;
}

/**
 * Records that this person signed in. Fire-and-forget at the call site: a failed
 * stamp must never fail a sign-in that has already been proved, and this column
 * exists to answer "is this account still in use", not to authorise anything.
 */
export async function stampSignIn(db: Db, name: string): Promise<void> {
  await db.execute(
    sql`update admin_users set last_sign_in_at = now() where name = ${name} and active`,
  );
}

/**
 * Replaces one person's own password, with the audit row in the same
 * transaction — the same rule every other sensitive write in this app follows.
 *
 * Three things it deliberately cannot do, all enforced by the statement rather
 * than by the caller remembering:
 *
 *  - **name somebody else.** The name comes from the verified session, and the
 *    `where` clause is the only place it is used;
 *  - **create anybody.** No insert, so a name that is not already in the table
 *    changes nothing and reports it;
 *  - **wake a revoked account.** `and active` — a disabled admin whose session
 *    was still in a tab must not be able to set a fresh password and return.
 *
 * The record is hashed before it arrives here; a plaintext password could not be
 * stored even by mistake, because `admin_users_hash_check` refuses anything that
 * is not `scrypt:N:r:p:salt:hash`.
 */
export async function changeOwnPassword(
  db: Db,
  name: string,
  record: string,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const rows = (await tx.execute(
      sql`update admin_users
             set password_hash = ${record},
                 password_changed_at = now(),
                 updated_at = now()
           where name = ${name} and active
       returning name`,
    )) as unknown as Array<Record<string, unknown>>;

    if (rows.length === 0) return false;

    /* No `after` payload: everything about this change that is safe to keep is
       already in the columns, and the one thing that is not — the password —
       must never reach a log. The fact, the actor and the time are the record. */
    await tx.execute(
      sql`insert into audit_log (actor, action, resource, resource_id)
          values (${name}, 'admin.password', 'admin_user', ${name})`,
    );
    return true;
  });
}

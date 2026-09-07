import "server-only";

import { randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Db } from "../db";

/**
 * A parent's own referral link, and the relation it records.
 *
 * ## Why it is an `invites` row rather than a table of its own
 *
 * The client's third instruction is that a verified parent gets a link to invite
 * others, and that the database records who referred whom. A referral link is
 * an invite link that happens to belong to a person, so it is one more
 * `invites` row (`drizzle/0034`, `kind = 'personal'`, `referrer_person_id` set)
 * — which is also the client's own earlier framing (27 Aug: a personal
 * invitation is "one more invite row").
 *
 * That buys the entire existing mechanism unchanged: resolution with its 60
 * second cache, `people.invite_id` attribution, the `opens` counter estimate
 * 2.2's funnel needs, and `/admin/invites` reporting. A second table would have
 * had to learn all of it, and would have been a second answer to "where did
 * this person come from".
 *
 * ## The 10 Aug decision this flips, and the half of it that still stands
 *
 * *"A referral is recorded by an admin, never read from a URL"* — because there
 * were no per-parent codes, and `?r=` would have breached "no query parameter
 * changes app behaviour" (4 Aug). Both reasons are now spent: the code is a real
 * `invites` row, and it arrives on `?i=`, which is the product's own parameter
 * and the only one the app has ever read. That row even anticipated this: *"if
 * the client flips to unique links, this becomes automatic and the shape does
 * not change."* The shape did not change — `referrals` is still the record.
 *
 * What still stands is the *credit* half: `status` stays `profile_complete` and
 * never `credited`, because a credit is denominated in Network Asks and granting
 * one here would promise a balance nothing can spend.
 */

/** The link a parent shares. Kept next to the code that mints it. */
export function referralUrl(code: string): string {
  return `https://pando.is/join?i=${code}`;
}

/**
 * A code for this parent, unique and unguessable-enough.
 *
 * Shaped from their own first name so a parent can recognise their link in a
 * chat — and suffixed with real entropy, because two Sarahs must not collide
 * and a sequential suffix would let anybody enumerate the cohort. Six hex
 * characters is 16.7M, against a pilot of ~350.
 *
 * `invites_code_check` requires `^[a-z0-9]+(-[a-z0-9]+)*$`, so the name is
 * stripped to that alphabet and falls back to `p` when a name is all
 * punctuation or a script the pattern does not admit — a code is an id here,
 * never a display name.
 */
export function referralCode(firstName: string | null): string {
  const stem =
    (firstName ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "")
      .slice(0, 12) || "p";
  return `${stem}-${randomBytes(3).toString("hex")}`;
}

/**
 * The parent's link, created once and returned every time.
 *
 * Idempotent by the partial unique index on `referrer_person_id`: the second
 * call returns the first call's row rather than minting a second link, which
 * matters because a parent who edits and re-saves their profile comes through
 * here again and their link is already in somebody's WhatsApp group.
 *
 * A code collision retries rather than failing: the parent is mid-flow and the
 * only cost of a retry is another three bytes of entropy.
 */
export async function ensureReferralLink(
  db: Db,
  person: { id: string; first_name: string | null; market_id: string },
): Promise<string | null> {
  const existing = await db.execute(
    sql`select code from invites where referrer_person_id = ${person.id} limit 1`,
  );
  const found = (existing as unknown as Array<{ code: string }>)[0];
  if (found?.code) return found.code;

  for (let attempt = 0; attempt < 4; attempt++) {
    const code = referralCode(person.first_name);
    try {
      const inserted = await db.execute(
        sql`insert into invites
              (code, market_id, label, kind, referrer_person_id, note, created_by)
            values (${code}, ${person.market_id},
                    ${`${person.first_name ?? "A parent"}'s referral link`},
                    'personal', ${person.id},
                    'Created by the app when this parent verified their number.',
                    'app')
            on conflict (code) do nothing
            returning code`,
      );
      const row = (inserted as unknown as Array<{ code: string }>)[0];
      if (row?.code) return row.code;
      /* The code collided. Loop and take another. */
    } catch {
      /**
       * The one error worth swallowing: two requests for the same parent racing
       * each other, where the loser hits `invites_referrer_person_uniq`. Their
       * link exists — read it back rather than reporting a failure for
       * something that succeeded.
       */
      const again = await db.execute(
        sql`select code from invites where referrer_person_id = ${person.id} limit 1`,
      );
      const row = (again as unknown as Array<{ code: string }>)[0];
      return row?.code ?? null;
    }
  }
  return null;
}

/**
 * Who referred whom, when a parent arrived on somebody's personal link.
 *
 * Four rules, and each is a decision rather than an implementation detail.
 *
 * **Only a `personal` link writes one.** A group or school link records a
 * channel, not a person: `people.invite_id` already says which link brought
 * them, and calling a WhatsApp group a referrer would put a name on something
 * nobody did.
 *
 * **A parent cannot refer themselves.** It is the one shape that would quietly
 * corrupt the count Janet reads, which is why `/api/admin/action` already
 * refuses it for the manual path.
 *
 * **The referrer may be an admin.** An individual link created at
 * `/admin/invites` belongs to the operator who made it, and an admin is not a
 * `people` row (invariant 10) — hence `referrer_admin`, and hence the write
 * chooses one column or the other rather than inventing an identity.
 *
 * **`status` is `profile_complete`, never `credited`.** The 10 Aug rule: a
 * credit is denominated in Network Asks, which do not exist yet, so granting one
 * would promise a balance nothing can spend.
 */
export async function recordReferral(
  db: Db,
  input: { referred_person_id: string; invite_id: string | null },
): Promise<"none" | "person" | "admin" | "self"> {
  if (!input.invite_id) return "none";

  const rows = (await db.execute(
    sql`select kind, referrer_person_id, created_by
        from invites where id = ${input.invite_id} limit 1`,
  )) as unknown as Array<{
    kind: string | null;
    referrer_person_id: string | null;
    created_by: string | null;
  }>;
  const invite = rows[0];
  if (!invite || invite.kind !== "personal") return "none";

  if (invite.referrer_person_id) {
    if (invite.referrer_person_id === input.referred_person_id) return "self";
    await db.execute(
      sql`insert into referrals (referrer_id, referred_id, status)
          values (${invite.referrer_person_id}, ${input.referred_person_id},
                  'profile_complete')
          on conflict (referrer_id, referred_id) do nothing`,
    );
    return "person";
  }

  if (invite.created_by) {
    /* An admin's individual link. No unique constraint covers this pair —
       `referrals_referrer_id_referred_id_key` is on the person columns — so the
       insert asks first, which is what keeps a re-saved profile from stacking
       rows. */
    const already = (await db.execute(
      sql`select 1 from referrals
          where referred_id = ${input.referred_person_id}
            and referrer_admin = ${invite.created_by}
          limit 1`,
    )) as unknown as unknown[];
    if (already.length === 0) {
      await db.execute(
        sql`insert into referrals (referrer_admin, referred_id, status)
            values (${invite.created_by}, ${input.referred_person_id},
                    'profile_complete')`,
      );
    }
    return "admin";
  }

  return "none";
}

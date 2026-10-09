import "server-only";

import { sql, type SQL } from "drizzle-orm";
import type { Db } from "@/lib/server/db";
import {
  countCompletePerPerson,
  type ContributionColumns,
  type NominationColumns,
} from "@/lib/contribution-quality";

/**
 * How many **complete** contributions each parent has — what Founding counts.
 *
 * The client (5 Oct): a contribution counts once its minimum questions are
 * answered, not once an admin has pressed Add to Pando. `founding_checklist`
 * still counts approved cards (`approved_contributions`, drizzle/0045), and that
 * view cannot hold the rule: it lives in TypeScript, one copy, read by the chat,
 * the admin card and this.
 *
 * ⚠ **Counted here and handed to SQL as two arrays**, rather than restated in
 * SQL or stored in a column. A second copy of the rule in Postgres would drift
 * the first time somebody edits one (the fault this repository keeps recording),
 * and a stored column needs a migration and a backfill against production. The
 * price is one extra read per admin page that decides Founding — a few hundred
 * rows at pilot size — and the arrays are inlined as literals, never as
 * parameters that drizzle would expand into a record.
 *
 * Approved cards only, test rows never, and a caregiver nomination only when it
 * is approved and not held — exactly the view's own conditions.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function completeCounts(
  db: Db,
  personId: string | null = null,
): Promise<Map<string, number>> {
  if (personId !== null && !UUID.test(personId)) return new Map();
  const only = personId;

  const shareRows = (await db.execute(sql`
    select sc.person_id, pl.kind, pl.name, sc.firsthand, sc.child_age_at_time,
           sc.last_there, sc.what_makes_it_great, sc.caveat_answered, sc.tip_text,
           sc.visit_reason
      from share_contributions sc
      join shares pl on pl.id = sc.share_id
     where sc.status = 'approved' and not sc.is_test and sc.person_id is not null
       and (${only}::uuid is null or sc.person_id = ${only}::uuid)
  `)) as unknown as Array<ContributionColumns & { person_id: string }>;

  const nominationRows = (await db.execute(sql`
    select n.person_id, cg.first_name, n.care_type, n.cared_for_ages, n.strengths,
           n.how_long, n.last_worked, n.hire_again, n.reference_willing
      from caregiver_nominations n
      join caregivers cg on cg.id = n.caregiver_id
     where n.status = 'approved' and not n.review_hold and not n.is_test
       and n.person_id is not null
       and (${only}::uuid is null or n.person_id = ${only}::uuid)
  `)) as unknown as Array<NominationColumns & { person_id: string }>;

  return countCompletePerPerson({ shares: shareRows, nominations: nominationRows });
}

/**
 * A scalar SQL expression for one person's complete count, from the map above.
 * `personId` is the SQL for the person's id in the surrounding query.
 */
export function completeCountSql(counts: Map<string, number>, personId: SQL): SQL {
  const entries = [...counts].filter(([id, n]) => UUID.test(id) && n > 0);
  const ids = `{${entries.map(([id]) => id).join(",")}}`;
  const ns = `{${entries.map(([, n]) => Math.trunc(n)).join(",")}}`;
  return sql`coalesce((select t.n from unnest(${ids}::uuid[], ${ns}::int[]) as t(id, n)
                        where t.id = ${personId}), 0)`;
}

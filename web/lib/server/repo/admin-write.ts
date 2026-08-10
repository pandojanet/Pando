import "server-only";

import { sql } from "drizzle-orm";
import type { Db } from "@/lib/server/db";

/**
 * Estimates 2.4–2.8 — every sensitive admin write.
 *
 * Replaced the 41-node `admin_write` workflow, and keeps the property that made
 * that workflow a single Switch in the first place: **the audit row is written
 * in the same transaction as the change.** Not afterwards, not by the caller,
 * not best-effort. If the change lands, the record of who made it lands with it;
 * if the audit insert fails, the change rolls back.
 *
 * The route in front of this does the arguing — consent needs evidence, a hold
 * needs a reason, visibility needs consent. By the time an action arrives here
 * it has been validated, and what is left is to apply it and say what happened.
 */

export interface ActionContext {
  actor: string;
  action: string;
  body: Record<string, unknown>;
}

export type ActionOutcome =
  | { applied: true; resource: string; resource_id: string | null }
  | { applied: false; reason: "not_implemented" };

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

const text = (v: unknown): string | null =>
  typeof v === "string" && v.trim() !== "" ? v.trim() : null;

const id = (v: unknown): string => (typeof v === "string" ? v : "");

const ids = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

export async function applyAction(
  db: Db,
  ctx: ActionContext,
): Promise<ActionOutcome> {
  return db.transaction(async (tx) => {
    const outcome = await run(tx, ctx);
    if (outcome.applied) {
      await audit(tx, ctx, outcome.resource, outcome.resource_id);
    }
    return outcome;
  });
}

/**
 * The one place an audit row is written. `before` is deliberately not captured
 * for most actions: reading the row first would double every query, and the
 * action plus its target is what an admin actually needs to answer "who changed
 * this". The free text an admin typed lands in `after` because that text *is*
 * the decision — it is never shown to a parent.
 */
async function audit(
  tx: Tx,
  ctx: ActionContext,
  resource: string,
  resourceId: string | null,
): Promise<void> {
  const after = { ...ctx.body };
  delete after.action;
  await tx.execute(
    sql`insert into audit_log (actor, action, resource, resource_id, after)
        values (${ctx.actor}, ${ctx.action}, ${resource}, ${resourceId},
                ${JSON.stringify(after)}::jsonb)`,
  );
}

async function run(tx: Tx, ctx: ActionContext): Promise<ActionOutcome> {
  const b = ctx.body;

  switch (ctx.action) {
    /* ── 2.4 Contributions ───────────────────────────────────────────────── */

    case "contribution.approve": {
      const target = id(b.id);
      await tx.execute(
        sql`update place_contributions
            set status = 'approved', approved_at = now(), approved_by = ${ctx.actor}
            where id = ${target}::uuid`,
      );
      /**
       * Approving a contribution is also the moment a place becomes usable and
       * its freshness clock starts — a place with no approved contribution
       * behind it must never reach an answer.
       */
      await tx.execute(
        sql`update places
            set status = 'approved',
                validated_count = validated_count + 1,
                last_confirmed_at = now(),
                freshness_state = 'fresh'
            where id = (select place_id from place_contributions where id = ${target}::uuid)`,
      );
      return { applied: true, resource: "place_contribution", resource_id: target };
    }

    case "contribution.needs_detail": {
      const target = id(b.id);
      await tx.execute(
        sql`update place_contributions set status = 'needs_detail' where id = ${target}::uuid`,
      );
      return { applied: true, resource: "place_contribution", resource_id: target };
    }

    case "contribution.reject": {
      const target = id(b.id);
      await tx.execute(
        sql`update place_contributions set status = 'rejected' where id = ${target}::uuid`,
      );
      return { applied: true, resource: "place_contribution", resource_id: target };
    }

    case "contribution.edit": {
      const target = id(b.id);
      const patch = (b.patch ?? {}) as Record<string, unknown>;
      /**
       * Only the curated columns are editable, and by an explicit allow-list:
       * the capture in `submissions.fields` is never touched, because it is the
       * answer to "did the parent actually say that".
       */
      const sets = [];
      if (text(patch.what_makes_it_great) !== null)
        sets.push(sql`what_makes_it_great = ${text(patch.what_makes_it_great)}`);
      if (text(patch.caveat) !== null) sets.push(sql`caveat = ${text(patch.caveat)}`);
      if (text(patch.who_for) !== null) sets.push(sql`who_for = ${text(patch.who_for)}`);
      if (text(patch.who_not_for) !== null)
        sets.push(sql`who_not_for = ${text(patch.who_not_for)}`);
      if (text(patch.tip_text) !== null)
        sets.push(sql`tip_text = ${text(patch.tip_text)}`);
      if (sets.length > 0) {
        await tx.execute(
          sql`update place_contributions set ${sql.join(sets, sql`, `)} where id = ${target}::uuid`,
        );
      }
      return { applied: true, resource: "place_contribution", resource_id: target };
    }

    /* ── 2.5 Caregivers ──────────────────────────────────────────────────── */

    case "nomination.approve": {
      const target = id(b.id);
      /**
       * A held nomination cannot be approved past its hold. The hold is there
       * because a parent hesitated about a named person, and releasing it is a
       * separate, noted decision (invariant 12's sibling).
       */
      await tx.execute(
        sql`update caregiver_nominations
            set status = 'approved', approved_at = now(), approved_by = ${ctx.actor}
            where id = ${target}::uuid and not review_hold`,
      );
      return { applied: true, resource: "caregiver_nomination", resource_id: target };
    }

    case "nomination.reject": {
      const target = id(b.id);
      await tx.execute(
        sql`update caregiver_nominations set status = 'rejected' where id = ${target}::uuid`,
      );
      return { applied: true, resource: "caregiver_nomination", resource_id: target };
    }

    case "nomination.release_hold": {
      const target = id(b.id);
      await tx.execute(
        sql`update caregiver_nominations
            set review_hold = false, hold_reasons = '{}'
            where id = ${target}::uuid`,
      );
      return { applied: true, resource: "caregiver_nomination", resource_id: target };
    }

    case "caregiver.consent": {
      const target = id(b.id);
      const to = id(b.to);
      const evidence =
        to === "consented"
          ? JSON.stringify({
              method: id(b.method),
              note: text(b.note),
              at: new Date().toISOString(),
            })
          : null;
      /**
       * `consent_needs_evidence` refuses 'consented' without evidence, and
       * dropping back off 'consented' must take the visibility flags with it —
       * otherwise `visibility_requires_consent` would abort the statement.
       */
      await tx.execute(
        sql`update caregivers
            set consent_status = ${to}::consent_status,
                consent_evidence = coalesce(${evidence}::jsonb, consent_evidence),
                active        = case when ${to} = 'consented' then active        else false end,
                discoverable  = case when ${to} = 'consented' then discoverable  else false end,
                introducible  = case when ${to} = 'consented' then introducible  else false end
            where id = ${target}::uuid`,
      );
      return { applied: true, resource: "caregiver", resource_id: target };
    }

    case "caregiver.visibility": {
      const target = id(b.id);
      const sets = [];
      if (typeof b.active === "boolean") sets.push(sql`active = ${b.active}`);
      if (typeof b.discoverable === "boolean")
        sets.push(sql`discoverable = ${b.discoverable}`);
      if (typeof b.introducible === "boolean")
        sets.push(sql`introducible = ${b.introducible}`);
      if (sets.length > 0) {
        /**
         * The `and consent_status = 'consented'` is not redundant with the route
         * check: the route validates what the *page* believed, this validates
         * what the database currently holds. Between the two, a consent that was
         * revoked in another tab cannot be stepped over.
         */
        await tx.execute(
          sql`update caregivers set ${sql.join(sets, sql`, `)}
              where id = ${target}::uuid and consent_status = 'consented'`,
        );
      }
      return { applied: true, resource: "caregiver", resource_id: target };
    }

    case "caregiver.merge": {
      const keep = id(b.keep);
      const merge = ids(b.merge).filter((x) => x !== keep);
      if (!keep || merge.length === 0) return { applied: false, reason: "not_implemented" };
      /**
       * Nominations move to the surviving record; the folded rows are deleted,
       * not flagged. Their nominations are the evidence, and the audit row keeps
       * the list of what was folded in.
       */
      await tx.execute(
        sql`update caregiver_nominations set caregiver_id = ${keep}::uuid
            where caregiver_id in ${sql`(${sql.join(
              merge.map((m) => sql`${m}::uuid`),
              sql`, `,
            )})`}`,
      );
      await tx.execute(
        sql`delete from caregivers
            where id in ${sql`(${sql.join(
              merge.map((m) => sql`${m}::uuid`),
              sql`, `,
            )})`}`,
      );
      return { applied: true, resource: "caregiver", resource_id: keep };
    }

    /* ── 2.6 Tap lists ───────────────────────────────────────────────────── */

    case "option.promote": {
      const target = id(b.id);
      const [row] = (await tx.execute(
        sql`select market_id, category, submitted_value from pending_options
            where id = ${target}::uuid limit 1`,
      )) as unknown as Array<Record<string, unknown>>;
      if (!row) return { applied: false, reason: "not_implemented" };

      await tx.execute(
        sql`insert into market_options (market_id, category, option_value, label)
            values (${row.market_id as string}, ${row.category as string},
                    ${id(b.option_value)}, ${text(b.label) ?? (row.submitted_value as string)})
            on conflict (market_id, category, option_value) do update set active = true`,
      );
      await tx.execute(
        sql`update pending_options set status = 'approved' where id = ${target}::uuid`,
      );
      return { applied: true, resource: "market_option", resource_id: target };
    }

    case "option.reject": {
      const target = id(b.id);
      await tx.execute(
        sql`update pending_options set status = 'rejected' where id = ${target}::uuid`,
      );
      return { applied: true, resource: "pending_option", resource_id: target };
    }

    case "option.retire": {
      const target = id(b.id);
      /** Retired, never deleted: existing rows still reference the value. */
      await tx.execute(
        sql`update market_options set active = false where id = ${target}::uuid`,
      );
      return { applied: true, resource: "market_option", resource_id: target };
    }

    /* ── 2.7 Flags and demand ────────────────────────────────────────────── */

    case "flag.resolve": {
      const target = id(b.id);
      await tx.execute(
        sql`update flags
            set status = 'resolved', resolved_at = now(),
                resolved_by = ${ctx.actor}, resolution_note = ${text(b.note)}
            where id = ${target}::uuid`,
      );
      return { applied: true, resource: "flag", resource_id: target };
    }

    case "flag.escalate": {
      const target = id(b.id);
      await tx.execute(
        sql`update flags
            set status = 'escalated', resolution_note = ${text(b.note)}
            where id = ${target}::uuid`,
      );
      return { applied: true, resource: "flag", resource_id: target };
    }

    case "demand.status": {
      const target = id(b.id);
      await tx.execute(
        sql`update demand_signals set status = ${id(b.to)} where id = ${target}::uuid`,
      );
      return { applied: true, resource: "demand_signal", resource_id: target };
    }

    /* ── 2.2 Founding ────────────────────────────────────────────────────── */

    case "founding.approve": {
      const targets = ids(b.ids);
      if (targets.length === 0) return { applied: false, reason: "not_implemented" };
      await tx.execute(
        sql`update people set founding = 'founding'
            where id in ${sql`(${sql.join(
              targets.map((t) => sql`${t}::uuid`),
              sql`, `,
            )})`}`,
      );
      return { applied: true, resource: "person", resource_id: targets.join(",") };
    }

    case "founding.request_invite": {
      const targets = ids(b.ids);
      if (targets.length === 0) return { applied: false, reason: "not_implemented" };
      /**
       * Not a rejection: the person keeps every submission and becomes an
       * ordinary user at launch. Only the founding claim is withdrawn.
       */
      await tx.execute(
        sql`update people set founding = 'request_invite'
            where id in ${sql`(${sql.join(
              targets.map((t) => sql`${t}::uuid`),
              sql`, `,
            )})`}`,
      );
      return { applied: true, resource: "person", resource_id: targets.join(",") };
    }

    /* ── 2.3 Contributors ────────────────────────────────────────────────── */

    case "contributor.note": {
      /**
       * The note lives in the audit log and nowhere else: it is an admin's
       * observation about a person, so the record of who wrote it is inseparable
       * from the text.
       */
      return { applied: true, resource: "contributor_note", resource_id: id(b.id) };
    }

    /* ── D2 Referrals ────────────────────────────────────────────────────── */

    case "referral.link": {
      const referrer = id(b.referrer);
      const referred = id(b.referred);
      if (!referrer || !referred || referrer === referred) {
        return { applied: false, reason: "not_implemented" };
      }
      /**
       * `profile_complete`, not `credited`: the parent is here and finished, but
       * a credit is denominated in Network Asks, which do not exist until Phase 2.
       * Marking this credited now would promise a balance nothing can spend.
       *
       * Re-linking the same pair is a no-op rather than an error — the unique
       * constraint already says a pair is one fact, and an admin clicking twice
       * should not see a Postgres violation.
       */
      await tx.execute(
        sql`insert into referrals (referrer_id, referred_id, status)
            values (${referrer}::uuid, ${referred}::uuid, 'profile_complete')
            on conflict (referrer_id, referred_id)
            do update set status = 'profile_complete'`,
      );
      return { applied: true, resource: "referral", resource_id: referred };
    }

    case "referral.void": {
      const target = id(b.id);
      if (!target) return { applied: false, reason: "not_implemented" };
      /** Kept, not deleted: a link we withdrew is still something we once believed. */
      await tx.execute(
        sql`update referrals set status = 'void' where id = ${target}::uuid`,
      );
      return { applied: true, resource: "referral", resource_id: target };
    }

    default:
      return { applied: false, reason: "not_implemented" };
  }
}

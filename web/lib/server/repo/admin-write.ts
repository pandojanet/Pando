import "server-only";

import { sql } from "drizzle-orm";
import type { Db } from "@/lib/server/db";
import { graphTargetForCategory } from "@/lib/derive";

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
  | { applied: false; reason: "not_implemented" | "referral_cap_reached" };

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
        sql`update share_contributions
            set status = 'approved', approved_at = now(), approved_by = ${ctx.actor}
            where id = ${target}::uuid`,
      );
      /**
       * Approving a contribution is also the moment a place becomes usable and
       * its freshness clock starts — a place with no approved contribution
       * behind it must never reach an answer.
       */
      await tx.execute(
        sql`update shares
            set status = 'approved',
                validated_count = validated_count + 1,
                last_confirmed_at = now(),
                freshness_state = 'fresh'
            where id = (select share_id from share_contributions where id = ${target}::uuid)`,
      );
      return { applied: true, resource: "share_contribution", resource_id: target };
    }

    case "contribution.needs_detail": {
      const target = id(b.id);
      /**
       * There is nowhere to send this yet — no SMS reply pipeline exists — so
       * this is an internal note, not an outbound message, whatever the screen
       * used to imply. Stored rather than discarded (it used to survive only in
       * `audit_log.after`), so the reviewer who set this status still has the
       * question in front of them next time the queue is opened.
       */
      await tx.execute(
        sql`update share_contributions
            set status = 'needs_detail', needs_detail_note = ${text(b.question)}
            where id = ${target}::uuid`,
      );
      return { applied: true, resource: "share_contribution", resource_id: target };
    }

    case "contribution.reject": {
      const target = id(b.id);
      await tx.execute(
        sql`update share_contributions set status = 'rejected' where id = ${target}::uuid`,
      );
      return { applied: true, resource: "share_contribution", resource_id: target };
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
        /**
         * The score describes *this text*, so editing the text retires it. Cleared
         * rather than recomputed here: extraction is a network call to another API
         * and this is inside the transaction that also writes the audit row — one
         * slow provider must not be able to fail an admin's edit. Null puts the
         * card back in the sweep (`POST /api/admin/extract`), which is the path
         * that exists for exactly this.
         *
         * Leaving the old number would have been worse than having none: it was
         * about a sentence that no longer exists, and the low-confidence queue
         * would sort on it.
         */
        await tx.execute(
          sql`update share_contributions
              set ${sql.join(sets, sql`, `)}, confidence = null, confidence_note = null
              where id = ${target}::uuid`,
        );
      }
      return { applied: true, resource: "share_contribution", resource_id: target };
    }

    /**
     * §17.1 golden answers. The place, not the contribution — and the update is
     * conditional on `status = 'approved'` rather than trusting the page, because
     * `shares_answer_ready_check` would otherwise abort the whole transaction
     * (audit row included) on a stale screen. A no-op is the right answer to
     * "mark a record ready that has since been rejected".
     */
    case "share.answer_ready": {
      const target = id(b.id);
      const to = b.to === true;
      await tx.execute(
        sql`update shares set answer_ready = ${to}, updated_at = now()
            where id = ${target}::uuid
              and (${to} = false or status = 'approved')`,
      );
      return { applied: true, resource: "share", resource_id: target };
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

    /* ── Invites: one per group, never per parent ────────────────────────── */

    /**
     * The code is a soft gate and an attribution key, not authentication — see
     * `lib/server/invite.ts`. Creating one is therefore cheap and reversible; the
     * only thing that must not happen is a row per parent.
     *
     * `on conflict do update` rather than an error: re-creating an existing code is
     * how an admin brings a retired one back with a corrected label, and a
     * Postgres violation is a worse answer to that than doing it.
     */
    case "invite.create": {
      const code = id(b.code);
      const label = text(b.label);
      if (!code || !label) return { applied: false, reason: "not_implemented" };

      const [row] = (await tx.execute(
        sql`insert into invites (code, market_id, label, group_option_value, note, created_by)
            values (${code}, ${id(b.market_id) || "pasadena"}, ${label},
                    ${text(b.group_option_value)}, ${text(b.note)}, ${ctx.actor})
            on conflict (code) do update set
              label = excluded.label,
              market_id = excluded.market_id,
              group_option_value = excluded.group_option_value,
              note = excluded.note,
              active = true
            returning id`,
      )) as unknown as Array<Record<string, unknown>>;

      return { applied: true, resource: "invite", resource_id: String(row?.id ?? "") };
    }

    /* Stops it being offered to anyone new. Deliberately not a delete: `people`
       rows point at it, and a parent who was handed the link last week still has
       to be able to walk in — they just arrive without attribution. */
    case "invite.retire": {
      const target = id(b.id);
      await tx.execute(
        sql`update invites set active = false where id = ${target}::uuid`,
      );
      return { applied: true, resource: "invite", resource_id: target };
    }

    case "invite.restore": {
      const target = id(b.id);
      await tx.execute(
        sql`update invites set active = true where id = ${target}::uuid`,
      );
      return { applied: true, resource: "invite", resource_id: target };
    }

    /* ── 2.6 Tap lists ───────────────────────────────────────────────────── */

    /**
     * Invariant 9, resolved: an "other" answer becomes matchable the moment a
     * human says it is a real thing. Three effects, in one transaction.
     *
     *  1. **The option exists.** `market_options` is now read at request time by
     *     `/api/market/options`, so this is what puts the chip in front of the
     *     next parent — no deploy, per spec §8.5.
     *  2. **Everyone who asked for it is answered at once.** Two parents typing
     *     the same club are two pending rows; promoting one and leaving the other
     *     in the queue would ask an admin to make the same judgement twice, and
     *     the second promotion would then be a no-op with a different slug.
     *  3. **Their graph is repaired.** This is the part that was missing: a parked
     *     value writes no affinity, so the parent who typed it never had the edge
     *     everyone tapping the canonical chip got. The row is *re-derived*, not
     *     invented — `raw_answers` still says exactly what they tapped, and the
     *     edge now says what the admin decided it meant.
     */
    case "option.promote": {
      const target = id(b.id);
      const [row] = (await tx.execute(
        sql`select market_id, category, submitted_value from pending_options
            where id = ${target}::uuid limit 1`,
      )) as unknown as Array<Record<string, unknown>>;
      if (!row) return { applied: false, reason: "not_implemented" };

      const market = row.market_id as string;
      const category = row.category as string;
      const submitted = row.submitted_value as string;
      const slug = id(b.option_value);

      await tx.execute(
        sql`insert into market_options (market_id, category, option_value, label)
            values (${market}, ${category}, ${slug},
                    ${text(b.label) ?? submitted})
            on conflict (market_id, category, option_value) do update set active = true`,
      );

      /* The target row whatever its state, plus every *pending* duplicate of the
         same value — case and stray spaces included, because "Audit Club " and
         "audit club" are one club and two typists. */
      const approved = (await tx.execute(
        sql`update pending_options set status = 'approved'
            where id = ${target}::uuid
               or (market_id = ${market} and category = ${category}
                   and status = 'pending'
                   and lower(btrim(submitted_value)) = lower(btrim(${submitted})))
            returning submitted_by`,
      )) as unknown as Array<Record<string, unknown>>;

      const people = [
        ...new Set(
          approved
            .map((r) => r.submitted_by)
            .filter((v): v is string => typeof v === "string"),
        ),
      ];

      /**
       * The backfill. The value written is the admin's **slug**, never the parent's
       * free text — matching keys on the slug, so storing what they typed would
       * recreate the unmatchable state promotion exists to end.
       *
       * `on conflict do nothing`: the primary key is (person, type, value), so
       * promoting twice, or a parent who also tapped the canonical chip later, is
       * a no-op rather than an error.
       *
       * `person_schools` is deliberately *not* written for a promoted school: that
       * table carries a per-school status (current / former, P5) which nobody
       * asked for at capture, and inventing "current" would put a fact in the
       * record that no parent stated.
       */
      const graph = people.length > 0 ? graphTargetForCategory(category) : null;

      /**
       * Built as a Postgres array *literal*, not passed as a JS array: drizzle's
       * `sql` template expands an array into a record list, and `unnest(...)` then
       * fails with "expression is of type record" — the same trap that forced
       * `repo/caregiver.ts` onto the query builder. Every id came from
       * `returning submitted_by` on a uuid column, and is re-checked here anyway,
       * because a literal is a string and a string in SQL is worth checking twice.
       */
      const ids = people.filter((v) =>
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v),
      );
      const idArray = `{${ids.join(",")}}`;

      if (graph && ids.length > 0) {
        if (graph.kind === "affinity") {
          await tx.execute(
            sql`insert into social_affinities (person_id, affinity_type, affinity_value, weight_at_capture)
                select unnest(${idArray}::uuid[]), ${graph.type}, ${slug}, ${graph.weight}
                on conflict do nothing`,
          );
        } else {
          await tx.execute(
            sql`insert into life_relevance (person_id, dimension, value)
                select unnest(${idArray}::uuid[]), ${graph.dimension}, ${slug}
                on conflict do nothing`,
          );
        }
      }

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

    /* ── 2C Caregiver claims ─────────────────────────────────────────────── */

    case "claim.link": {
      const claim = id(b.id);
      const caregiver = id(b.caregiver_id);
      if (!claim || !caregiver) return { applied: false, reason: "not_implemented" };

      /**
       * The one place a caregiver reaches `consented`, and it takes both halves:
       * the caregiver's own yes (the claim, which cannot exist without it) and an
       * admin's judgement that this claim is that nominated person. Neither alone
       * is enough — a self-registration must not become a listing, and an admin
       * must not consent on someone's behalf.
       *
       * Visibility is deliberately **not** raised here. `active`,
       * `discoverable` and `introducible` stay as they are; turning them on is a
       * separate action with its own checks, and the ladder only ever increases.
       */
      await tx.execute(
        sql`
          update caregivers c
          set consent_status = 'consented',
              profile_person_id = cc.person_id,
              consent_evidence = jsonb_build_object(
                'method', 'signed_link',
                'note', 'caregiver registered themselves at /caregiver',
                'at', now()
              ),
              updated_at = now()
          from caregiver_claims cc
          where cc.id = ${claim}::uuid and c.id = ${caregiver}::uuid
        `,
      );

      /** The profile itself, copied across so answering paths read one shape. */
      await tx.execute(
        sql`
          insert into caregiver_profiles (
            caregiver_id, roles_wanted, age_experience, strengths, areas_served,
            drives, days_available, hours_note, rate_band, available_from,
            open_to_reference_intros, updated_at
          )
          select ${caregiver}::uuid, cc.roles_wanted, cc.age_experience, cc.strengths,
                 cc.areas_served, cc.drives, cc.days_available, cc.hours_note,
                 cc.rate_band, cc.available_from, cc.open_to_reference_intros, now()
          from caregiver_claims cc where cc.id = ${claim}::uuid
          on conflict (caregiver_id) do update set
            roles_wanted = excluded.roles_wanted,
            age_experience = excluded.age_experience,
            strengths = excluded.strengths,
            areas_served = excluded.areas_served,
            drives = excluded.drives,
            days_available = excluded.days_available,
            hours_note = excluded.hours_note,
            rate_band = excluded.rate_band,
            available_from = excluded.available_from,
            open_to_reference_intros = excluded.open_to_reference_intros,
            updated_at = now()
        `,
      );

      await tx.execute(
        sql`update caregiver_claims
            set status = 'linked', linked_caregiver_id = ${caregiver}::uuid,
                resolved_at = now(), resolved_by = ${ctx.actor}, updated_at = now()
            where id = ${claim}::uuid`,
      );

      return { applied: true, resource: "caregiver_claim", resource_id: claim };
    }

    case "claim.decline": {
      const claim = id(b.id);
      if (!claim) return { applied: false, reason: "not_implemented" };
      /** Kept and marked, never deleted: the person still asked, and that is a fact. */
      await tx.execute(
        sql`update caregiver_claims
            set status = 'declined', resolved_at = now(), resolved_by = ${ctx.actor},
                updated_at = now()
            where id = ${claim}::uuid`,
      );
      return { applied: true, resource: "caregiver_claim", resource_id: claim };
    }

    /**
     * "Text DELETE and the whole profile goes, without asking why." That sentence
     * is on the last screen of the caregiver flow, so this action has to be a real
     * delete — a status change would leave the row in every table it was in and
     * make the promise false.
     *
     * Scope is exactly what was promised: *their* profile. The claim, the copied
     * profile, and their own consent records go; if the claim had been linked, the
     * caregivers row goes back down the ladder and stops pointing at them. The
     * nominating parent's card stays, because it is the parent's contribution and
     * their sentence about their own experience — and it holds no contact detail
     * for anybody (invariant 13), which is what makes "the whole profile" and
     * "everything Pando has about you as a person" the same thing here.
     *
     * The `people` row is deleted only when nothing else in the app is attached to
     * it. A caregiver who is also a contributing parent keeps their identity and
     * their submissions; the alternative is a delete request from one role wiping
     * the other. The existence checks look past caregiver-scope consents on
     * purpose: the CTE above removes those, and inside one statement they are all
     * still visible, so counting them would mean the row is never removed.
     *
     * One statement, so nothing can half-happen — and the audit row (written by
     * the caller, in the same transaction) is the only trace left.
     */
    case "claim.delete": {
      const claim = id(b.id);
      if (!claim) return { applied: false, reason: "not_implemented" };

      await tx.execute(
        sql`
          with claim as (
            delete from caregiver_claims where id = ${claim}::uuid
            returning person_id, linked_caregiver_id
          ),
          cg as (
            update caregivers c
            set consent_status = 'revoked',
                active = false, discoverable = false, introducible = false,
                profile_person_id = null, updated_at = now()
            from claim
            where c.id = claim.linked_caregiver_id
            returning c.id
          ),
          prof as (
            delete from caregiver_profiles where caregiver_id in (select id from cg)
          ),
          cons as (
            delete from consents
            where person_id in (select person_id from claim)
              and scope like 'caregiver%'
          )
          delete from people p
          where p.id in (select person_id from claim)
            and not exists (select 1 from submissions s where s.person_id = p.id)
            and not exists (select 1 from caregiver_nominations n where n.person_id = p.id)
            and not exists (
              select 1 from consents c
              where c.person_id = p.id and c.scope not like 'caregiver%'
            )
        `,
      );

      return { applied: true, resource: "caregiver_claim", resource_id: claim };
    }

    /* ── D2 Referrals ────────────────────────────────────────────────────── */

    case "referral.link": {
      const referrer = id(b.referrer);
      const referred = id(b.referred);
      if (!referrer || !referred || referrer === referred) {
        return { applied: false, reason: "not_implemented" };
      }
      /**
       * The strategy's "up to three" cap (18 Aug), never enforced before this —
       * `referral.link` would insert an unlimited number of rows for the same
       * referrer. Counted rather than stored as a running total: three rows are
       * cheap to count and can never drift from what actually exists, which a
       * cached counter could. Re-linking the same pair (handled below) must not
       * be blocked by its own cap, so this only counts *other* referreds.
       */
      const [{ count }] = (await tx.execute(
        sql`select count(*)::int as count from referrals
            where referrer_id = ${referrer}::uuid
              and referred_id <> ${referred}::uuid
              and status <> 'void'`,
      )) as unknown as Array<{ count: number }>;
      if (count >= 3) {
        return { applied: false, reason: "referral_cap_reached" };
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

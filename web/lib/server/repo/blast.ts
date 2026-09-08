import { sql } from "drizzle-orm";
import {
  TIERS,
  expiryFor,
  needsHumanReview,
  paymentFor,
  type BlastTier,
} from "@/lib/blast-tiers";
import { SMS_BUDGET } from "@/lib/answer";
import { composeBlastAnswer } from "@/lib/blast-answer";
import { decideOutreach, type OutreachHistory } from "@/lib/outreach-policy";
import { SMS_TEMPLATE_VERSION, askReason, blastRequestSms } from "@/lib/sms-templates";
import { withDb, type Db } from "@/lib/server/db";
import { sendSms } from "@/lib/server/sms";
import { matchesFor } from "@/lib/server/repo/matching";

/**
 * M7.3 — pool selection.
 *
 * The estimate's own order, and it is the right one: **run the matcher, then
 * apply the contributor-protection filters, then choose.** Not the other way
 * round — filtering first would mean scoring people Pando is not allowed to
 * contact, and the ranking would be built out of candidates who then vanish.
 *
 * Three layers, each already built and each doing its own job:
 *
 *  1. `matchesFor` (M6) ranks who has relevant experience.
 *  2. `sms_opt_outs` excludes anyone who asked Pando to stop — **at the query
 *     level**, which is 12.3's own requirement and the same enforcement pattern
 *     as caregiver consent.
 *  3. `decideOutreach` (M8) applies the 48-hour gap, the monthly ceiling and the
 *     response-rate governor, per person.
 *
 * ## Nothing here sends
 *
 * `selectPool` returns who *would* be asked, with the reasons. Sending is 7.8 and
 * goes through `sendSms` like everything else — which re-runs the opt-out check
 * and the protection rules anyway, so this layer being wrong cannot become a text
 * somebody should not have received. Belt and braces, deliberately.
 */

export interface PoolMember {
  person_id: string;
  score: number;
  reasons: Array<{ kind: string; value: string; points: number }>;
}

export interface PoolResult {
  /** Who to ask, best first, already trimmed to the tier's target. */
  chosen: PoolMember[];
  /** Ranked but not asked, with the rule that stopped each one. */
  held: Array<{ person_id: string; score: number; reason: string }>;
  /** What the tier wanted. */
  target: number;
  /** 6.6 — fewer than the tier promised. */
  cold: boolean;
  human_review: { required: boolean; reason?: string };
  configured: boolean;
}

const EMPTY: PoolResult = {
  chosen: [],
  held: [],
  target: 0,
  cold: true,
  human_review: { required: true, reason: "short_pool" },
  configured: false,
};

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export async function selectPool(input: {
  askerId: string;
  tier: BlastTier;
  marketId?: string;
  /** Hard requirements the question demanded (6.5). Rare, and never inferred. */
  mustHave?: Array<{ affinity_type: string; affinity_value: string }>;
}): Promise<PoolResult> {
  const spec = TIERS[input.tier];
  const target = spec.pool_target;

  /* A passive entry contacts nobody. Returning early is not an optimisation: it
     is what stops the demand map from ever building a pool. */
  if (target === 0) {
    return {
      chosen: [],
      held: [],
      target: 0,
      cold: false,
      human_review: { required: false },
      configured: true,
    };
  }

  /**
   * Ask the matcher for more than the tier needs.
   *
   * The protection filters remove people — sometimes most of them, early in a
   * pilot — so a pool sized to the target would arrive short every time somebody
   * had been asked four days ago. Four times the target, capped, is enough
   * headroom without loading the whole graph.
   */
  const ranked = await matchesFor({
    askerId: input.askerId,
    marketId: input.marketId,
    wanted: Math.min(40, target * 4),
    requirements: input.mustHave ? { mustHave: input.mustHave } : undefined,
  });
  if (!ranked.asker) return EMPTY;
  if (ranked.ranked.length === 0) {
    return {
      chosen: [],
      held: [],
      target,
      cold: true,
      human_review: needsHumanReview({
        tier: input.tier,
        matched: 0,
        requirement_count: input.mustHave?.length ?? 0,
      }),
      configured: true,
    };
  }

  const ids = ranked.ranked.map((r) => r.person_id);

  /**
   * One statement for the whole eligibility picture.
   *
   * Opt-out is a `not exists` in the WHERE — excluded at the query level rather
   * than filtered afterwards — while the per-person counters come back as columns
   * for `decideOutreach` to judge. That split is deliberate: suppression is a
   * hard exclusion and belongs in SQL; the protection rules are a policy and
   * belong in the pure module that is exhaustively tested.
   */
  const result = await withDb(async (db: Db) => {
    /* An array literal, not a bound JS array: drizzle expands one into a record
       and `any` then fails — the trap documented in `repo/caregiver.ts`. */
    const literal = `{${ids.map((id) => `"${id}"`).join(",")}}`;
    const rows = (await db.execute(sql`
      select
        p.id,
        p.monthly_contact_allowance,
        p.allowance_mode,
        coalesce(sum(case when m.direction = 'out' and m.category = 'outreach'
                           and m.sent_at > now() - interval '30 days'
                      then 1 else 0 end), 0)::int                      as sent_30,
        coalesce(sum(case when m.direction = 'in' and m.responded_to is not null
                           and m.sent_at > now() - interval '30 days'
                      then 1 else 0 end), 0)::int                      as answered_30,
        max(case when m.direction = 'out' and m.category = 'outreach'
                 then m.sent_at end)                                   as last_outreach,
        coalesce(sum(case when m.direction = 'out' and m.template = 'freshness_ping'
                           and date_trunc('month', m.sent_at)
                             = date_trunc('month', now())
                      then 1 else 0 end), 0)::int                      as pings_month,
        coalesce(bool_or(m.direction = 'out' and m.category = 'outreach'
                     and m.template is distinct from 'freshness_ping'
                     and m.sent_at::date = now()::date), false)        as blast_today
      from people p
      left join message_log m on m.person_id = p.id
      where p.id = any(${literal}::uuid[])
        and not p.is_test
        -- 12.3, at the query level. Somebody who asked Pando to stop is not a
        -- candidate who gets filtered out later; they are never selected.
        and not exists (
          select 1 from sms_opt_outs o
           where o.phone = p.phone
             and o.opted_out_at is not null
             and (o.opted_in_at is null or o.opted_in_at < o.opted_out_at))
      group by p.id, p.monthly_contact_allowance, p.allowance_mode
    `)) as unknown as Array<Record<string, unknown>>;
    return rows;
  });

  if (!result.persisted || !result.data) return EMPTY;

  const eligible = new Map<string, Record<string, unknown>>();
  for (const row of result.data) eligible.set(String(row.id), row);

  const chosen: PoolMember[] = [];
  const held: PoolResult["held"] = [];

  /* In ranked order, so the best match that clears the rules is asked first. */
  for (const candidate of ranked.ranked) {
    if (chosen.length >= target) break;
    const row = eligible.get(candidate.person_id);
    if (!row) {
      held.push({ person_id: candidate.person_id, score: candidate.score, reason: "opted_out_or_test" });
      continue;
    }
    const history: OutreachHistory = {
      sent_last_30_days: Number(row.sent_30 ?? 0),
      responded_last_30_days: Number(row.answered_30 ?? 0),
      last_outreach_at: (row.last_outreach as string | null) ?? null,
      pings_this_month: Number(row.pings_month ?? 0),
      blast_today: row.blast_today === true,
    };
    const verdict = decideOutreach(
      "blast",
      {
        monthly_contact_allowance:
          row.monthly_contact_allowance === null ? null : Number(row.monthly_contact_allowance),
        allowance_mode: row.allowance_mode === "as_relevant" ? "as_relevant" : "fixed",
      },
      history,
    );
    if (verdict.ok) {
      chosen.push({
        person_id: candidate.person_id,
        score: candidate.score,
        reasons: candidate.reasons,
      });
    } else {
      held.push({ person_id: candidate.person_id, score: candidate.score, reason: verdict.reason });
    }
  }

  return {
    chosen,
    held,
    target,
    cold: chosen.length < target,
    human_review: needsHumanReview({
      tier: input.tier,
      matched: chosen.length,
      requirement_count: input.mustHave?.length ?? 0,
    }),
    configured: true,
  };
}

/**
 * M7.1 — create a blast, redeeming a credit if one covers it.
 *
 * The estimate's order: "Checks the parent's credit balance first: if a free
 * credit covers the tier, it's redeemed and the blast activates without payment."
 * Strategy §8 says where a credit comes from — the **first Targeted Ask is
 * free**, a referral earns one (up to three), and §13's grove converts five
 * leaves into another.
 *
 * ## What it decides, and what it deliberately leaves alone
 *
 * It records the question, redeems a credit **in the same transaction as the
 * blast that spends it**, and sets the expiry from the tier. It does not select
 * the pool and it does not send. A blast is created the moment a parent asks;
 * who to ask is a separate decision that may need a human first. Folding them
 * together would mean a question could not be recorded until Pando had worked
 * out whom to bother with it.
 *
 * The neighborhood is read from the asker's own profile, never from the caller —
 * the same rule as the demand signal (11 Aug), and for the same reason: §9 makes
 * that number the market-expansion signal, so a request body does not get a vote.
 */
export async function createBlast(input: {
  askerId: string;
  question: string;
  tier: BlastTier;
  category?: string | null;
  marketId?: string;
  isTest?: boolean;
}): Promise<
  | { ok: true; blast_id: string; credit_redeemed: boolean; expires_at: string | null }
  | { ok: false; reason: "unconfigured" | "unknown_asker" }
> {
  const result = await withDb(async (db: Db) =>
    db.transaction(async (tx) => createBlastIn(tx, input)),
  );

  if (!result.persisted) return { ok: false, reason: "unconfigured" };
  if (!result.data) return { ok: false, reason: "unknown_asker" };
  return { ok: true, ...result.data };
}

/** What 7.1 hands back once the Ask exists. */
export interface CreatedBlast {
  blast_id: string;
  credit_redeemed: boolean;
  expires_at: string | null;
}

/**
 * The body of 7.1, inside a caller's transaction.
 *
 * Extracted so the admin's "record an Ask" action can write the blast and its
 * own audit row in **one** transaction, which is the rule every admin write
 * follows (6 Aug). Copying the insert into `admin-write.ts` was the
 * alternative and is the drift this repo has paid for before: two writers of
 * one fact, and the credit redemption is the half that would quietly stop
 * matching the tier it is meant to cover.
 *
 * Returns null when the asker does not exist, which the caller reports. It does
 * not throw — a bad id is an ordinary answer, not a fault.
 */
export async function createBlastIn(
  tx: Tx,
  input: {
    askerId: string;
    question: string;
    tier: BlastTier;
    category?: string | null;
    marketId?: string;
    isTest?: boolean;
  },
): Promise<CreatedBlast | null> {
  const spec = TIERS[input.tier];
  const marketId = input.marketId ?? "pasadena";
  const expires = expiryFor(input.tier, new Date());

  const asker = (await tx.execute(
    sql`select id from people where id = ${input.askerId}::uuid`,
  )) as unknown as Array<Record<string, unknown>>;
  if (asker.length === 0) return null;

  /**
   * One unspent credit of this tier, locked while we look at it.
   *
   * SKIP LOCKED because two blasts created at once must not redeem the same
   * credit — the second takes the next one, or pays. A balance read followed
   * by an update is exactly that race with extra steps.
   */
  const credit =
    spec.credit_kind !== null
      ? ((await tx.execute(sql`
          select id from credits
           where person_id = ${input.askerId}::uuid
             and kind = ${spec.credit_kind}
             and spent_at is null
           order by created_at
           limit 1
           for update skip locked
        `)) as unknown as Array<Record<string, unknown>>)
      : [];
  const creditId = credit[0]?.id ? String(credit[0].id) : null;

  /**
   * What the money is, said at creation rather than at checkout.
   *
   * The column defaults to `not_required`, and while nothing could create a
   * blast that default was harmless. It is not now: a $15 Targeted Ask with no
   * credit behind it sat there reading *no payment required* until somebody
   * happened to open a checkout for it — on `/admin/payments`, which exists to
   * answer what is owed and to whom.
   *
   * `paymentFor` decides, so the row and `sendBlast`'s refusal cannot
   * disagree: a free tier and a credit-funded Ask are `not_required`, and a
   * priced one with no credit is `pending` from the moment it exists.
   *
   * `price_cents` is deliberately **not** written here. It is frozen at
   * checkout (`drizzle/0029`) because it records what this parent was actually
   * charged, and nobody has been charged yet.
   */
  const payment = paymentFor({ tier: input.tier, creditRedeemed: creditId !== null });

  const rows = (await tx.execute(sql`
    insert into blasts
      (market_id, asker_id, question_text, category, neighborhood, tier,
       status, pool_target, expires_at, human_review, credit_id,
       payment_status, is_test)
    values
      (${marketId}, ${input.askerId}::uuid, ${input.question},
       ${input.category ?? null},
       (select neighborhood from people where id = ${input.askerId}::uuid),
       ${input.tier},
       ${spec.always_human_review ? "pending_review" : "draft"},
       ${spec.pool_target},
       ${expires ? expires.toISOString() : null},
       ${spec.always_human_review}, ${creditId},
       ${payment.status}, ${input.isTest === true})
    returning id, expires_at
  `)) as unknown as Array<Record<string, unknown>>;

  if (creditId) {
    /* Spent in the same transaction as the thing it paid for: a credit marked
       spent against a blast that failed to insert is a balance the parent
       lost to a database error. */
    await tx.execute(sql`update credits set spent_at = now() where id = ${creditId}::uuid`);
  }

  return {
    blast_id: String(rows[0]?.id ?? ""),
    credit_redeemed: creditId !== null,
    expires_at: (rows[0]?.expires_at as string | null) ?? null,
  };
}

export interface SendBlastResult {
  ok: boolean;
  sent: number;
  /** Refused by the protection rules or the opt-out list. Not a failure. */
  skipped: number;
  reason?:
    | "not_found"
    /** 7.11 — a passive entry is the demand map, and contacts nobody. */
    | "contacts_nobody"
    /** Everybody in the pool was refused, or the provider is not configured. */
    | "nobody_reachable"
    /** 13.5 — a paid tier whose checkout has not completed. */
    | "unpaid"
    | "not_ready"
    | "needs_human_review"
    | "already_sent"
    | "unconfigured";
}

/**
 * M7.8 — send the blast.
 *
 * The estimate's own framing is the interesting part: "including the
 * asynchronous reality of reaching people who aren't in a session". Nobody is
 * waiting on a screen. Each text goes out, the recipient row records that it
 * went, and whatever comes back arrives minutes or days later through the inbound
 * webhook — which already links a reply to the blast (7.5) and a PASS to the seat
 * it frees (§6).
 *
 * ## Four rules
 *
 * **A blast that needs a human does not send.** `human_review` is set at creation
 * for Last-Minute Care and by `needsHumanReview` for a short pool or stacked
 * requirements; sending past it would defeat the one check standing between a
 * scorer's mistake and five strangers' phones.
 *
 * **Only successful sends become recipients.** Somebody the protection rules
 * refused was never asked, so a row saying they were would misrepresent the pool
 * — and `attachResponse` keys on `sent_at`, so a phantom recipient could absorb
 * a reply meant for a real one.
 *
 * **A refusal is a skip, not a failure.** A contributor inside their 48-hour gap
 * is the system working. The count is returned so a short delivery is visible.
 *
 * **Nothing here re-implements a rule.** `sendSms` runs opt-out, quiet hours and
 * the whole of invariant 5 again, on top of `selectPool` having already applied
 * them — deliberate belt and braces, because this is the one code path that
 * reaches a stranger's phone unprompted.
 */
export async function sendBlast(blastId: string): Promise<SendBlastResult> {
  const loaded = await withDb(async (db: Db) => {
    const rows = (await db.execute(sql`
      select b.id, b.tier, b.status, b.human_review, b.question_text,
             b.asker_id, b.market_id, b.payment_status, b.credit_id,
             (select count(*)::int from blast_recipients r
               where r.blast_id = b.id and r.sent_at is not null) as already
        from blasts b where b.id = ${blastId}::uuid
    `)) as unknown as Array<Record<string, unknown>>;
    return rows[0] ?? null;
  });

  if (!loaded.persisted) return { ok: false, sent: 0, skipped: 0, reason: "unconfigured" };
  if (!loaded.data) return { ok: false, sent: 0, skipped: 0, reason: "not_found" };

  const blast = loaded.data;
  if (Number(blast.already ?? 0) > 0) {
    return { ok: false, sent: 0, skipped: 0, reason: "already_sent" };
  }
  /**
   * 7.11 — a passive entry contacts nobody, so there is nothing to send.
   *
   * Without this the send ran, found an empty pool, counted zero and marked the
   * Ask `pending_review` — telling an admin that a question doing exactly what
   * its tier promises is waiting for a person. `selectPool` already returns
   * early for `pool_target === 0`; this is the same fact one layer up, before
   * anything is written.
   */
  if (TIERS[String(blast.tier) as BlastTier].pool_target === 0) {
    return { ok: false, sent: 0, skipped: 0, reason: "contacts_nobody" };
  }
  if (blast.human_review === true) {
    return { ok: false, sent: 0, skipped: 0, reason: "needs_human_review" };
  }
  if (blast.status !== "draft" && blast.status !== "active") {
    return { ok: false, sent: 0, skipped: 0, reason: "not_ready" };
  }

  /**
   * 13.5 — a paid tier that has not been paid does not send.
   *
   * This was a real hole the moment payments existed, and it is worth naming
   * because nothing looked wrong: `createBlast` starts a blast at `draft`, and
   * the status check above admits `draft` — deliberately, because a free tier
   * has nothing to pay and must be sendable straight away. So a `targeted` Ask
   * whose checkout was never completed sat in exactly the state `blast.send`
   * accepts, and an admin pressing the button would have texted five parents on
   * behalf of somebody who had not paid.
   *
   * The question is asked of `lib/payments.ts` rather than of the column, so
   * "does this owe anything" has one definition: a free tier and a
   * credit-funded Ask both owe nothing, and the credit was already redeemed
   * inside `createBlast`'s transaction.
   */
  const owed = paymentFor({
    tier: String(blast.tier) as BlastTier,
    creditRedeemed: blast.credit_id !== null,
  });
  if (owed.charge && blast.payment_status !== "paid") {
    return { ok: false, sent: 0, skipped: 0, reason: "unpaid" };
  }
  if (!blast.asker_id) return { ok: false, sent: 0, skipped: 0, reason: "not_ready" };

  const tier = String(blast.tier) as BlastTier;
  const pool = await selectPool({
    askerId: String(blast.asker_id),
    tier,
    marketId: String(blast.market_id ?? "pasadena"),
  });

  /* A pool that came back needing review is the cold-start case, and 6.6's answer
     is to say so rather than send to two people while promising five. */
  if (pool.human_review.required) {
    await withDb(async (db: Db) => {
      await db.execute(sql`
        update blasts set status = 'pending_review', human_review = true
         where id = ${blastId}::uuid
      `);
      return true;
    });
    return { ok: false, sent: 0, skipped: 0, reason: "needs_human_review" };
  }

  const question = String(blast.question_text ?? "").trim();
  let sent = 0;
  let skipped = 0;

  for (const member of pool.chosen) {
    const phone = await phoneFor(member.person_id);
    if (!phone) {
      skipped += 1;
      continue;
    }

    const result = await sendSms({
      to: phone,
      body: blastRequestSms({
        question,
        because: askReason(member.reasons.map((r) => r.kind)),
      }),
      category: "outreach",
      personId: member.person_id,
      outreachKind: "blast",
      template: "blast_request",
      templateVersion: SMS_TEMPLATE_VERSION,
    });

    if (!result.sent) {
      skipped += 1;
      continue;
    }

    /* Recorded only because it went. The score and reasons travel with it so the
       pool can be argued with afterwards, exactly as the 6.7 harness shows it. */
    await withDb(async (db: Db) => {
      await db.execute(sql`
        insert into blast_recipients
          (blast_id, person_id, match_score, match_reasons, sent_at)
        values (${blastId}::uuid, ${member.person_id}::uuid, ${member.score},
                ${JSON.stringify(member.reasons)}::jsonb, now())
        on conflict do nothing
      `);
      return true;
    });
    sent += 1;
  }

  await withDb(async (db: Db) => {
    await db.execute(sql`
      update blasts
         set status = ${sent > 0 ? "active" : "pending_review"},
             human_review = ${sent > 0 ? false : true}
       where id = ${blastId}::uuid
    `);
    return true;
  });

  console.info("[blast] sent", { tier, sent, skipped, wanted: pool.target });
  /* A send that reached nobody is a refusal with a name, not a bare `ok: false`.
     Without one the admin was told the row had changed, when what happened is
     that every parent was inside a protection rule — or, far more often on a
     fresh deployment, that no messaging provider is configured at all. The row
     is still marked for review above: nought sent is something a person should
     look at. */
  if (sent === 0) return { ok: false, sent, skipped, reason: "nobody_reachable" };
  return { ok: true, sent, skipped };
}

/* ── M7's exit ─────────────────────────────────────────────────────────── */

export type DeliverReason =
  | "not_found"
  | "already_sent"
  | "nothing_approved"
  | "no_phone"
  | "not_sent";

export interface DeliverResult {
  ok: boolean;
  /** How many approved replies the message carried. */
  used?: number;
  /** Approved replies that did not fit the budget. */
  dropped?: number;
  reason?: DeliverReason;
}

/**
 * Send the approved replies back to the parent who asked.
 *
 * ⚠ **This is the end of the chain M7 did not have.** Reviewed end to end on
 * 7 Sep: `blast.create` starts an Ask, `sendBlast` asks the pool,
 * `attachResponse` catches the replies, `blast_response.approve` writes them
 * into the graph — and **nothing addressed the asker**. A parent could pay $15,
 * five parents could answer, an admin could approve every one, and the person
 * who asked would hear nothing. The only outbound path to a parent was
 * `answer.send`, whose rows come from the *inbound* pipeline and know nothing
 * about blasts.
 *
 * ## Five refusals, each with its own name
 *
 * `sendBlast` already learned this lesson the expensive way: it distinguished
 * six outcomes and the action collapsed them all to `not_found`, so an admin
 * pressing a button was told the row had changed. Each of these means something
 * different and something different should be done about it.
 *
 * `already_sent` is the one that earns the column (`drizzle/0037`). Without it a
 * second press would text the asker their answers twice, and there would be
 * nothing on the page to say the first press had worked — 14.2's gold card for
 * "approved but not sent", one surface along.
 *
 * ## What it will not do
 *
 * **It does not approve anything.** Only replies an admin has already marked
 * `approved` are read, which is what makes forwarding free text safe at all
 * (invariant 8: never published verbatim *without human review*). A blast whose
 * replies are all unread refuses with `nothing_approved` rather than sending the
 * best of them.
 *
 * **It does not mark the Ask fulfilled.** That is `blast.fulfil`, a judgement
 * with a note, and this is a carrier round trip that can fail and be retried —
 * the same split as `answer.approve` and `answer.send` (14.2), for the same
 * reason: one button would make a failed send look like an un-made decision.
 *
 * **The row is stamped only when the send actually went.** A row saying
 * delivered for a message the carrier refused is `persisted: true` on a failed
 * write, and here it would also hide the commonest refusal, which is an asker
 * who has since texted STOP.
 *
 * ⚠ **`transactional`, not `outreach`, and that is deliberate rather than
 * convenient.** Quiet hours exist so a phone does not buzz at midnight with
 * something nobody asked for; this is the answer to a question the asker paid
 * for and is waiting on, which is what the exemption is for (12.1: "direct
 * replies in a live conversation are exempt"). It also means the asker's own
 * monthly allowance is not spent on it — that ceiling is about how often Pando
 * *asks* them things, and this is them being answered.
 */
export async function deliverBlastAnswers(blastId: string): Promise<DeliverResult> {
  const loaded = await withDb(async (db: Db) => {
    const rows = (await db.execute(sql`
      select b.answers_sent_at, p.phone, p.id::text as asker_id
        from blasts b
        left join people p on p.id = b.asker_id
       where b.id = ${blastId}::uuid
    `)) as unknown as Array<Record<string, unknown>>;
    if (rows.length === 0) return null;
    const replies = (await db.execute(sql`
      select br.response_text, br.quality
        from blast_recipients br
       where br.blast_id = ${blastId}::uuid
         and br.review_status = 'approved'
         and br.response_text is not null
       order by br.responded_at asc
    `)) as unknown as Array<Record<string, unknown>>;
    return { blast: rows[0], replies };
  });

  /* An unreachable database is not "no such blast": refusing to send is the
     safe direction here, and the admin can press it again. */
  if (!loaded.persisted || !loaded.data) return { ok: false, reason: "not_found" };
  const { blast, replies } = loaded.data;

  if (blast.answers_sent_at) return { ok: false, reason: "already_sent" };
  const phone = blast.phone ? String(blast.phone) : null;
  const askerId = blast.asker_id ? String(blast.asker_id) : null;
  if (!phone || !askerId) return { ok: false, reason: "no_phone" };

  const composed = composeBlastAnswer({
    /* One budget for everything Pando sends. Passed rather than imported by the
       composer — see its own note on why that keeps it node-testable. */
    budget: SMS_BUDGET,
    replies: replies.map((r) => ({
      text: String(r.response_text ?? ""),
      quality:
        r.quality === null || r.quality === undefined ? null : Number(r.quality),
    })),
  });
  if (!composed) return { ok: false, reason: "nothing_approved" };

  const result = await sendSms({
    to: phone,
    body: composed.text,
    category: "transactional",
    personId: askerId,
    template: "blast_answers",
    templateVersion: SMS_TEMPLATE_VERSION,
  });
  if (!result.sent) return { ok: false, reason: "not_sent" };

  await withDb(async (db: Db) => {
    await db.execute(sql`
      update blasts set answers_sent_at = now() where id = ${blastId}::uuid
    `);
    return true;
  });

  /* Counts only (invariant 7): never the question, never a reply. `dropped`
     is the one worth watching — approved answers a parent paid for and did not
     receive, which is a budget decision somebody may want to revisit. */
  console.info("[blast] answers delivered", {
    used: composed.used,
    dropped: composed.dropped,
  });
  return { ok: true, used: composed.used, dropped: composed.dropped };
}

async function phoneFor(personId: string): Promise<string | null> {
  const result = await withDb(async (db: Db) => {
    const rows = (await db.execute(sql`
      select phone from people where id = ${personId}::uuid
    `)) as unknown as Array<Record<string, unknown>>;
    return rows[0]?.phone ? String(rows[0].phone) : null;
  });
  return result.persisted ? (result.data ?? null) : null;
}

/**
 * The blast a reply belongs to: the most recent one this person was asked and has
 * neither answered nor passed.
 *
 * SMS carries no thread id, so this is the only honest attribution — and it is
 * the same approximation `recordInbound` makes for the governor, kept identical
 * on purpose so the two cannot disagree about which question was answered.
 */
const OPEN_FOR_SENDER = sql`
  select b.blast_id from blast_recipients b
   where b.person_id = p.id
     and b.sent_at is not null
     and b.responded_at is null
     and b.passed_at is null
   order by b.sent_at desc
   limit 1`;

/**
 * M7.5 — attach an inbound reply to the blast it answers.
 *
 * The webhook already links a reply to the outbound message it responds to, which
 * is what the response-rate governor counts. This is the other half: putting the
 * words somewhere a human can read them.
 *
 * It touches only a recipient who has **not already answered**. A second message
 * is a follow-up, not a second answer, and overwriting would lose what they said
 * first. The text lands as `pending_review` because it is free text that may name
 * a person (invariant 8) — nothing publishes it until an admin has read it.
 */
export async function attachResponse(input: {
  phone: string;
  text: string;
}): Promise<{ attached: boolean }> {
  const result = await withDb(async (db: Db) => {
    const rows = (await db.execute(sql`
      update blast_recipients br
         set responded_at = now(),
             response_text = ${input.text.slice(0, 2000)}
        from people p
       where p.phone = ${input.phone}
         and br.person_id = p.id
         and br.sent_at is not null
         and br.responded_at is null
         and br.passed_at is null
         and br.blast_id = (${OPEN_FOR_SENDER})
      returning br.blast_id
    `)) as unknown as Array<Record<string, unknown>>;
    return rows.length > 0;
  });
  return { attached: result.persisted === true && result.data === true };
}

/**
 * M7.5 / strategy §6 — PASS.
 *
 * "The question moves to someone else immediately, with no follow-up, no penalty,
 * and nothing recorded against you."
 *
 * So this marks the seat free and does nothing else: no note, no counter, no
 * flag. The **immediately** half is what `passed_at` buys — a pool top-up can see
 * the seat is open without waiting for the window to expire. And the *no penalty*
 * half lives in `recordInbound`, which links a PASS to the outreach it answers so
 * the governor counts it as a response rather than as silence.
 */
export async function recordPass(input: { phone: string }): Promise<{ passed: boolean }> {
  const result = await withDb(async (db: Db) => {
    const rows = (await db.execute(sql`
      update blast_recipients br
         set passed_at = now()
        from people p
       where p.phone = ${input.phone}
         and br.person_id = p.id
         and br.sent_at is not null
         and br.responded_at is null
         and br.passed_at is null
         and br.blast_id = (${OPEN_FOR_SENDER})
      returning br.blast_id
    `)) as unknown as Array<Record<string, unknown>>;
    return rows.length > 0;
  });
  return { passed: result.persisted === true && result.data === true };
}

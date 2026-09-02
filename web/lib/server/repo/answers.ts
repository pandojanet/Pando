import { sql } from "drizzle-orm";
import { withDb, type Db } from "@/lib/server/db";
import { sendSms } from "@/lib/server/sms";

/**
 * M14.2 / 5.8 — the answer queue.
 *
 * `composeAnswer` builds an answer; `routeAnswer` decides whether a person reads
 * it first; this is where it waits and how it leaves.
 *
 * ## The rule the whole table exists for
 *
 * **The text that is sent is the text that was read.** `answer_text` is stored
 * when the answer is queued and sent verbatim on approval — never recomposed.
 * Recomposing at send time would mean the records could have moved in between (a
 * contribution approved, a record gone stale) and the parent would receive
 * something nobody looked at. If the stored text is out of date the answer is
 * rejected and a new one composed, which is a decision rather than a drift.
 *
 * ## Sending still goes through the one send layer
 *
 * Approval does not bypass anything: `sendSms` re-runs opt-out, quiet hours and
 * the contributor-protection rules. An admin approving an answer for somebody who
 * texted STOP an hour ago is refused by the same code that refuses everything
 * else, and the row records that it was not sent.
 */

export interface QueuedAnswer {
  personId: string | null;
  phone: string;
  question: string;
  answerText: string;
  nextStep: "none" | "offer_blast" | "human_review";
  labels: string[];
  publicOnly: boolean;
  holdReason: string;
  marketId?: string;
  isTest?: boolean;
}

/** Put a composed answer in the queue. Returns its id, or null with no database. */
export async function queueAnswer(input: QueuedAnswer): Promise<string | null> {
  const result = await withDb(async (db: Db) => {
    /* An array literal rather than a bound JS array — the trap documented in
       `repo/caregiver.ts` and `option.promote`. */
    const labels = `{${input.labels.map((l) => `"${l.replace(/"/g, '\\"')}"`).join(",")}}`;
    const rows = (await db.execute(sql`
      insert into answers
        (market_id, person_id, phone, question_text, answer_text, next_step,
         labels, public_only, hold_reason, is_test)
      values
        (${input.marketId ?? "pasadena"},
         ${input.personId ? sql`${input.personId}::uuid` : sql`null`},
         ${input.phone}, ${input.question}, ${input.answerText}, ${input.nextStep},
         ${labels}::text[], ${input.publicOnly}, ${input.holdReason},
         ${input.isTest === true})
      returning id
    `)) as unknown as Array<Record<string, unknown>>;
    return String(rows[0]?.id ?? "");
  });
  return result.persisted && result.data ? result.data : null;
}

export type SendVerdict =
  | { sent: true; message_id?: string }
  | { sent: false; reason: string };

/**
 * Approve one answer and send it.
 *
 * The status moves to `sent` **only when the send layer says it went**. A row
 * marked sent for a message the carrier refused is the same class of lie as
 * `persisted: true` for a write that failed — and here it would also hide a
 * suppression bug, because the commonest refusal is somebody who opted out.
 */
export async function approveAndSend(input: {
  id: string;
  actor: string;
}): Promise<SendVerdict> {
  const loaded = await withDb(async (db: Db) => {
    const rows = (await db.execute(sql`
      select id, phone, answer_text, person_id, status
        from answers
       where id = ${input.id}::uuid
    `)) as unknown as Array<Record<string, unknown>>;
    return rows[0] ?? null;
  });
  if (!loaded.persisted || !loaded.data) return { sent: false, reason: "not_found" };

  const row = loaded.data;
  if (row.status === "sent") return { sent: false, reason: "already_sent" };

  /**
   * Through the single layer, like everything else.
   *
   * `transactional` because this is a reply to a question the parent asked, which
   * is also why quiet hours do not apply — they govern `outreach` only. **No
   * `inReplyTo`:** that field is a `message_log` id, and passing an answer id
   * there would write a `responded_to` row pointing at nothing. Opt-out is still
   * checked; that one has no exemptions at all.
   */
  const result = await sendSms({
    to: String(row.phone),
    body: String(row.answer_text),
    category: "transactional",
    personId: row.person_id ? String(row.person_id) : undefined,
    template: "answer",
  });

  await withDb(async (db: Db) => {
    await db.execute(sql`
      update answers
         set status = ${result.sent ? "sent" : "approved"},
             reviewed_by = ${input.actor},
             reviewed_at = now(),
             sent_at = ${result.sent ? sql`now()` : sql`null`}
       where id = ${input.id}::uuid
    `);
    return true;
  });

  return result.sent
    ? { sent: true, message_id: result.message_id }
    : { sent: false, reason: result.reason ?? "provider_error" };
}

/** Reject one. Nothing is sent, and the text is kept as the record of what was refused. */
export async function rejectAnswer(input: {
  id: string;
  actor: string;
}): Promise<boolean> {
  const result = await withDb(async (db: Db) => {
    await db.execute(sql`
      update answers
         set status = 'rejected', reviewed_by = ${input.actor}, reviewed_at = now()
       where id = ${input.id}::uuid and status = 'pending_review'
    `);
    return true;
  });
  return result.persisted === true;
}

/**
 * Edit before sending.
 *
 * Deliberately a separate action from approving, and the text is replaced rather
 * than patched: an admin who rewrites an answer is taking responsibility for the
 * new sentence, and a diff-style patch would leave it unclear which words were
 * Pando's claim and which were theirs.
 *
 * **The labels are not editable.** They are the product's claim about where the
 * answer came from, and an admin who disagrees with a label disagrees with the
 * records — which is a fix in the contributions queue, not a rewrite here.
 */
export async function editAnswer(input: {
  id: string;
  text: string;
  actor: string;
}): Promise<boolean> {
  const result = await withDb(async (db: Db) => {
    await db.execute(sql`
      update answers
         set answer_text = ${input.text.slice(0, 2000)},
             reviewed_by = ${input.actor}
       where id = ${input.id}::uuid and status = 'pending_review'
    `);
    return true;
  });
  return result.persisted === true;
}

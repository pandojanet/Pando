import { sql } from "drizzle-orm";
import { flagNamedPersonRecord } from "@/lib/server/repo/flags";
import { withDb, type Db } from "@/lib/server/db";
import { cardFrom, nextStep, type CaptureStep } from "@/lib/capture";

/**
 * M10.1 — the state behind an SMS capture, and the write that ends it.
 *
 * `lib/capture.ts` is the script and the parsing; this is where a half-finished
 * card lives between two texts that may be a day apart, and what it becomes.
 */

export interface OpenCapture {
  capture_id: string;
  person_id: string;
  step: CaptureStep;
  answers: Record<string, unknown>;
}

/**
 * The capture this message is an answer to.
 *
 * At most one per person, enforced by a partial unique index rather than by a
 * check here: two open captures would make the next reply ambiguous, which is
 * the same failure the one-question-at-a-time rule exists to prevent, and a
 * constraint is the only version of that rule a future caller cannot forget.
 */
export async function openCapture(personId: string): Promise<OpenCapture | null> {
  const result = await withDb(async (db: Db) => {
    const rows = (await db.execute(sql`
      select id::text as capture_id, step, answers
        from sms_captures
       where person_id = ${personId}::uuid and status = 'open'
       limit 1
    `)) as unknown as Array<Record<string, unknown>>;
    const row = rows[0];
    if (!row || typeof row.step !== "string") return null;
    return {
      capture_id: String(row.capture_id),
      person_id: personId,
      step: row.step as CaptureStep,
      answers: (row.answers ?? {}) as Record<string, unknown>,
    };
  });
  return result.persisted ? (result.data ?? null) : null;
}

/**
 * Is this number mid-capture? Asked **before** a person is ensured.
 *
 * It exists for one collision. `SKIP` is a PASS keyword (the effortless exit,
 * strategy §6) **and** the word the capture's own last question tells a parent
 * to reply with — "anything another parent should know? Reply with a sentence,
 * or SKIP." The keyword block runs first, so a parent following the instruction
 * on screen had their answer read as a decline to somebody else's question, the
 * card was never saved, and PASS is deliberately silent: they got nothing back.
 *
 * Resolved the way this pipeline resolves every ambiguous word — **the records
 * decide, and the more recently asked question wins** (the 1 Sep tie-break for a
 * bare "yes"). A capture is a conversation Pando is holding right now, one text
 * ago; a blast is a question asked to five people at once. So an open capture
 * takes the word.
 *
 * Keyed by phone rather than by person because it is consulted above
 * `ensureInboundPerson`, and running that first would mean creating a person in
 * order to decide whether a stranger's PASS is a PASS.
 */
export async function openCaptureStep(phone: string): Promise<CaptureStep | null> {
  const result = await withDb(async (db: Db) => {
    const rows = (await db.execute(sql`
      select c.step
        from sms_captures c
        join people p on p.id = c.person_id
       where p.phone = ${phone} and c.status = 'open'
       limit 1
    `)) as unknown as Array<Record<string, unknown>>;
    const step = rows[0]?.step;
    return typeof step === "string" ? (step as CaptureStep) : null;
  });
  /* Unreachable database is "no capture": the capture branch below cannot run
     either, so treating the word as a PASS at least keeps the effortless exit
     working rather than dropping the message on the floor. */
  return result.persisted ? (result.data ?? null) : null;
}

/**
 * Start one, or hand back the one already running.
 *
 * A parent who texts ADD twice is not asking for a second card — they are more
 * likely to have forgotten they were mid-capture, or the first reply never
 * arrived. Resuming is the answer that loses nothing; starting again would
 * throw away what they had already typed.
 */
export async function startCapture(
  personId: string,
  isTest = false,
): Promise<OpenCapture | null> {
  const existing = await openCapture(personId);
  if (existing) return existing;

  const first = nextStep({});
  if (!first) return null;

  const result = await withDb(async (db: Db) => {
    const rows = (await db.execute(sql`
      insert into sms_captures (person_id, step, is_test)
      values (${personId}::uuid, ${first}, ${isTest})
      on conflict do nothing
      returning id::text as capture_id
    `)) as unknown as Array<Record<string, unknown>>;
    return rows[0] ? String(rows[0].capture_id) : null;
  });

  if (!result.persisted || !result.data) return null;
  return { capture_id: result.data, person_id: personId, step: first, answers: {} };
}

/**
 * Record one answer and move on.
 *
 * The step is written together with the answer, so the row can never say it is
 * waiting for a question it has already been told the answer to. When the last
 * answer lands the step goes null and the status leaves `open` — which the
 * `sms_captures_step_check` constraint requires, and which is what stops a
 * finished capture from swallowing the parent's next unrelated message.
 */
export async function saveAnswer(
  capture: OpenCapture,
  value: string | null,
): Promise<{ next: CaptureStep | null; answers: Record<string, unknown> } | null> {
  /* A skipped step is stored as null rather than left absent: absent means "not
     asked yet" to `nextStep`, so an omitted key would ask the same question
     again forever. Skipping is an answer. */
  const answers = { ...capture.answers, [capture.step]: value };
  const next = nextStep(answers);

  const result = await withDb(async (db: Db) => {
    await db.execute(sql`
      update sms_captures
         set answers = ${JSON.stringify(answers)}::jsonb,
             step = ${next},
             status = ${next ? "open" : "saved"},
             updated_at = now()
       where id = ${capture.capture_id}::uuid
    `);
    return true;
  });

  if (!result.persisted) return null;
  return { next, answers };
}

export async function cancelCapture(captureId: string): Promise<void> {
  await withDb(async (db: Db) => {
    await db.execute(sql`
      update sms_captures
         set status = 'abandoned', step = null, updated_at = now()
       where id = ${captureId}::uuid
    `);
    return true;
  });
}

/**
 * The finished capture, written into the ordinary tables.
 *
 * **Three things are not taken from the parent's texts**, and each is the same
 * rule stated somewhere else in this codebase:
 *
 *  - the **neighborhood** is read from their profile, because the graph is
 *    derived on the server and never taken from a request body (11 Aug);
 *  - the **status** is `pending_review` on both rows, because a contribution
 *    enters the graph only after approval (the client's answer of 27 Aug), and
 *    an SMS path must not be the one exception that lets unread text into an
 *    answer;
 *  - `provenance` is `parent_submitted`, which is true and is what invariant 4
 *    requires before any trust label can be attached.
 *
 * Both rows in one transaction: a share with no contribution behind it is a
 * record nothing can ever say anything about, and it would sit in the review
 * queue looking like an empty mistake.
 */
export async function saveCapturedCard(
  capture: OpenCapture,
  answers: Record<string, unknown>,
): Promise<{ share_id: string; name: string } | null> {
  const card = cardFrom(answers);
  if (!card) return null;

  const result = await withDb(async (db: Db) =>
    db.transaction(async (tx) => {
      const created = (await tx.execute(sql`
        insert into shares (market_id, kind, name, neighborhoods, status, provenance)
        select coalesce(p.market_id, 'pasadena'), ${card.kind}::share_kind, ${card.name},
               case when p.neighborhood is null then null
                    else array[p.neighborhood] end,
               'pending_review', 'parent_submitted'
          from people p
         where p.id = ${capture.person_id}::uuid
        returning id::text as share_id
      `)) as unknown as Array<Record<string, unknown>>;

      const shareId = created[0] ? String(created[0].share_id) : "";
      if (!shareId) return null;

      /**
       * 11.4 — belt, behind the braces.
       *
       * `handleInboundMessage` already refuses a *strongly* person-shaped name
       * over SMS ("Ms. Diane") and sends the caregiver link instead. This
       * catches the weak shape it deliberately does not refuse on — "Diane
       * Kovalenko" — so an admin is asked the caregiver questions before the
       * record can be answered with. Never throws; the card saving is the
       * important half.
       */
      await flagNamedPersonRecord(tx, {
        shareId,
        name: card.name,
        personId: capture.person_id,
      });

      await tx.execute(sql`
        insert into share_contributions
          (share_id, person_id, firsthand, recommendation, what_makes_it_great, status)
        values (${shareId}::uuid, ${capture.person_id}::uuid, ${card.firsthand},
                ${card.recommendation}, ${card.detail}, 'pending_review')
      `);

      await tx.execute(sql`
        update sms_captures set share_id = ${shareId}::uuid, updated_at = now()
         where id = ${capture.capture_id}::uuid
      `);

      return { share_id: shareId, name: card.name };
    }),
  );

  return result.persisted ? (result.data ?? null) : null;
}

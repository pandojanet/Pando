import "server-only";

import { sql } from "drizzle-orm";
import { withDb, type Db } from "@/lib/server/db";
import { CONTEXT_WINDOW, type PendingQuestion } from "@/lib/pending-question";
import { writeFlagIfNew } from "@/lib/server/repo/flags";

/**
 * The turns of a question Pando could not read yet (`drizzle/0035`).
 *
 * Four rules, and each has cost something somewhere else in this codebase.
 *
 * **An unreachable database means no context, never a crash.** Every function
 * here degrades to "there is nothing pending", which produces the old behaviour
 * — one message read on its own — rather than failing the inbound path. That is
 * the opposite of `repo/outreach.ts`, which refuses when it cannot check: there
 * the question is *may we contact this person*, and here it is only *have they
 * written before*.
 *
 * **The window is bounded on write.** `turns` is capped by a CHECK at six, so an
 * append that would overflow drops the oldest instead of failing the insert — a
 * constraint violation here would take down the reply to a parent mid-exchange.
 *
 * **A stale row is not context.** A parent texting the next morning is starting
 * over, not continuing; `EXPIRY_HOURS` is what makes "the question so far" mean
 * something a person would recognise.
 *
 * **It closes on success as well as on failure.** The commonest way a state
 * table goes wrong is that nothing clears it — `sms_captures` needed a CHECK to
 * stop a finished capture swallowing later messages, and this needs the same
 * discipline from the caller.
 */

/** After this, the next message is a new question rather than a continuation. */
const EXPIRY_HOURS = 12;

/** The open question for this person, if there is a live one. */
export async function openQuestion(
  personId: string,
): Promise<PendingQuestion | null> {
  const result = await withDb(async (db: Db) => {
    const rows = (await db.execute(sql`
      select id, turns, asks
        from pending_questions
       where person_id = ${personId}::uuid
         and status = 'open'
         and updated_at > now() - (${EXPIRY_HOURS} || ' hours')::interval
       limit 1
    `)) as unknown as Array<Record<string, unknown>>;
    const row = rows[0];
    if (!row) return null;
    return {
      id: String(row.id),
      turns: Array.isArray(row.turns) ? (row.turns as string[]) : [],
      asks: Number(row.asks ?? 0),
    };
  });
  return result.persisted ? (result.data ?? null) : null;
}

/**
 * Remember this turn, and count the ask that follows it.
 *
 * One statement, whether it opens the exchange or continues it: an insert whose
 * conflict target is the partial unique index, so two messages arriving together
 * cannot produce two open rows. The window is trimmed in the same expression
 * rather than read-modify-written, which is what keeps that true.
 */
export async function rememberTurn(input: {
  personId: string;
  text: string;
  isTest?: boolean;
}): Promise<void> {
  await withDb(async (db: Db) => {
    await db.execute(sql`
      insert into pending_questions (person_id, turns, asks, is_test)
      values (${input.personId}::uuid, array[${input.text}]::text[], 1,
              ${input.isTest === true})
      on conflict (person_id) where status = 'open'
      do update set
        /* Oldest first, and never past the CHECK: the tail is taken so an
           overflowing exchange loses its beginning rather than its insert. */
        turns = (
          array_append(pending_questions.turns, ${input.text})
        )[greatest(1, array_length(pending_questions.turns, 1) + 2 - ${CONTEXT_WINDOW * 2}):],
        asks = pending_questions.asks + 1,
        updated_at = now()
    `);
    return true;
  });
}

/**
 * The question was read, or Pando gave up on reading it.
 *
 * `resolved` and `given_up` are kept apart because they are different facts
 * about the same row: one is an exchange that worked and the other is one that
 * ended with a person. A single `closed` would make "how often does this
 * actually help" unanswerable from the table it happens in.
 */
export async function closeQuestion(
  id: string,
  outcome: "resolved" | "given_up",
): Promise<void> {
  await withDb(async (db: Db) => {
    await db.execute(sql`
      update pending_questions
         set status = ${outcome}, updated_at = now()
       where id = ${id}::uuid and status = 'open'
    `);
    return true;
  });
}

/**
 * Pando asked twice, could not read it, and said a person would look.
 *
 * ⚠ **This exists because that sentence was otherwise a promise nothing kept.**
 * `handingOver()` tells the parent "somebody at Pando will read it and come back
 * to you", and until this the exchange simply closed as `given_up` in a table no
 * admin surface reads — the same fault this file keeps recording, made by the
 * copy rather than by the code.
 *
 * `escalation`, not `review`: 10 Aug reserves the alert badge for what is owed a
 * person **today**, and a parent who has been told to expect a reply is exactly
 * that. It is also the only class of flag here where the delay is visible from
 * the outside — a contribution waiting in a queue inconveniences nobody.
 *
 * The subject is the **person**, not the row: what needs answering is somebody's
 * question, and `pending_questions` is not a resource any admin page opens.
 * `excerpt` carries the words so the queue can be worked without one, and that
 * is allowed for the same reason `answers.question_text` is — the invariant is
 * about logs, and a person cannot answer a question they cannot read.
 */
export async function flagUnreadable(input: {
  personId: string;
  text: string;
}): Promise<void> {
  await withDb(async (db: Db) => {
    await writeFlagIfNew(db, {
      severity: "escalation",
      reason: "unreadable_question",
      subject_kind: "person",
      subject_id: input.personId,
      person_id: input.personId,
      excerpt: input.text.slice(0, 500),
    });
    return true;
  });
}

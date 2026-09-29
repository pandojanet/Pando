import { sql } from "drizzle-orm";
import { withDb, type Db } from "@/lib/server/db";
import { baseQuestion, withMoreSuffix } from "@/lib/more-options";

/**
 * What Pando last told this number, so "any others?" has something to be about
 * (29 Sep).
 *
 * `message_log` holds no message bodies (invariant 7 at the schema), so the only
 * record of what a parent was sent is the `answers` row - which stores the
 * question and the text on purpose, because the admin has to read what was
 * asked and the parent has to be sent what was read.
 *
 * ## Only what was actually sent
 *
 * `status = 'sent'`. An answer still waiting for a person was never seen by the
 * parent, so "any others?" cannot be a follow-up to it - it falls through to the
 * ordinary path, and the person reading the queue sees both messages.
 *
 * ## Bounded, like every open question here (14 Sep)
 *
 * A follow-up belongs to the conversation it follows. Past the window, "any
 * others?" is a message about nothing, and answering an old question a week
 * later is worse than asking what they mean.
 *
 * ## Everything in that conversation, not only the last answer
 *
 * A second "any others?" must not offer what the first one already gave, so
 * every answer sent for the *same question* inside the window is returned, and
 * the caller excludes all of them.
 */
const FOLLOW_UP_WINDOW_HOURS = 72;

export interface PriorAnswers {
  /** The question the last answer was for - what "more" is more of. */
  question: string;
  /** What the parent has already read, in full. */
  texts: string[];
  /** The `shares` rows those answers were built from. */
  shareIds: string[];
}

export async function priorAnswersFor(phone: string): Promise<PriorAnswers | null> {
  const result = await withDb(async (db: Db) => {
    const latest = (await db.execute(sql`
      select question_text
        from answers
       where phone = ${phone}
         and status = 'sent'
         and not is_test
         and sent_at > now() - (${FOLLOW_UP_WINDOW_HOURS} || ' hours')::interval
       order by sent_at desc
       limit 1
    `)) as unknown as Array<Record<string, unknown>>;
    const stored = latest[0]?.question_text;
    if (typeof stored !== "string" || stored.trim() === "") return null;
    /* A follow-up is stored with a suffix (see `MORE_SUFFIX`); "more" is more of
       the question itself, and everything sent for it counts as already read. */
    const question = baseQuestion(stored);
    const asFollowUp = withMoreSuffix(question);

    const rows = (await db.execute(sql`
      select answer_text, share_ids::text[] as share_ids
        from answers
       where phone = ${phone}
         and status = 'sent'
         and not is_test
         and question_text in (${question}, ${asFollowUp})
         and sent_at > now() - (${FOLLOW_UP_WINDOW_HOURS} || ' hours')::interval
       order by sent_at desc
       limit 10
    `)) as unknown as Array<Record<string, unknown>>;

    const ids = new Set<string>();
    const texts: string[] = [];
    for (const row of rows) {
      if (typeof row.answer_text === "string") texts.push(row.answer_text);
      /* Through `db.execute` an array normally arrives parsed, and a driver
         that hands back the literal instead must not silently lose the ids. */
      const arr = row.share_ids;
      const list = Array.isArray(arr)
        ? arr
        : typeof arr === "string"
          ? arr.replace(/^\{|\}$/g, "").split(",").filter(Boolean)
          : [];
      for (const id of list) ids.add(String(id));
    }
    return { question, texts, shareIds: [...ids] } satisfies PriorAnswers;
  });
  return result.persisted ? (result.data ?? null) : null;
}

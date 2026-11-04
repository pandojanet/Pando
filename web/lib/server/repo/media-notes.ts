import { sql } from "drizzle-orm";
import { MEDIA_PENDING_HOURS, type MediaKind } from "@/lib/media-note";
import { withDb, type Db } from "@/lib/server/db";

/**
 * `media_notes` (drizzle/0063): what Pando made of a voice note or a picture,
 * waiting for "is that right?".
 *
 * Every way a read-back ends — yes, no, a typed message instead, a newer voice
 * note or picture, or a day of silence — clears the words and the media URL in
 * the same statement and hands the URL back, so the caller deletes the media at
 * Twilio (`deleteTwilioMedia`). Nothing here logs the words (invariant 7).
 */

export type MediaNoteEnd = "confirmed" | "rejected" | "superseded" | "expired";

export interface PendingMediaNote {
  id: string;
  kind: MediaKind;
  text: string;
}

/** Ends what is still pending for this person — all of it, or only what is older than the window. */
async function endPending(db: Db, personId: string, status: MediaNoteEnd, onlyStale = false): Promise<string[]> {
  const rows = (await db.execute(sql`
    with ended as (
      select id, media_url from media_notes
       where person_id = ${personId}::uuid and status = 'pending'
         ${onlyStale ? sql`and created_at < now() - make_interval(hours => ${MEDIA_PENDING_HOURS})` : sql``}
         for update
    )
    update media_notes m
       set status = ${status}, text = null, media_url = null, resolved_at = now()
      from ended
     where m.id = ended.id
    returning ended.media_url
  `)) as unknown as Array<Record<string, unknown>>;
  return rows.map((r) => r.media_url).filter((u): u is string => typeof u === "string");
}

/**
 * A new read-back. An older one still waiting is superseded first — the next
 * message answers the newest — and its media URLs come back for deletion.
 */
export async function createMediaNote(input: {
  personId: string;
  kind: MediaKind;
  text: string;
  mediaUrl: string;
  durationSec: number | null;
  confidence: number | null;
}): Promise<{ id: string; superseded: string[] } | null> {
  const result = await withDb(async (db: Db) =>
    db.transaction(async (tx) => {
      const superseded = await endPending(tx as unknown as Db, input.personId, "superseded");
      const rows = (await tx.execute(sql`
        insert into media_notes (person_id, kind, text, media_url, duration_sec, confidence, is_test)
        select ${input.personId}::uuid, ${input.kind}, ${input.text.slice(0, 8000)}, ${input.mediaUrl},
               ${input.durationSec}, ${input.confidence}, p.is_test
          from people p where p.id = ${input.personId}::uuid
        returning id
      `)) as unknown as Array<Record<string, unknown>>;
      return rows[0]?.id ? { id: String(rows[0].id), superseded } : null;
    }),
  );
  return result.persisted && result.data ? result.data : null;
}

/**
 * The read-back this person's message may be answering. One older than
 * `MEDIA_PENDING_HOURS` is ended as expired on the way, so its words and media
 * do not outlive the window; its URL comes back in `expired` for deletion.
 */
export async function pendingMediaNote(
  personId: string,
): Promise<{ note: PendingMediaNote | null; expired: string[] }> {
  const result = await withDb(async (db: Db) => {
    const expired = await endPending(db, personId, "expired", true);
    const rows = (await db.execute(sql`
      select id, kind, text from media_notes
       where person_id = ${personId}::uuid and status = 'pending'
       limit 1
    `)) as unknown as Array<Record<string, unknown>>;
    const row = rows[0];
    return {
      note: row ? { id: String(row.id), kind: row.kind as MediaKind, text: String(row.text) } : null,
      expired,
    };
  });
  return result.persisted && result.data ? result.data : { note: null, expired: [] };
}

/** Ends a read-back the person answered; the media URL to delete, if any. */
export async function endMediaNote(personId: string, status: MediaNoteEnd): Promise<string[]> {
  const result = await withDb((db: Db) => endPending(db, personId, status));
  return result.persisted && result.data ? result.data : [];
}

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
 * Read-backs nobody answered, for anyone (review, 4 Nov): the expiry ran only
 * on that person's next text, so a note never answered kept its words and its
 * media at Twilio for good. And every read-back of a number that sent DELETE,
 * before the person and the note's row go with it. The media URLs to delete.
 */
export async function endMediaNotesWhere(scope: { stale: true } | { phone: string }): Promise<string[]> {
  const result = await withDb(async (db: Db) => {
    const rows = (await db.execute(sql`
      with ended as (
        select n.id, n.media_url from media_notes n
         where n.status = 'pending'
           ${"stale" in scope
             ? sql`and n.created_at < now() - make_interval(hours => ${MEDIA_PENDING_HOURS})`
             : sql`and n.person_id in (select id from people where phone = ${scope.phone})`}
           for update
      )
      update media_notes m
         set status = ${"stale" in scope ? "expired" : "superseded"}, text = null, media_url = null, resolved_at = now()
        from ended
       where m.id = ended.id
      returning ended.media_url
    `)) as unknown as Array<Record<string, unknown>>;
    return rows.map((r) => r.media_url).filter((u): u is string => typeof u === "string");
  });
  return result.persisted && result.data ? result.data : [];
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

/**
 * The words of a waiting read-back, corrected by the person's reply (4 Nov):
 * it stays pending, with its media, for them to confirm the new reading — that
 * note and no other (a newer one that arrived meanwhile is left alone), and
 * its day to answer starts again, since a new reading was just sent.
 */
export async function reviseMediaNote(personId: string, noteId: string, text: string): Promise<boolean> {
  const result = await withDb(async (db: Db) => {
    const rows = (await db.execute(sql`
      update media_notes set text = ${text}, created_at = now()
       where id = ${noteId}::uuid and person_id = ${personId}::uuid and status = 'pending'
       returning id
    `)) as unknown as Array<Record<string, unknown>>;
    return rows.length > 0;
  });
  return result.persisted && result.data === true;
}

/** Ends a read-back the person answered; the media URL to delete, if any. */
export async function endMediaNote(personId: string, status: MediaNoteEnd): Promise<string[]> {
  const result = await withDb((db: Db) => endPending(db, personId, status));
  return result.persisted && result.data ? result.data : [];
}

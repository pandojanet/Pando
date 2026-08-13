import "server-only";

import { sql } from "drizzle-orm";
import type { Db } from "@/lib/server/db";
import { extractCard, isExtractionConfigured } from "@/lib/server/extract";

/**
 * Estimate 1.9 — the annotation and flagging layer, plus the trigger for 1.8.
 *
 * A flag is a request for a human's attention, so the rules here are about
 * *what a person needs to look at*, not about what the model thinks. Two
 * properties matter more than the rule list:
 *
 *  - **Writes are idempotent.** A card can be corrected and re-saved, and the
 *    sweep re-runs over cards the inline pass missed. Without a dedupe key the
 *    same concern would pile up until the queue is noise and nobody reads it.
 *  - **Nothing here blocks the parent.** Extraction is a network call to
 *    another API; making a parent's "save" wait on it would trade their flow
 *    for our metadata. It runs after the response, and the sweep catches
 *    whatever the process didn't finish.
 */

export type FlagSeverity = "escalation" | "review" | "note";

export interface FlagInput {
  severity: FlagSeverity;
  reason: string;
  subject_kind: string;
  subject_id: string;
  field?: string | null;
  excerpt?: string | null;
  confidence?: number | null;
  person_id?: string | null;
}

/**
 * One open flag per (reason, subject). Resolving a flag and then hitting the
 * same rule again *does* raise a new one — that is deliberate: a concern that
 * recurs after a human cleared it is new information, not a duplicate.
 */
export async function writeFlagIfNew(
  db: Db,
  flag: FlagInput,
): Promise<{ created: boolean }> {
  const rows = (await db.execute(
    sql`
      insert into flags (severity, reason, subject_kind, subject_id, field,
                         excerpt, confidence, person_id)
      select ${flag.severity}, ${flag.reason}, ${flag.subject_kind},
             ${flag.subject_id}::uuid, ${flag.field ?? null},
             ${flag.excerpt ?? null}, ${flag.confidence ?? null},
             ${flag.person_id ?? null}::uuid
      where not exists (
        select 1 from flags f
        where f.reason = ${flag.reason}
          and f.subject_id = ${flag.subject_id}::uuid
          and f.status = 'open'
      )
      returning id
    `,
  )) as unknown as unknown[];

  return { created: rows.length > 0 };
}

/**
 * Runs 1.8 over one contribution and applies the 1.9 rules to the result.
 *
 * Deliberately returns rather than throws: every caller is either a
 * fire-and-forget or a sweep, and neither should surface an extraction problem
 * to a parent or fail a batch over one bad row.
 */
export async function extractAndFlag(
  db: Db,
  contributionId: string,
): Promise<{ scored: boolean; flags: string[] }> {
  const flags: string[] = [];

  const [row] = (await db.execute(
    sql`
      select pc.id, pc.person_id, pc.what_makes_it_great, pc.caveat, pc.tip_text,
             pc.who_for, pc.who_not_for, pc.last_there, pc.is_test,
             pc.price_band, pc.price_unit, pc.worth_it, pc.how_much,
             pc.recommendation, pc.child_age_at_time,
             pl.name as place_name, pl.kind, pl.freshness_state
      from share_contributions pc
      join shares pl on pl.id = pc.share_id
      where pc.id = ${contributionId}::uuid
      limit 1
    `,
  )) as unknown as Array<Record<string, unknown>>;

  if (!row) return { scored: false, flags };
  /* Test rows are walkthroughs, not contributions. Flagging them would put our
     own QA passes in the queue Janet reads. */
  if (row.is_test === true) return { scored: false, flags };

  /**
   * Freshness at capture, which needs no model. A parent saying "we went over
   * a year ago" is the single most useful thing to know about a
   * recommendation, and it is knowable the moment they tap it.
   */
  if (row.last_there === "over_year") {
    const { created } = await writeFlagIfNew(db, {
      severity: "note",
      reason: "stale_at_capture",
      subject_kind: "share_contribution",
      subject_id: contributionId,
      field: "last_there",
      person_id: (row.person_id as string | null) ?? null,
    });
    if (created) flags.push("stale_at_capture");
  }

  if (!isExtractionConfigured()) return { scored: false, flags };

  const result = await extractCard({
    kind: row.kind as "activity" | "place" | "tip",
    place_name: (row.place_name as string) ?? "",
    what_makes_it_great: (row.what_makes_it_great as string | null) ?? null,
    caveat: (row.caveat as string | null) ?? null,
    tip_text: (row.tip_text as string | null) ?? null,
    who_for: (row.who_for as string | null) ?? null,
    who_not_for: (row.who_not_for as string | null) ?? null,
    /* The taps, so a complete card is not marked down for a price that lives in
       another column. See `ExtractionInput.captured`. */
    captured: {
      price_band: (row.price_band as string | null) ?? null,
      price_unit: (row.price_unit as string | null) ?? null,
      worth_it: (row.worth_it as string | null) ?? null,
      last_there: (row.last_there as string | null) ?? null,
      how_much: (row.how_much as string | null) ?? null,
      recommendation: (row.recommendation as string | null) ?? null,
      child_ages: (row.child_age_at_time as number[] | null) ?? null,
    },
  });

  if (!result) return { scored: false, flags };

  await db.execute(
    sql`update share_contributions set confidence = ${result.confidence}
        where id = ${contributionId}::uuid`,
  );

  /**
   * Invariant 8: free text about a named person never gets published without a
   * human reading it. The flag carries the model's *reason*, never the
   * parent's sentence — the sentence stays where it was written and is read on
   * the admin surface, not copied into a queue row.
   */
  if (result.possible_named_person) {
    const { created } = await writeFlagIfNew(db, {
      severity: "review",
      reason: "possible_named_person",
      subject_kind: "share_contribution",
      subject_id: contributionId,
      excerpt: result.note,
      confidence: result.confidence,
      person_id: (row.person_id as string | null) ?? null,
    });
    if (created) flags.push("possible_named_person");
  }

  /**
   * The threshold matches the admin's "Low confidence" filter exactly
   * (`confidence < 0.6` in the contributions page). One number, two places —
   * if they drift, the queue and the flag disagree about the same card.
   */
  if (result.confidence < 0.6) {
    const { created } = await writeFlagIfNew(db, {
      severity: "note",
      reason: "low_confidence",
      subject_kind: "share_contribution",
      subject_id: contributionId,
      excerpt: result.note,
      confidence: result.confidence,
      person_id: (row.person_id as string | null) ?? null,
    });
    if (created) flags.push("low_confidence");
  }

  return { scored: true, flags };
}

/**
 * Fire-and-forget. The parent's response has already been sent; this runs on
 * the same process afterwards and its failure is invisible to them by design.
 *
 * It is not a guarantee — a redeploy mid-flight drops it — which is exactly
 * why `sweepExtraction` exists rather than this being the only path.
 */
export function scheduleExtraction(db: Db, contributionId: string): void {
  void extractAndFlag(db, contributionId).catch((err) => {
    console.error(
      "[flags] background extraction failed:",
      err instanceof Error ? err.constructor.name : "unknown",
    );
  });
}

/**
 * The catch-up pass: everything still unscored, oldest first. This is what
 * makes the inline attempt safe to lose — and what backfills the whole table
 * the first time an API key is set.
 */
export async function sweepExtraction(
  db: Db,
  limit = 25,
): Promise<{ processed: number; scored: number; flags: number }> {
  if (!isExtractionConfigured()) {
    return { processed: 0, scored: 0, flags: 0 };
  }

  const pending = (await db.execute(
    sql`
      select pc.id
      from share_contributions pc
      where pc.confidence is null
        and not pc.is_test
        and (pc.what_makes_it_great is not null
             or pc.caveat is not null
             or pc.tip_text is not null)
      order by pc.created_at
      limit ${limit}
    `,
  )) as unknown as Array<{ id: string }>;

  let scored = 0;
  let flags = 0;
  for (const row of pending) {
    const result = await extractAndFlag(db, row.id);
    if (result.scored) scored += 1;
    flags += result.flags.length;
  }

  return { processed: pending.length, scored, flags };
}

import { assessColumns, type Quality } from "../contribution-quality";
import type { ContributionRow } from "./types";

/**
 * A contribution's one status, from the row the admin already holds (5 Oct).
 *
 * Computed on the page rather than sent: every input is a column of the row, so
 * the sample rows, the queue and the contributor page all read one rule
 * (`lib/contribution-quality.ts`) with nothing to keep in step on the server.
 */
export function qualityOf(row: ContributionRow): Quality {
  return assessColumns({
    kind: row.kind,
    firsthand: row.firsthand,
    name: row.share.name,
    child_age_at_time: row.child_age_at_time,
    last_there: row.last_there,
    what_makes_it_great: row.what_makes_it_great,
    caveat_answered: row.caveat_answered,
    tip_text: row.tip_text,
  });
}

/**
 * Whether this card counts toward Founding: it has been **added to Pando**
 * (approved by an admin) **and** it qualifies. The two are separate on purpose —
 * a useful partial comment can stay in Pando without earning anybody Founding.
 */
export function countsTowardFounding(row: ContributionRow): boolean {
  return !row.is_test && row.status === "approved" && qualityOf(row).status === "qualifies";
}

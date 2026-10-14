/**
 * The "a parent just recommended…" line on `/join` (14 Oct, the client's join
 * mockup: *"populate from the API with real, de-identified contributions —
 * town + category + relative time only, never names, never the venue. Leave
 * empty to hide."*).
 *
 * The pure half: what one recent contribution may say about itself. The query
 * is `lib/server/repo/recent-activity.ts`, and only these three facts ever
 * leave it — never the record, its name or the parent.
 *
 * ## What keeps it de-identified, beyond leaving names out
 *
 *  - **The category is coarse.** The sub-category's plural noun ("a class",
 *    "a doctor"), never the parent's words — "a swim teacher" in the mockup is
 *    more than the card stores as a category, and a free-text description could
 *    name the venue.
 *  - **The town is shown only where enough verified parents live**
 *    (`MIN_TOWN_PARENTS`): "A Bradbury parent recommended a pediatrician
 *    yesterday" could point at one family. Below the floor it is "a local parent".
 *  - **The time is a bucket**, never a clock: "today", "yesterday", "this week".
 *  - **A caregiver card never appears** — a nomination is about a named person
 *    and is sensitive by invariant 12's spirit even as a category.
 */

export interface RecentRow {
  created_at: string | Date;
  kind: string;
  subcategory: string | null;
  /** The parent's own town, as its curated label — null when they gave none. */
  town: string | null;
  /** How many verified parents share that town. */
  town_parents: number;
}

/** A town is named only when at least this many verified parents live there. */
export const MIN_TOWN_PARENTS = 3;

/** How far back the line reaches; older than this and the line is hidden. */
export const RECENT_DAYS = 30;

/** The sub-category as a parent would say it, with its article. */
const BY_SUBCATEGORY: Record<string, string> = {
  activities: "an activity",
  classes: "a class",
  camps: "a camp",
  places: "a place to go",
  restaurants: "a restaurant",
  schools: "a school",
  doctors: "a doctor",
  specialists: "a specialist",
  parties: "a party vendor",
  tips: "a tip",
  products: "a product",
};

/** A card the classifier could not place, by its button. */
const BY_KIND: Record<string, string> = {
  activity: "an activity",
  place: "a place to go",
  doctor: "a specialist",
  tip: "a tip",
};

export function categoryPhrase(kind: string, subcategory: string | null): string | null {
  if (kind === "caregiver") return null;
  return (subcategory && BY_SUBCATEGORY[subcategory]) || BY_KIND[kind] || null;
}

/** "in the last hour", "today", "yesterday", "this week", "this month" — or null past `RECENT_DAYS`. */
export function relativeWhen(createdAt: string | Date, now: Date): string | null {
  const at = new Date(createdAt);
  const ms = now.getTime() - at.getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  const hours = ms / 3_600_000;
  if (hours < 1) return "in the last hour";
  if (hours < 24 && at.getDate() === now.getDate()) return "today";
  if (hours < 48) return "yesterday";
  if (hours < 24 * 7) return "this week";
  if (hours < 24 * RECENT_DAYS) return "this month";
  return null;
}

/** One line, or null when the row may not be said at all. */
export function activityLine(row: RecentRow, now: Date): string | null {
  const category = categoryPhrase(row.kind, row.subcategory);
  const when = relativeWhen(row.created_at, now);
  if (!category || !when) return null;
  const town = row.town && row.town_parents >= MIN_TOWN_PARENTS ? row.town : null;
  const who = town ? `${/^[aeiou]/i.test(town) ? "An" : "A"} ${town} parent` : "A local parent";
  /* "just" only while it is true — a recommendation from last week was not. */
  const verb = when === "in the last hour" || when === "today" ? "just recommended" : "recommended";
  /* A no-break space before the dot, so a wrapped line never ends on it. */
  return `${who} ${verb} ${category} · ${when}`;
}

/** The lines for the page: newest first, each said once, at most `max`. */
export function activityLines(rows: readonly RecentRow[], now: Date, max = 6): string[] {
  const out: string[] = [];
  for (const row of rows) {
    const line = activityLine(row, now);
    if (line && !out.includes(line)) out.push(line);
    if (out.length >= max) break;
  }
  return out;
}

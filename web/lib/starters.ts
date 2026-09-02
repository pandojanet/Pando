import type { Option } from "./types";

/**
 * Which curated starters a question offers as taps.
 *
 * Pure, and free of runtime imports, so `npm run test:starters` can load it in
 * plain node. It lived inside `SearchableChipGroup` as a `useMemo` until 1 Sep,
 * and **the client has now reported a fault in it twice**:
 *
 *  - *27 Aug* — the area comparison was against a display name, so nine of
 *    seventeen areas silently never matched and a La Cañada parent was shown
 *    twelve schools in alphabetical order, none in their own city.
 *  - *1 Sep* — five of her seventeen approved towns were never offered on the
 *    neighborhood question, and the list re-ordered and shrank the moment a
 *    parent tapped one.
 *
 * Both are the same shape of bug: typecheck clean, tests green, feature wrong,
 * and only visible to somebody looking at the screen. A rule that decides what
 * a parent is *able to see* deserves to be exhaustively testable, for the same
 * reason `matching.ts` and `outreach-policy.ts` are.
 */

/**
 * How many taps a question offers before the search box has to carry the rest.
 *
 * Her own instruction on the four directory sheets is "about 8-12 familiar
 * choices". This is the ceiling; `AREA_FLOOR` is the floor.
 */
export const STARTER_LIMIT = 12;

/**
 * The fewest a screen may show before it tops up from other areas.
 *
 * Schools are curated eight per area, but the others are not: baby activities
 * run from eleven starters in Pasadena down to **two** in Altadena, and clubs
 * to zero. Filtered flat those screens would be a two-chip list next to a
 * search box, which reads as "Pando knows nothing here".
 */
export const AREA_FLOOR = 8;

export interface StarterInput {
  /** Every curated starter the endpoint returned for this market. */
  options: Option[];
  /** The parent's neighborhood **id**, never its display name. */
  area?: string | null;
  /** Ids already chosen. Never dropped, whichever branch runs. */
  selected: string[];
  /**
   * Offer every starter, unfiltered, uncapped and in its given order.
   *
   * **True for the question that establishes the area**, and only for it. The
   * area logic is circular there — it filters the list of towns by the town you
   * just picked — and applying it anyway is what produced both halves of the
   * 1 Sep report. See `visibleStarters` for the arithmetic.
   */
  wholeList?: boolean;
}

/**
 * The starters to render, in order, with refusals last.
 *
 * `exclusive` options ("Homeschool", "None", "Prefer not to say") are the
 * question's own furniture rather than records about the market, so they are
 * never ranked, filtered or capped, and they always come after the records —
 * where a refusal reads as belonging to the whole question.
 */
export function visibleStarters(input: StarterInput): Option[] {
  const home = (input.area ?? "").trim();
  const chosen = new Set(input.selected);

  const special = input.options.filter((o) => o.exclusive);
  const records = input.options.filter((o) => !o.exclusive);

  /**
   * The whole curated set, untouched.
   *
   * **Nothing is reordered on selection**, which is item 2's second half: *"Do
   * not display Pasadena twice as both a list option and a separate selected
   * chip. The original list option should simply show its selected state."*
   * There is no second chip in the markup — `rank` below pins a selected option
   * to position 0, so tapping Pasadena lifted it out of the alphabet and above
   * Alhambra, and *that* is what read as a chip sitting apart from the list.
   *
   * Pinning exists only so a selection survives the slice. Nothing is sliced
   * here, so nothing needs pinning.
   */
  if (input.wholeList) return [...records, ...special];

  /* On the slug, never on `area` — that is the display name, and comparing it
     to a neighborhood id matched single-word names only (27 Aug). */
  const isHome = (o: Option) => home !== "" && o.area_slug === home;

  /* How many starters each area contributes, so the top-up can prefer the areas
     a family in a thin one would actually travel to. */
  const perArea = new Map<string, number>();
  for (const o of records) {
    const key = o.area_slug ?? "";
    perArea.set(key, (perArea.get(key) ?? 0) + 1);
  }

  const rank = (a: Option, b: Option) => {
    /**
     * **A selection is not pinned to the front** (1 Sep, item 5).
     *
     * It used to be, so that it survived the slice — and the visible effect was
     * the one she reported on both the town list and the circles page:
     * *"Selected affiliations should appear only once rather than being
     * duplicated above and inside the list."* There is only ever one chip; it
     * had been lifted out of its place in the list and put at the top, which on
     * a wrapped grid reads as a second chip sitting above the others.
     *
     * The guarantee it existed for is kept without it. `ownArea` below admits
     * anything `chosen`, and the belt at the end re-appends a selection that
     * the slice still dropped — so a chip can move to the *end* of a long list
     * but can never disappear, and it never jumps to the front.
     */
    const aHome = isHome(a) ? 0 : 1;
    const bHome = isHome(b) ? 0 : 1;
    if (aHome !== bHome) return aHome - bHome;

    /* Bigger areas first among the fill — Pasadena before Alhambra. */
    const size =
      (perArea.get(b.area_slug ?? "") ?? 0) - (perArea.get(a.area_slug ?? "") ?? 0);
    if (aHome === 1 && size !== 0) return size;

    return a.label.localeCompare(b.label);
  };

  const ranked = [...records].sort(rank);
  const ownArea = ranked.filter((o) => isHome(o) || chosen.has(o.id));

  /* Own area alone when it carries enough; otherwise top up to the floor. */
  const kept =
    home === ""
      ? ranked.slice(0, STARTER_LIMIT)
      : ownArea.length >= AREA_FLOOR
        ? ownArea.slice(0, STARTER_LIMIT)
        : [
            ...ownArea,
            ...ranked
              .filter((o) => !ownArea.includes(o))
              .slice(0, AREA_FLOOR - ownArea.length),
          ];

  /* Belt: a selection must never be dropped, whichever branch ran. A chip that
     vanished because the parent later changed their neighborhood would leave a
     stored answer with nothing on screen representing it. */
  for (const o of ranked) {
    if (chosen.has(o.id) && !kept.includes(o)) kept.push(o);
  }
  return [...kept, ...special];
}

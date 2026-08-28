/**
 * Canonical previous places → the coarse tenure signal (item 11, 24 Aug).
 *
 * The client's instruction: *"Pando can derive 'elsewhere in California,'
 * 'another state' or 'another country' from the actual location. The parent
 * shouldn't have to provide both."* So the old "where did you move from?"
 * question is gone and this computes its answer from the city the parent named.
 *
 * ## Why the id carries the geography, in its prefix
 *
 * This has to work without a database. `deriveLifeRelevance` is pure and runs on
 * the server over answers it has already sanitised, with no access to the options
 * table — that is the 11 Aug decision that the matching graph is derived from the
 * answers and never taken from the request, and it is what stops a crafted body
 * asserting a tenure signal. So the classification has to be readable from the id
 * itself: `us-san-francisco-ca`, `intl-london-uk`.
 *
 * **It read the id's *suffix* first, and `scripts/seed-places.mjs`'s own check
 * refused the batch.** Country codes collide with US state codes across the
 * board — DE is Germany and Delaware, IN India and Indiana, IL Israel and
 * Illinois, MA Morocco and Massachusetts, AR Argentina and Arkansas, ID Indonesia
 * and Idaho, CA Canada and California, CO Colombia and Colorado. Twelve of the
 * seeded cities would have filed a Berlin family as living in another US state,
 * and nothing in the code would have looked wrong. The ambiguity is in the
 * vocabulary, so no amount of special-casing fixes it — hence a prefix we own.
 *
 * Its own module rather than a function inside `derive.ts` for two reasons: it is
 * a different concern (place ids, not the affinity graph), and `derive.ts` pulls
 * in `./consent` with an extensionless import that Node's own ESM loader cannot
 * resolve — so a unit test could not reach this while it lived there.
 */

/** The 50 states plus DC, as the two-letter codes a `us-` id ends with. */
const US_STATES = new Set([
  "al", "ak", "az", "ar", "ca", "co", "ct", "de", "dc", "fl", "ga", "hi", "id",
  "il", "in", "ia", "ks", "ky", "la", "me", "md", "ma", "mi", "mn", "ms", "mo",
  "mt", "ne", "nv", "nh", "nj", "nm", "ny", "nc", "nd", "oh", "ok", "or", "pa",
  "ri", "sc", "sd", "tn", "tx", "ut", "vt", "va", "wa", "wv", "wi", "wy",
]);

/**
 * The coarse tenure values these places imply, de-duplicated.
 *
 * A parent who lived in three Californian cities produces **one**
 * `elsewhere_in_california` row, not three: the value is a fact about their
 * experience, and repeating it would weight it three times in matching.
 */
export function movedFromPlaces(places: string[]): string[] {
  const out = new Set<string>();

  for (const place of places) {
    const id = place.toLowerCase();

    if (id.startsWith("intl-")) {
      out.add("another_country");
      continue;
    }

    if (id.startsWith("us-")) {
      const state = id.slice(id.lastIndexOf("-") + 1);
      /* Only California is separated out; the rest of the union is one signal,
         because "another state" is what the matching actually cares about. An id
         whose state code is not real cannot be classified — the seed script
         refuses to write one, and this is the belt behind that. */
      if (state === "ca") out.add("elsewhere_in_california");
      else if (US_STATES.has(state)) out.add("another_us_state");
      continue;
    }

    /* No prefix: a place the parent typed themselves, which sits in
       `pending_options` until an admin gives it a canonical id. It contributes
       nothing until then rather than being guessed at — the same rule invariant 9
       applies to every other "other" answer. */
  }

  return [...out];
}

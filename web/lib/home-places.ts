/**
 * Where a parent lives: the SGV place list, and the ZIP codes that reach it.
 *
 * The client's §5 of 9 Sep, verbatim in scope: *"SGVCOG member footprint, plus
 * West Covina and the major unincorporated communities parents actually name as
 * home."* Fifty-two places, each carrying the residential ZIPs that serve it.
 *
 * ## What this replaces, and what it deliberately does not
 *
 * `market_options.neighborhoods` holds **79** values today, and they are two
 * different kinds of thing wearing one label: thirty-odd *cities* and thirteen
 * *districts of Pasadena* (Bungalow Heaven, Linda Vista, San Rafael…), plus
 * eighteen places outside the footprint entirely. This module is the **city**
 * layer and nothing else — the developer's call when the two were put side by
 * side: *"райони залиш, то стосується міст"*.
 *
 * ⚠ So the districts stay exactly as they are, and that is load-bearing rather
 * than lenient: **ten of the twenty neighborhood values real contributors are
 * stored under are Pasadena districts.** Retiring them would have stranded half
 * the live cohort's answers to the one question §8.5 makes required. They
 * already roll up through `area_slug` (9 Sep), so a district resolves to its
 * city and the city is what carries the ZIPs — one join, no migration, and the
 * finer answer is kept rather than flattened.
 *
 * ## A ZIP names a place only sometimes, which is the whole design
 *
 * The estimate's own sketch of this reads *"91106 → Pasadena"*, and that works
 * for Pasadena and fails for a third of the footprint. Measured against her own
 * table: **91702** is Azusa, Irwindale *and* Citrus; **91746** is four places;
 * **91744** is four; **91016** is three; **91789** is three. Her instruction
 * points the other way — *"If the place has multiple residential ZIPs, follow
 * with one short question: Which ZIP code?"* — and both directions are real, so
 * the resolution has to be many-to-many and honest about it:
 *
 * - typing a **name** gives a place, then a ZIP question when it has several;
 * - typing a **ZIP** gives the places it serves, then a choice when there are
 *   several — which is also her *"don't make users pick from duplicate city
 *   rows upfront"*, since the rows only appear once a ZIP has narrowed them.
 *
 * Nothing here guesses. A ZIP serving three places returns three.
 *
 * ## An unknown ZIP is a supported answer
 *
 * `isSupportedZip` says whether Pando is live there, and it is **not** a gate.
 * The client changed her mind about this on the call and the reversal is the
 * point: a parent outside the footprint completes the whole profile, and only
 * at the end is told Pando is not live in their area. What that buys is the
 * schools, activities and children of a place Pando might open next, plus the
 * demand number that says which place that should be. Blocking at the ZIP field
 * would throw all of it away to save somebody four minutes.
 *
 * ## Pure, with no runtime imports
 *
 * The same property `matching.ts`, `payments.ts` and `starters.ts` keep, for the
 * same reason: the required location question is answered before anything is
 * stored, the answer decides which market a parent is in, and a rule that
 * decides that must be testable exhaustively in plain node.
 */

/**
 * Her three, verbatim from the storage note: *"place_type (incorporated city /
 * unincorporated community / LA neighborhood)"*.
 *
 * ⚠ **"Adjacent" is deliberately not one of them.** The first cut made it a
 * fourth type and that was wrong on her own vocabulary: of the five western
 * places, Eagle Rock and Highland Park are LA neighborhoods, Glendale is an
 * incorporated city and La Crescenta and Montrose are unincorporated. Being
 * outside the footprint is a fact about *scope*, which is why it is a separate
 * flag — one axis says what a place is, the other whether we serve it, and
 * collapsing them would have made `place_type` unable to answer either.
 */
export type PlaceType = "city" | "unincorporated" | "la_neighborhood";

export interface Place {
  /** Canonical id. Matches the existing `market_options` slug wherever one exists. */
  id: string;
  name: string;
  type: PlaceType;
  /**
   * West of the SGVCOG footprint. ⚠ Her note on these five: *"keep only if we
   * intentionally serve them"* — a decision she has not taken, so they are
   * served and marked rather than dropped. One live contributor is already
   * stored under Eagle Rock, and dropping a place somebody chose is the
   * expensive half of guessing wrong. Withdrawing them later is this flag.
   */
  adjacent?: true;
  /**
   * Residential and mixed-delivery ZIPs only — no PO-box-only or organisation
   * codes, per her own scoping note. Order is hers.
   */
  zips: string[];
  /**
   * ⚠ City of Industry only. Her table: *"shared; low value as a residential
   * choice"* — it has about a dozen residents and three ZIPs it shares with its
   * neighbours, so it is reachable by name and never offered as a suggestion.
   */
  deprioritised?: true;
  /**
   * The city this place's families actually share a life with, for **matching
   * only** — it becomes `market_options.area_slug`.
   *
   * Set exactly where a community shares its ZIP with a larger neighbour, and
   * the reasoning is the 9 Sep district roll-up arriving at the unincorporated
   * layer: without it a Valinda parent would be their own area of one and match
   * nobody, which is the fault that left fourteen of thirty-nine contributors
   * on an island. Sharing a ZIP is the strongest available evidence that two
   * families use the same schools, shops and Saturdays.
   *
   * ⚠ Absent where the community is large enough to be its own world —
   * Altadena, Hacienda Heights and Rowland Heights each have tens of thousands
   * of residents, and folding them into a neighbour would be the opposite
   * mistake: a parent matched on a place they do not live in.
   *
   * ⚠ It never widens a ZIP. `placesForZip` is untouched by this, because
   * *where somebody lives* and *who they match* are different questions and
   * the demand number §5 produces must answer the first one exactly.
   */
  rollsUpTo?: string;
}

/** Her table, in her order: incorporated cities, then unincorporated, then adjacent. */
export const PLACES: readonly Place[] = [
  { id: "alhambra", name: "Alhambra", type: "city", zips: ["91801", "91803"] },
  { id: "arcadia", name: "Arcadia", type: "city", zips: ["91006", "91007"] },
  { id: "azusa", name: "Azusa", type: "city", zips: ["91702"] },
  { id: "baldwin-park", name: "Baldwin Park", type: "city", zips: ["91706"] },
  { id: "bradbury", name: "Bradbury", type: "city", zips: ["91008", "91010"] },
  { id: "claremont", name: "Claremont", type: "city", zips: ["91711"] },
  { id: "covina", name: "Covina", type: "city", zips: ["91722", "91723", "91724"] },
  { id: "diamond-bar", name: "Diamond Bar", type: "city", zips: ["91765", "91789"] },
  { id: "duarte", name: "Duarte", type: "city", zips: ["91010"] },
  { id: "el-monte", name: "El Monte", type: "city", zips: ["91731", "91732", "91733"] },
  { id: "glendora", name: "Glendora", type: "city", zips: ["91740", "91741"] },
  {
    id: "industry",
    name: "City of Industry",
    type: "city",
    zips: ["91744", "91748", "91789"],
    deprioritised: true,
  },
  { id: "irwindale", name: "Irwindale", type: "city", zips: ["91702", "91706"] },
  { id: "la-canada-flintridge", name: "La Cañada Flintridge", type: "city", zips: ["91011"] },
  { id: "la-puente", name: "La Puente", type: "city", zips: ["91744", "91746"] },
  { id: "la-verne", name: "La Verne", type: "city", zips: ["91750"] },
  { id: "monrovia", name: "Monrovia", type: "city", zips: ["91016"] },
  { id: "montebello", name: "Montebello", type: "city", zips: ["90640"] },
  { id: "monterey-park", name: "Monterey Park", type: "city", zips: ["91754", "91755"] },
  {
    id: "pasadena",
    name: "Pasadena",
    type: "city",
    zips: ["91101", "91103", "91104", "91105", "91106", "91107"],
  },
  { id: "pomona", name: "Pomona", type: "city", zips: ["91766", "91767", "91768"] },
  { id: "rosemead", name: "Rosemead", type: "city", zips: ["91770"] },
  { id: "san-dimas", name: "San Dimas", type: "city", zips: ["91773"] },
  { id: "san-gabriel", name: "San Gabriel", type: "city", zips: ["91775", "91776"] },
  { id: "san-marino", name: "San Marino", type: "city", zips: ["91108"] },
  { id: "sierra-madre", name: "Sierra Madre", type: "city", zips: ["91024"] },
  { id: "south-el-monte", name: "South El Monte", type: "city", zips: ["91733"] },
  { id: "south-pasadena", name: "South Pasadena", type: "city", zips: ["91030"] },
  { id: "temple-city", name: "Temple City", type: "city", zips: ["91780"] },
  { id: "walnut", name: "Walnut", type: "city", zips: ["91789"] },
  { id: "west-covina", name: "West Covina", type: "city", zips: ["91790", "91791", "91792"] },

  { id: "altadena", name: "Altadena", type: "unincorporated", zips: ["91001"] },
  { id: "avocado-heights", name: "Avocado Heights", type: "unincorporated", rollsUpTo: "la-puente", zips: ["91746"] },
  { id: "bassett", name: "Bassett", type: "unincorporated", rollsUpTo: "la-puente", zips: ["91746"] },
  { id: "charter-oak", name: "Charter Oak", type: "unincorporated", rollsUpTo: "covina", zips: ["91724"] },
  { id: "citrus", name: "Citrus", type: "unincorporated", rollsUpTo: "azusa", zips: ["91702"] },
  { id: "east-pasadena", name: "East Pasadena", type: "unincorporated", rollsUpTo: "pasadena", zips: ["91107"] },
  { id: "east-san-gabriel", name: "East San Gabriel", type: "unincorporated", rollsUpTo: "san-gabriel", zips: ["91775"] },
  { id: "hacienda-heights", name: "Hacienda Heights", type: "unincorporated", zips: ["91745"] },
  { id: "mayflower-village", name: "Mayflower Village", type: "unincorporated", rollsUpTo: "monrovia", zips: ["91016"] },
  { id: "north-el-monte", name: "North El Monte", type: "unincorporated", rollsUpTo: "el-monte", zips: ["91732"] },
  { id: "rowland-heights", name: "Rowland Heights", type: "unincorporated", zips: ["91748"] },
  {
    id: "south-monrovia-island",
    name: "South Monrovia Island",
    type: "unincorporated",
    rollsUpTo: "monrovia",
    zips: ["91016"],
  },
  {
    id: "south-san-jose-hills",
    name: "South San Jose Hills",
    type: "unincorporated",
    rollsUpTo: "la-puente",
    zips: ["91744"],
  },
  { id: "valinda", name: "Valinda", type: "unincorporated", rollsUpTo: "la-puente", zips: ["91744"] },
  { id: "vincent", name: "Vincent", type: "unincorporated", rollsUpTo: "covina", zips: ["91722"] },
  { id: "west-puente-valley", name: "West Puente Valley", type: "unincorporated", rollsUpTo: "la-puente", zips: ["91746"] },

  { id: "eagle-rock", name: "Eagle Rock", type: "la_neighborhood", adjacent: true, zips: ["90041"] },
  {
    id: "glendale",
    name: "Glendale",
    type: "city",
    adjacent: true,
    /* Her table writes this as the range 91201–91208. */
    zips: ["91201", "91202", "91203", "91204", "91205", "91206", "91207", "91208"],
  },
  {
    id: "highland-park",
    name: "Highland Park",
    type: "la_neighborhood",
    adjacent: true,
    zips: ["90042"],
  },
  { id: "la-crescenta", name: "La Crescenta", type: "unincorporated", adjacent: true, zips: ["91214"] },
  {
    id: "montrose",
    name: "Montrose",
    type: "unincorporated",
    adjacent: true,
    zips: ["91020", "91214"],
  },
];

const BY_ID = new Map(PLACES.map((p) => [p.id, p]));

const BY_ZIP = (() => {
  const m = new Map<string, Place[]>();
  for (const p of PLACES) {
    for (const z of p.zips) {
      const at = m.get(z);
      if (at) at.push(p);
      else m.set(z, [p]);
    }
  }
  return m;
})();

/** Every ZIP Pando is live in, sorted — the admin reads this to say what the footprint is. */
export const SUPPORTED_ZIPS: readonly string[] = [...BY_ZIP.keys()].sort();

export function placeById(id: string | null | undefined): Place | null {
  if (!id) return null;
  return BY_ID.get(id) ?? null;
}

/**
 * Five digits, or null.
 *
 * ⚠ ZIP+4 is accepted and truncated (`91106-1234` → `91106`) rather than
 * refused: it is what a browser's own autofill puts in the field, and refusing
 * it would read as Pando not knowing a real ZIP code. Nothing downstream wants
 * the +4 — it is a delivery route, and storing one would be a sharper location
 * than the *"no precise home address"* line in her own storage note allows.
 */
export function normaliseZip(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const m = /^\s*(\d{5})(?:-\d{4})?\s*$/.exec(raw);
  return m ? m[1] : null;
}

/**
 * The places a ZIP serves — often one, and never assume it.
 *
 * Deprioritised places sort last so a ZIP shared with City of Industry does not
 * open on it, and the rest keep the list's own order, which is hers.
 */
export function placesForZip(zip: string | null | undefined): Place[] {
  const z = normaliseZip(zip);
  if (!z) return [];
  const found = BY_ZIP.get(z) ?? [];
  return [...found].sort((a, b) => Number(!!a.deprioritised) - Number(!!b.deprioritised));
}

/**
 * The area this place matches on — itself, or the neighbour it shares a ZIP
 * with. This is what `market_options.area_slug` is set from.
 *
 * ⚠ Matching only. Never use it to answer *where does this parent live*: the
 * two questions differ for thirteen communities, and §5's demand number has to
 * name the place a parent actually chose.
 */
export function areaFor(place: Place | null): string | null {
  if (!place) return null;
  return place.rollsUpTo ?? place.id;
}

/** Is Pando live here? Never a gate — see the header. */
export function isSupportedZip(zip: string | null | undefined): boolean {
  const z = normaliseZip(zip);
  return z !== null && BY_ZIP.has(z);
}

/** Does this place need her *"Which ZIP code?"* follow-up? */
export function needsZipChoice(place: Place | null): boolean {
  return place !== null && place.zips.length > 1;
}

/**
 * Is this ZIP one of the place's own?
 *
 * The pairing is checked rather than trusted, because both arrive from the
 * browser and a stored `(place, zip)` that do not belong together would put a
 * parent in one place for matching and another for demand.
 */
export function zipBelongsTo(place: Place | null, zip: string | null | undefined): boolean {
  const z = normaliseZip(zip);
  return place !== null && z !== null && place.zips.includes(z);
}

const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

/**
 * Her combobox: *"Type your town, neighborhood or ZIP code."*
 *
 * Three rules, and the second is the one a looser match would break.
 *
 * 1. **A ZIP query returns the places it serves**, so the digits a parent knows
 *    by heart are a first-class way in rather than a fallback.
 * 2. **A name matches on a word boundary, never anywhere in the string.** A
 *    bare `includes` makes "monte" return El Monte, South El Monte *and* North
 *    El Monte — correct — and also makes "san" return nothing useful while
 *    "rock" quietly matches nothing at all; worse, a substring rule ranks
 *    "Industry" above "Sierra Madre" for "d". Prefix-per-word keeps "south pas"
 *    working, which is the phrasing the inbound parser already had to learn.
 * 3. **Accents fold.** `La Cañada Flintridge` has to answer "la canada", which
 *    is what anybody types on a phone keyboard.
 */
export function searchPlaces(query: string, limit = 8): Place[] {
  const raw = query.trim();
  if (raw === "") return [];

  const asZip = /^\d{3,5}/.test(raw) ? placesForZip(raw) : [];
  if (asZip.length > 0) return asZip.slice(0, limit);
  /* Three or four digits is a ZIP being typed, not a name — answering it with
     name matches would fill the list with noise that vanishes on the 5th key. */
  if (/^\d+$/.test(raw)) return [];

  const terms = fold(raw).split(/\s+/).filter(Boolean);
  const scored: Array<{ place: Place; score: number }> = [];

  for (const place of PLACES) {
    const words = fold(place.name).split(/\s+/);
    const every = terms.every((t) => words.some((w) => w.startsWith(t)));
    if (!every) continue;
    /* A whole-name prefix ranks above a match on a later word, so "san g" opens
       on San Gabriel rather than East San Gabriel. */
    const head = fold(place.name).startsWith(terms.join(" ")) ? 0 : 1;
    scored.push({ place, score: head + (place.deprioritised ? 2 : 0) });
  }

  return scored
    .sort((a, b) => a.score - b.score || a.place.name.localeCompare(b.place.name, "en"))
    .slice(0, limit)
    .map((s) => s.place);
}

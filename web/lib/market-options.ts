import type { AgeBand, MarketCategory, MarketId, Option } from "./types";

/**
 * The tap lists, and where they come from.
 *
 * **The database is the source of truth; the tables below are the fallback.**
 * `GET /api/market/options` serves `market_options`, the client loads it once per
 * session (`useMarketOptions`), and `marketOptions()` prefers what it loaded. That
 * is spec §8.5 — "the questionnaire localizes itself as data, not code" — and it
 * is what makes an admin promoting an "other" answer, or Janet importing her
 * sheet, take effect without a deploy.
 *
 * The tables here are still real and still used:
 *  - **before the fetch lands**, on the very first render, so no screen ever
 *    flashes empty;
 *  - **when there is no database**, which is the same honesty rule as
 *    `persisted: false` — the flow stays walkable, on visibly placeholder data;
 *  - **as the seed**: `supabase/seed.sql` is generated from this file.
 *
 * ⚠️ The Pasadena values are still PLACEHOLDERS awaiting the client's lists
 * (spec §23.2, open question 10). Replacing them is `npm run options:import`, not
 * a code change.
 */

export const MARKET_LABELS: Record<MarketId, string> = {
  pasadena: "Pasadena & the San Gabriel Valley",
};

type MarketOptions = Record<MarketCategory, Option[]>;

const pasadena: MarketOptions = {
  neighborhoods: [
    { id: "bungalow-heaven", label: "Bungalow Heaven" },
    { id: "madison-heights", label: "Madison Heights" },
    { id: "san-rafael", label: "San Rafael" },
    { id: "linda-vista", label: "Linda Vista" },
    { id: "hastings-ranch", label: "Hastings Ranch" },
    { id: "playhouse-district", label: "Playhouse District" },
    { id: "old-pasadena", label: "Old Pasadena" },
    { id: "east-pasadena", label: "East Pasadena" },
    { id: "northwest-pasadena", label: "Northwest Pasadena" },
    { id: "altadena", label: "Altadena" },
    { id: "south-pasadena", label: "South Pasadena" },
    { id: "san-marino", label: "San Marino" },
    { id: "sierra-madre", label: "Sierra Madre" },
    { id: "la-canada", label: "La Cañada Flintridge" },
    { id: "eagle-rock", label: "Eagle Rock" },
    { id: "arcadia", label: "Arcadia" },
    { id: "monrovia", label: "Monrovia" },
    { id: "temple-city", label: "Temple City" },
    { id: "alhambra", label: "Alhambra" },
    { id: "glendale", label: "Glendale" },
  ],

  schools: [
    // Preschool / early years
    { id: "neighborhood-church-preschool", label: "Neighborhood Church Preschool", bands: ["toddler", "preschool"] },
    { id: "the-growing-place", label: "The Growing Place", bands: ["toddler", "preschool"] },
    { id: "pasadena-waldorf", label: "Pasadena Waldorf School", bands: ["preschool", "grade", "tween"] },
    { id: "little-flower-montessori", label: "Little Flower Montessori", bands: ["toddler", "preschool"] },
    { id: "walden-school", label: "Walden School", bands: ["preschool", "grade"] },
    // Public elementary
    { id: "don-benito", label: "Don Benito Fundamental", bands: ["grade"] },
    { id: "field-elementary", label: "Field Elementary", bands: ["grade"] },
    { id: "willard-elementary", label: "Willard Elementary", bands: ["grade"] },
    { id: "sierra-madre-elementary", label: "Sierra Madre Elementary", bands: ["grade"] },
    { id: "san-rafael-elementary", label: "San Rafael Elementary", bands: ["grade"] },
    { id: "arroyo-seco-magnet", label: "Arroyo Seco Museum Science Magnet", bands: ["grade"] },
    // Independent K–12
    { id: "polytechnic", label: "Polytechnic School", bands: ["preschool", "grade", "tween", "teen"] },
    { id: "westridge", label: "Westridge School", bands: ["grade", "tween", "teen"] },
    { id: "mayfield-junior", label: "Mayfield Junior School", bands: ["grade", "tween"] },
    { id: "chandler-school", label: "Chandler School", bands: ["grade", "tween"] },
    { id: "sequoyah-school", label: "Sequoyah School", bands: ["grade", "tween", "teen"] },
    // Middle / high
    { id: "sierra-madre-middle", label: "Sierra Madre Middle School", bands: ["tween"] },
    { id: "mccarthy-blair", label: "Blair Middle & High", bands: ["tween", "teen"] },
    { id: "pasadena-high", label: "Pasadena High School", bands: ["teen"] },
    { id: "marshall-fundamental", label: "Marshall Fundamental", bands: ["tween", "teen"] },
  ],

  worship: [
    { id: "all-saints", label: "All Saints Church" },
    { id: "lake-avenue", label: "Lake Avenue Church" },
    { id: "pasadena-presbyterian", label: "Pasadena Presbyterian" },
    { id: "neighborhood-uu", label: "Neighborhood Unitarian Universalist" },
    { id: "st-andrew", label: "St. Andrew Catholic Church" },
    { id: "throop-church", label: "Throop Church" },
    { id: "temple-beth-israel", label: "Temple Beth Israel" },
    { id: "islamic-center-sgv", label: "Islamic Center of the SGV" },
    { id: "first-ame", label: "First AME Pasadena" },
  ],

  clubs: [
    { id: "altadena-town-country", label: "Altadena Town & Country Club" },
    { id: "annandale", label: "Annandale Golf Club" },
    { id: "oakmont", label: "Oakmont Country Club" },
    { id: "pasadena-ymca", label: "Pasadena YMCA" },
    { id: "rose-bowl-aquatics", label: "Rose Bowl Aquatics Center" },
    { id: "caltech-y", label: "Caltech Y family programs" },
    { id: "la-canada-country-club", label: "La Cañada Country Club" },
    { id: "pasadena-tennis-club", label: "Pasadena Tennis Club" },
  ],

  parent_groups: [
    { id: "school-pta", label: "Our school PTA / parent association" },
    { id: "pasadena-moms-fb", label: "Pasadena Moms (Facebook)" },
    { id: "sgv-parents-whatsapp", label: "SGV Parents (WhatsApp)" },
    { id: "neighborhood-parents-chat", label: "Neighborhood parents group chat" },
    { id: "mops", label: "MOPS group" },
    { id: "coop-preschool-parents", label: "Co-op preschool parents" },
    { id: "nextdoor-parents", label: "Nextdoor parents thread" },
    { id: "twin-multiples-group", label: "Twins & multiples group" },
  ],

  /**
   * Spec §15.3 calls this category `baby_activities`; in practice it holds the
   * popular local classes across every age, tagged by band so the chip list
   * re-evaluates whenever child age changes (spec §8.5).
   */
  baby_activities: [
    { id: "little-maestros", label: "Little Maestros", bands: ["baby", "toddler", "preschool"] },
    { id: "music-together", label: "Music Together", bands: ["baby", "toddler", "preschool"] },
    { id: "gymboree", label: "Gymboree Play & Music", bands: ["baby", "toddler"] },
    { id: "the-little-gym", label: "The Little Gym", bands: ["toddler", "preschool", "grade"] },
    { id: "library-storytime", label: "Library storytime", bands: ["baby", "toddler", "preschool"] },
    { id: "kidspace-classes", label: "Kidspace Museum classes", bands: ["toddler", "preschool", "grade"] },
    { id: "rba-parent-and-me", label: "Rose Bowl Aquatics parent & me", bands: ["baby", "toddler"] },
    { id: "swim-lessons", label: "Swim lessons", bands: ["toddler", "preschool", "grade"] },
    { id: "pasadena-dance-theatre", label: "Pasadena Dance Theatre", bands: ["preschool", "grade", "tween"] },
    { id: "ayso-soccer", label: "AYSO soccer", bands: ["preschool", "grade", "tween"] },
    { id: "sgv-little-league", label: "Little League", bands: ["grade", "tween"] },
    { id: "martial-arts", label: "Martial arts / taekwondo", bands: ["preschool", "grade", "tween"] },
    { id: "pasadena-conservatory", label: "Pasadena Conservatory of Music", bands: ["preschool", "grade", "tween", "teen"] },
    { id: "youth-symphony", label: "Pasadena Youth Symphony", bands: ["tween", "teen"] },
    { id: "ice-skating-center", label: "Pasadena Ice Skating Center", bands: ["grade", "tween", "teen"] },
    { id: "robotics-club", label: "Robotics / STEM club", bands: ["grade", "tween", "teen"] },
    { id: "tutoring-center", label: "Tutoring center", bands: ["grade", "tween", "teen"] },
    { id: "kids-yoga", label: "Kids yoga", bands: ["toddler", "preschool", "grade"] },
  ],

  /**
   * v3.2 §8.4 — camps as a first-class category rather than a kind of class.
   * They behave differently from everything above: a family "belongs" to a camp
   * for one week a year, decides in January, and forgets by March. That is
   * exactly why the list is worth holding as data — the answer has to exist
   * before the season, and by the season nobody is being asked.
   */
  camps: [
    { id: "tom-sawyer-camps", label: "Tom Sawyer Camps", bands: ["preschool", "grade", "tween"] },
    { id: "kidspace-summer-camp", label: "Kidspace summer camp", bands: ["preschool", "grade"] },
    { id: "rba-summer-camp", label: "Rose Bowl Aquatics summer camp", bands: ["grade", "tween"] },
    { id: "ymca-day-camp", label: "Pasadena YMCA day camp", bands: ["preschool", "grade", "tween"] },
    { id: "armory-art-camp", label: "Armory Center art camp", bands: ["preschool", "grade", "tween"] },
    { id: "descanso-nature-camp", label: "Descanso Gardens nature camp", bands: ["preschool", "grade"] },
    { id: "conservatory-summer", label: "Pasadena Conservatory summer program", bands: ["grade", "tween", "teen"] },
    { id: "school-break-camp", label: "Our school's break camp", bands: ["preschool", "grade", "tween"] },
    { id: "sports-skills-camp", label: "Sports skills camp", bands: ["grade", "tween"] },
    { id: "stem-coding-camp", label: "STEM / coding camp", bands: ["grade", "tween", "teen"] },
    { id: "theatre-camp", label: "Theatre camp", bands: ["grade", "tween", "teen"] },
    { id: "sleepaway-camp", label: "Sleepaway camp", bands: ["tween", "teen"] },
  ],
};

const MARKETS: Record<MarketId, MarketOptions> = { pasadena };

/* ── The runtime table ────────────────────────────────────────────────────── */

/**
 * What `/api/market/options` returned, once it has. Module state rather than
 * React state because the readers are pure functions called deep inside
 * `optionsFor` / `buildScripts` / `caregiverSteps`, and threading a table through
 * every one of them would be a refactor of the whole questionnaire to solve a
 * loading problem.
 *
 * On the **server** this stays empty and nothing sets it: server code (the profile
 * route's derivation) does not read option lists to decide anything, so there is
 * no request-scoped state to leak between users.
 */
const runtime = new Map<MarketId, Partial<Record<MarketCategory, Option[]>>>();
let version = 0;
const listeners = new Set<() => void>();

export function setRuntimeOptions(
  market: MarketId,
  table: Partial<Record<MarketCategory, Option[]>>,
): void {
  runtime.set(market, table);
  version += 1;
  for (const listener of listeners) listener();
}

export function subscribeMarketOptions(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Bumped whenever a table loads, so React can re-render what it built. */
export function marketOptionsVersion(): number {
  return version;
}

/**
 * The loaded list for this market and category, or the built-in one.
 *
 * **An empty loaded category falls back to the built-in list on purpose.** A
 * category with no rows is far more likely to mean "nobody has seeded it yet"
 * than "this market genuinely offers nothing", and the failure modes are not
 * comparable: a placeholder chip is visibly wrong and fixable, while a screen with
 * no options is a dead end a parent cannot get past and will not report. The cost
 * to accept is that deliberately retiring *every* option in a category brings the
 * placeholders back — visible in the admin as a category with zero active rows.
 */
export function marketOptions(
  market: MarketId,
  category: MarketCategory,
): Option[] {
  const loaded = runtime.get(market)?.[category];
  if (loaded && loaded.length > 0) return loaded;
  return MARKETS[market][category];
}

/** Options relevant to at least one of the parent's children. Untagged = always shown. */
export function optionsForBands(options: Option[], bands: AgeBand[]): Option[] {
  if (bands.length === 0) return options;
  return options.filter(
    (o) => !o.bands || o.bands.some((b) => bands.includes(b)),
  );
}

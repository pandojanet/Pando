import type { AgeBand, MarketCategory, MarketId, Option } from "./types";

/**
 * ⚠️ PLACEHOLDER DATA — awaiting the client's Pasadena lists (spec §23.2, open
 * question 10: "Who supplies the initial Pasadena market_options lists, and in
 * what format?").
 *
 * These are stand-ins so the flow can be built, demoed and QA'd. Every entry
 * here maps 1:1 to a `market_options` row (market_id, category, option_value),
 * so replacing this file with the real lists — or serving them from the database
 * at runtime via GET /api/market/options — changes no component code.
 *
 * Spec §8.5: "the questionnaire localizes itself as data, not code."
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
};

const MARKETS: Record<MarketId, MarketOptions> = { pasadena };

export function marketOptions(
  market: MarketId,
  category: MarketCategory,
): Option[] {
  return MARKETS[market][category];
}

/** Options relevant to at least one of the parent's children. Untagged = always shown. */
export function optionsForBands(options: Option[], bands: AgeBand[]): Option[] {
  if (bands.length === 0) return options;
  return options.filter(
    (o) => !o.bands || o.bands.some((b) => bands.includes(b)),
  );
}

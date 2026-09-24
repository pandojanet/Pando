/**
 * Which place a question is about, when it names one (24 Sep).
 *
 * ## Why this exists
 *
 * The developer texted Pando about New York and was answered with Little
 * Maestros — a music class in South Pasadena. Nothing in the answer path read a
 * place out of the message: the area came from the asker's profile, a cold number
 * has none, and retrieval ranks by area and never filters by it, so every
 * question was answered from the San Gabriel Valley whatever it was about.
 *
 * Two readers, both pure, so a plain node test can load this file:
 *
 *  - `knownPlaceIn` finds a neighborhood the market already has — the seventeen
 *    towns, the districts, and anything an admin has promoted (New York, once
 *    approved, is one of these). Whole words, longest name first, so "South
 *    Pasadena" beats "Pasadena".
 *  - `placePhraseIn` finds the words after "in", "near" or "around" when no
 *    known place matched, for the server to geocode. It is deliberately narrow:
 *    a phrase is only a candidate, and nothing is decided until the geocoder
 *    says it is a real place.
 *
 * Neither ever makes a question *about* somewhere on its own guess: a phrase the
 * geocoder cannot place is dropped, and the asker's profile decides as before.
 */

export interface PlaceLabel {
  id: string;
  label: string;
}

function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * A place the market knows, named in the question — or null.
 *
 * ⚠ "San Gabriel Valley" is the market's own name and not a question about the
 * city of San Gabriel, so a match followed by "valley" is skipped.
 */
export function knownPlaceIn(
  text: string,
  places: readonly PlaceLabel[],
): PlaceLabel | null {
  const hay = ` ${fold(text)} `;
  let best: PlaceLabel | null = null;
  let bestLength = 0;
  for (const place of places) {
    /* "New York, NY" is how a promoted place may be labelled; the name is the
       part before the comma. */
    const name = fold(place.label.split(",")[0] ?? "");
    if (name.length < 4) continue;
    const at = hay.indexOf(` ${name} `);
    if (at < 0) continue;
    const after = hay.slice(at + name.length + 2);
    if (after.startsWith("valley ")) continue;
    if (name.length > bestLength) {
      best = place;
      bestLength = name.length;
    }
  }
  return best;
}

/** Words that end a place phrase: "in new york **for** a 4 year old". */
const END = new Set([
  "for", "with", "that", "this", "which", "who", "where", "when", "and", "or",
  "to", "on", "at", "near", "around", "please", "any", "something", "anything",
  "is", "are", "was", "has", "have", "do", "does", "if", "but", "so", "from",
]);

/** A first word that means the phrase is not a place: "in **the** morning". */
const NOT_A_PLACE = new Set([
  "the", "a", "an", "my", "our", "your", "their", "his", "her", "this", "that",
  "these", "those", "next", "last", "every", "each", "some", "general", "town",
  "the area", "area", "school", "summer", "winter", "spring", "fall", "autumn",
  "morning", "afternoon", "evening", "night", "weekend", "weekends", "person",
  "advance", "mind", "total", "particular", "case", "time", "january",
  "february", "march", "april", "may", "june", "july", "august", "september",
  "october", "november", "december", "english", "spanish", "private", "public",
]);

/**
 * The words after "in" / "near" / "around", up to three, when they could be a
 * place — or null. A candidate only: the server geocodes it before it means
 * anything.
 */
export function placePhraseIn(text: string): string | null {
  const match = /\b(?:in|near|around)\s+([^?!.,;:\n]{2,60})/i.exec(text);
  if (!match) return null;
  const words: string[] = [];
  for (const raw of match[1].trim().split(/\s+/)) {
    const word = raw.replace(/[^\p{L}\p{N}'.-]/gu, "");
    if (word === "") break;
    if (words.length > 0 && END.has(word.toLowerCase())) break;
    words.push(word);
    if (words.length === 3) break;
  }
  if (words.length === 0) return null;
  if (NOT_A_PLACE.has(words[0].toLowerCase())) return null;
  /* Digits alone are a ZIP, which the local directory answers without Google;
     a word with digits in it is not a place name. */
  if (words.some((w) => /\d/.test(w)) && !/^\d{5}$/.test(words.join(""))) return null;
  const phrase = words.join(" ");
  return phrase.length >= 3 ? phrase : null;
}

/**
 * A Google place's stored name as a search location — "New York, NY" → the city
 * and the state. Pando's place lookup is US-only, so the country is known.
 */
export function locationFromLabel(
  label: string,
): { city?: string; region?: string; country: string } {
  const [city, region] = label.split(",").map((part) => part.trim());
  return {
    ...(city ? { city } : {}),
    ...(region && /^[A-Z]{2}$/.test(region) ? { region } : {}),
    country: "US",
  };
}

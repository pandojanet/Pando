import "server-only";

import { placesForZip } from "@/lib/home-places";
import { knownPlaceIn, locationFromLabel, placePhraseIn } from "@/lib/place-in-question";
import { nearbyAreas } from "@/lib/server/repo/areas";
import { marketAreas } from "@/lib/server/repo/onboarding";
import { lookupPlaces } from "@/lib/server/geocode";
import { withDb, type Db } from "@/lib/server/db";
import { sql } from "drizzle-orm";

/**
 * Where a question is about (24 Sep) — the place Pando answers it for.
 *
 * ## The fault
 *
 * Asked about New York, Pando answered with a music class in South Pasadena —
 * and again after an admin had approved New York as a place. The area came
 * only from the profile, a promoted place never reached the parent's own
 * `people.neighborhood`, the web search was hard-wired to Pasadena, and
 * retrieval ranked by area and never filtered.
 *
 * ## One rule, read from the database
 *
 * The developer's instruction was that no feature may work off a place list in
 * code that another feature ignores: **everything the database supports is
 * supported, the same way.** So a place is either a neighborhood in
 * `market_options` — the seventeen towns, their districts, anything an admin
 * has promoted — or it is not, and "near" is `nearbyAreas`: that place plus
 * what `neighborhood_adjacency` says touches it. Records, the search's place,
 * the Network Ask offer and its pool all read that one answer.
 *
 * ## The order
 *
 *  1. A market neighborhood **named in the question** — a Pasadena parent
 *     asking about Arcadia is asking about Arcadia.
 *  2. An "in / near / around" phrase: a ZIP only one place serves, a market
 *     label by exact name, or Google — and a geocoded place counts only when it
 *     is the place named, and is supported only when the database holds it.
 *  3. The profile's neighborhood.
 *  4. The place they gave on the profile that is still pending — matched to
 *     its slug if it has been promoted since.
 *  5. Nothing known.
 */
export interface QuestionPlace {
  /** A market neighborhood id, when the database holds the place. */
  area: string | null;
  /** What a person calls it — the search's location and the brief. */
  label: string | null;
  /**
   * The neighborhoods that count as near it. `null` when nothing is known
   * (nothing to filter by); `[]` for a place the database does not hold, whose
   * parents' half is therefore empty rather than somebody else's region.
   */
  near: string[] | null;
  /** Where it came from, for the log line (an enum, never the text). */
  source: "question" | "geocoded" | "profile" | "pending_profile" | "none";
}

function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function sameStart(a: string, b: string): boolean {
  const x = fold(a);
  const y = fold(b);
  return x.length > 0 && y.length > 0 && (x.startsWith(y) || y.startsWith(x));
}

type Area = { id: string; label: string };

/** A market neighborhood by its exact name (the part before any comma). */
function byName(areas: readonly Area[], name: string): Area | undefined {
  const want = fold(name.split(",")[0] ?? name);
  if (want === "") return undefined;
  return areas.find((a) => fold(a.label.split(",")[0] ?? a.label) === want);
}

async function supported(marketId: string, area: Area, source: QuestionPlace["source"]): Promise<QuestionPlace> {
  return { area: area.id, label: area.label, near: await nearbyAreas(marketId, area.id), source };
}

function unsupported(label: string, source: QuestionPlace["source"]): QuestionPlace {
  return { area: null, label, near: [], source };
}

export async function placeForQuestion(input: {
  question: string;
  marketId?: string;
  profile: { neighborhood: string | null; pending_place?: string | null } | null;
}): Promise<QuestionPlace> {
  const marketId = input.marketId ?? "pasadena";
  const areas = await marketAreas(marketId);

  const named = knownPlaceIn(input.question, areas);
  if (named) return supported(marketId, named, "question");

  const phrase = placePhraseIn(input.question);
  if (phrase) {
    if (/^\d{5}$/.test(phrase)) {
      /* A ZIP names a place only when one place serves it (15 of 62 are
         shared), and only a place the market holds. */
      const serving = placesForZip(phrase)
        .map((p) => areas.find((a) => a.id === p.id))
        .filter((a): a is Area => Boolean(a));
      if (serving.length === 1) return supported(marketId, serving[0], "question");
    } else {
      const listed = byName(areas, phrase);
      if (listed) return supported(marketId, listed, "question");
    }

    const looked = await lookupPlaces({ query: phrase, marketId, kind: "place", limit: 1 });
    const first = looked.ok ? looked.places[0] : undefined;
    /* ⚠ Only a result that is **the place the parent named**. The geocoder
       answers almost any word with a town somewhere — "classes in ballet"
       would otherwise become a question about wherever that resolves, and
       empty the answer. A ZIP is its own proof; a name must agree. A false
       negative ("NYC") falls back to the profile, which is the safe side. */
    const found =
      first && (/^\d{5}$/.test(phrase) || sameStart(first.name, phrase)) ? first : undefined;
    if (found) {
      const listed = byName(areas, found.name);
      if (listed) return supported(marketId, listed, "geocoded");
      return unsupported(found.storedValue, "geocoded");
    }
  }

  const home = input.profile?.neighborhood ?? null;
  if (home) {
    const listed = areas.find((a) => a.id === home);
    return {
      area: home,
      label: listed?.label ?? null,
      near: await nearbyAreas(marketId, home),
      source: "profile",
    };
  }

  const pending = input.profile?.pending_place?.trim() || null;
  if (pending) {
    /* Approved since they gave it? Then it has a slug — whether or not the
       promotion reached this person's row (a profile re-saved afterwards
       writes the chip answer, which is empty). */
    const listed = knownPlaceIn(pending, areas) ?? byName(areas, pending);
    if (listed) return supported(marketId, listed, "pending_profile");
    return unsupported(pending, "pending_profile");
  }

  return { area: null, label: null, near: null, source: "none" };
}

/**
 * The web search's location for this place.
 *
 * A place the market holds is searched at its own name, in the market's region
 * (a label carrying a state — "New York, NY" — says its own). A place it does
 * not hold is searched where it is. Nothing known is **the United States**,
 * never the market's town: a stranger who has said nothing about where they
 * are must not be searched as a Pasadena parent.
 */
export function searchLocationFor(
  place: QuestionPlace,
): { city?: string; region?: string; country: string; inMarket: boolean } {
  if (!place.label) return { country: "US", inMarket: false };
  const loc = locationFromLabel(place.label);
  return { ...loc, inMarket: place.area !== null && loc.region === undefined };
}

/**
 * How many parents near this place Pando may ask (24 Sep) — the Network Ask
 * offer's condition, read the same way the pool is chosen.
 *
 * People whose neighborhood is near, who are not the asker and who have not
 * opted out. The protection rules (the 48-hour gap, the allowance, the
 * governor) are deliberately not re-run here: they change by the hour, and the
 * pool applies them when the Ask is actually sent — a short pool is then held
 * for a person, which is the existing guard.
 */
export async function askablePeopleNear(input: {
  near: readonly string[];
  askerId: string | null;
  marketId?: string;
}): Promise<number> {
  if (input.near.length === 0) return 0;
  const literal = `{${input.near.map((a) => `"${a}"`).join(",")}}`;
  const result = await withDb(async (db: Db) => {
    const rows = (await db.execute(sql`
      select count(*)::int as n
        from people p
       where p.market_id = ${input.marketId ?? "pasadena"}
         and not p.is_test
         and p.neighborhood = any(${literal}::text[])
         and (${input.askerId}::uuid is null or p.id <> ${input.askerId}::uuid)
         and not exists (
           select 1 from sms_opt_outs o
            where o.phone = p.phone
              and (o.opted_in_at is null or o.opted_in_at < o.opted_out_at))
    `)) as unknown as Array<Record<string, unknown>>;
    return Number(rows[0]?.n ?? 0);
  });
  return result.persisted ? (result.data ?? 0) : 0;
}

/** Enough parents near a place for a Network Ask to be worth offering. */
export const MIN_ASKABLE_NEAR = 3;

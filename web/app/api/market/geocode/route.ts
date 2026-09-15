import { NextResponse } from "next/server";
import { rateLimited } from "@/lib/server/rate-limit";
import { geocodeConfigured, lookupPlaces } from "@/lib/server/geocode";

/**
 * GET /api/market/geocode?q=91011&market_id=pasadena
 *
 * The third thing the neighborhood question asks, and only ever the third.
 *
 * 1. the curated starters — her seventeen towns, already on screen as chips;
 * 2. `lib/home-places.ts` — 52 places and 62 ZIPs, in the bundle, free;
 * 3. **this** — Google, for the parent who lives somewhere the first two have
 *    never heard of.
 *
 * Until now step 3 did not exist, so a parent in La Crescenta or Sylmar typed
 * their own ZIP and read *"Nothing matching '91011'."* — which is not what
 * Pando means. `isSupportedZip` "is not a gate" (§5, 14 Sep): somebody outside
 * the footprint finishes the whole profile, because the schools, the children
 * and the demand number that says where to open next are worth more than the
 * four minutes turning them away would save. This is the front door of that
 * decision finally being able to name the place.
 *
 * ## Three answers, and they are three because two of them are not "nothing"
 *
 * - `{ configured: false }` — no key on this deployment. The screen says what
 *   it says today and never claims to have looked.
 * - `{ places: [] }` — Google looked and knows no such place.
 * - `{ error: … }` — the lookup did not run. Never cached, never rendered as
 *   an empty result.
 *
 * ⚠ Collapsing the first and second into one empty array is the 9 Sep fault
 * (`PublicSearchResult.configured`, computed and read by nobody) waiting to be
 * committed again, which is why it is three fields rather than one list.
 *
 * ## No auth, a tight limit, and why that split is the right one
 *
 * Same argument `/api/market/search` makes: this is public reference data about
 * places, it holds nothing about any person, and the questionnaire needs it
 * before there is an identity to check. What is different is that **each call
 * is billed**, so the bucket is `geocode` — forty in ten minutes rather than
 * six hundred in one — and the limiter rather than a session is what stands
 * between a script and the invoice.
 *
 * ⚠ It is deliberately **not** gated on the `pando_invited` marker. That cookie
 * is issued by `proxy.ts` on page routes and no `/api/*` route consults it, so
 * reading it here would be a second, quieter gate that the parent flow's own
 * front door does not have — and a parent who reaches the neighborhood question
 * at all has already passed the one that does exist.
 */

export const dynamic = "force-dynamic";

/** The same bound `cacheKey` folds to, and the same one the column CHECKs. */
const MAX_QUERY = 60;

export async function GET(request: Request) {
  const limited = rateLimited(request, "geocode");
  if (limited) return limited;

  const url = new URL(request.url);

  const marketId = (url.searchParams.get("market_id") ?? "pasadena").toLowerCase().slice(0, 40);
  if (!/^[a-z0-9-]+$/.test(marketId)) {
    return NextResponse.json({ error: "Unknown market" }, { status: 400 });
  }

  const q = (url.searchParams.get("q") ?? "").trim().slice(0, MAX_QUERY);

  /**
   * ⚠ **The short-circuit reports the real configuration, and the first cut did
   * not** — it answered `{ configured: true, places: [] }` for a one-character
   * query on a deployment with no key at all, which is this feature's own
   * cardinal sin committed inside the guard against it: a caller told the
   * lookup ran and found nothing, when there was no lookup to run.
   *
   * Caught by hitting the endpoint rather than by reading it, which is the only
   * way a wrong *combination* of two correct branches ever surfaces.
   */
  if (q.length < 2) {
    return NextResponse.json({ configured: geocodeConfigured(), places: [] });
  }

  const outcome = await lookupPlaces({ query: q, marketId });

  if (!outcome.ok) {
    if (outcome.reason === "not_configured") {
      /**
       * 200, not an error. Nothing went wrong — this deployment simply has no
       * key, which is a *configuration* fact the caller has to be able to read
       * without treating it as a failure. The same shape `sendSms` answers with
       * for `not_provisioned` and `/api/seed/verify/status` for `sendable`.
       */
      return NextResponse.json({ configured: false, places: [] });
    }
    /* A real failure, and it says so. The screen renders this as "we could not
       look", never as "there is no such place". */
    return NextResponse.json(
      { configured: true, error: outcome.reason },
      { status: 502 },
    );
  }

  return NextResponse.json({ configured: true, places: outcome.places });
}

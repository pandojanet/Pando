import type { MarketId } from "./types";

/**
 * Every fact about a market that the code needs, in one place (27 Oct).
 *
 * Until this file the pilot market was written into the code wherever it was
 * needed: `?? "pasadena"` in about twenty queries, `America/Los_Angeles` in six
 * date formats and in quiet hours, "California" in two web-search locations,
 * the search rectangle in `geocode.ts`, the label in `market-options.ts`, and
 * LA County's child-protection line inside a reply. A second market would have
 * meant finding all of them. Now it is one entry here: `MarketId` (types.ts)
 * names it, `Record<MarketId, MarketConfig>` makes the compiler refuse a market
 * with a missing field, and everything else reads `marketConfig(id)`.
 *
 * ⚠ **Pure, and imports nothing at runtime.** Several modules that need these
 * values (`answer.ts`, `trust-labels.ts`, `answer-routing.ts`) are loaded by
 * plain `node` in the test suites, where one module cannot import another; they
 * take the value as a parameter from their server-side caller, which reads it
 * here. Their own fallback, where they keep one, is pinned to this file by
 * `test:markets`.
 *
 * What is **not** here, on purpose: the tap lists (`market_options`, a table
 * with a code fallback in `market-options.ts`), the places and their ZIPs
 * (`home-places.ts`, `geo_places`) and the copy registered with the carrier
 * (`sms-templates.ts`). Those are data or registered text, not configuration.
 */

export interface LatLng {
  lat: number;
  lng: number;
}

export interface MarketConfig {
  id: MarketId;
  /** How the market is named to a parent ("Pasadena & the San Gabriel Valley"). */
  label: string;
  /**
   * The parents' clock: quiet hours (8:00–21:00 here, invariant 6), and every
   * date a parent reads ("last confirmed Oct 2026").
   */
  timeZone: string;
  /** How the zone is named in copy ("8am-9pm Pacific"). */
  timeZoneName: string;
  /**
   * The environment variable holding this market's Twilio Messaging Service
   * SID — the sender its texts go out from (27 Oct). Unset in the environment
   * means the default market's service: a second market can share one A2P
   * service and add its local numbers to that sender pool.
   */
  messagingServiceEnv: string;
  /** Two-letter state code, as Google's address components spell it. */
  state: string;
  /** The state's name, as the web search's user_location and `inAnotherState` take it. */
  stateName: string;
  /** The city the web search is told the parent is in. */
  city: string;
  country: string;
  /** Where the market's lookups look first — a bias, never a filter (geocode.ts). */
  sw: LatLng;
  ne: LatLng;
  /**
   * The local lines in the replies to a health, legal or safety question and to
   * a claim about a person (answer-routing.ts). 911, 211 and 988 are national
   * and stay in the copy; these two are not.
   */
  crisis: {
    /** The nurse line the web panel names ("the LA County nurse line at 211"). */
    nurseLine: { name: string; phone: string };
    legalHelp: { name: string; phone: string };
    childProtection: { name: string; phone: string };
  };
}

export const MARKETS: Record<MarketId, MarketConfig> = {
  pasadena: {
    id: "pasadena",
    label: "Pasadena & the San Gabriel Valley",
    timeZone: "America/Los_Angeles",
    timeZoneName: "Pacific",
    messagingServiceEnv: "TWILIO_MESSAGING_SERVICE_SID",
    state: "CA",
    stateName: "California",
    city: "Pasadena",
    country: "US",
    /* The SGV plus the western places the client kept: roughly Whittier up to
       La Cañada, Eagle Rock across to Pomona. */
    sw: { lat: 33.9, lng: -118.4 },
    ne: { lat: 34.32, lng: -117.6 },
    crisis: {
      nurseLine: { name: "the LA County nurse line", phone: "211" },
      legalHelp: { name: "Neighborhood Legal Services of LA County", phone: "1-800-433-6251" },
      childProtection: { name: "LA County child protection", phone: "1-800-540-4000" },
    },
  },
};

/**
 * Invariant 6's window: no proactive text before 8:00 or from 21:00 on, on the
 * parent's own clock (spec §14 wrote it as Pacific because the pilot is). One
 * rule, read by the send layer and by the admin's banner.
 */
export const QUIET_HOURS = { start: 8, end: 21 } as const;

/** The hour (0–23) it is now in a time zone. */
export function hourIn(timeZone: string, now: Date = new Date()): number {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", hourCycle: "h23" }).format(now));
}

export function isQuietHoursIn(timeZone: string, now: Date = new Date()): boolean {
  const hour = hourIn(timeZone, now);
  return hour < QUIET_HOURS.start || hour >= QUIET_HOURS.end;
}

/**
 * True while every market names the same Messaging Service variable: the send
 * layer then never needs to know whose text it is to pick the sender. Two
 * markets naming different variables read the market on every Twilio send,
 * even if both variables hold one service.
 */
export const ONE_SENDER =
  new Set(Object.values(MARKETS).map((m) => m.messagingServiceEnv)).size === 1;

/**
 * Quiet hours for a parent whose market could not be read (27 Oct review): quiet
 * if it is quiet in **any** market's zone. Failing open to the default market's
 * clock would let a text through at 21:30 in a market east of it. With one
 * market this is exactly that market's rule.
 */
export function isQuietHoursAnywhere(now: Date = new Date()): boolean {
  return Object.values(MARKETS).some((m) => isQuietHoursIn(m.timeZone, now));
}

/** "8am", "9pm" — an hour of QUIET_HOURS as copy reads it. */
export function hourWord(hour: number): string {
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${h}${hour < 12 ? "am" : "pm"}`;
}

/** "8am-9pm Pacific", from the rule and the market's zone name. */
export function quietWindowPhrase(market: MarketConfig = marketConfig(), dash = "-"): string {
  return `${hourWord(QUIET_HOURS.start)}${dash}${hourWord(QUIET_HOURS.end)} ${market.timeZoneName}`;
}

/** The market a row, a number or a request belongs to when nothing says otherwise. */
export const DEFAULT_MARKET_ID: MarketId = "pasadena";

export function isMarketId(value: unknown): value is MarketId {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(MARKETS, value);
}

/** The market's configuration; an unknown or missing id is the default market. */
export function marketConfig(id?: string | null): MarketConfig {
  const key = (id ?? "").trim().toLowerCase();
  return isMarketId(key) ? MARKETS[key] : MARKETS[DEFAULT_MARKET_ID];
}

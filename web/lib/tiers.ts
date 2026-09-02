/**
 * M9.4 — the contributor ladder, and M9.3's weights.
 *
 * Member -> Contributor -> Trusted -> Local Expert -> Founding, computed from
 * activity. Pure, and deliberately free of runtime imports so
 * `npm run test:tiers` can load it in plain node — the same property that
 * `matching.ts` and `outreach-policy.ts` protect, and for the same reason: a
 * rule that decides what somebody has earned has to be exhaustively testable,
 * including the cases where a tier must **not** move.
 *
 * ## The reward is access, not points
 *
 * 9.4 says so in its own words, and it rules out the obvious build. There is no
 * score on a screen, no progress bar, no leaderboard — strategy 13 says "no
 * leaderboard ever" — and the number this file computes is an **admin-side**
 * quantity. What a contributor sees is a status and what it opens.
 *
 * The concrete entitlements are deliberately absent. Strategy 13 posts exchange
 * rates for the grove (5 leaves = a free Targeted Ask, 15 = a month, 40 = a
 * year), and that ledger is not in any estimate row and is not quoted. Inventing
 * a price here would be the app granting money nobody agreed to. So a tier
 * carries a label and what it means, and the grant stays where the decision is.
 */

/** The five, in ladder order. */
export const TIER_IDS = [
  "member",
  "contributor",
  "trusted",
  "local_expert",
  "founding",
] as const;

export type TierId = (typeof TIER_IDS)[number];

export interface TierSpec {
  id: TierId;
  label: string;
  /**
   * Response-equivalents needed to reach it. `null` for founding: it is not
   * earned by volume at all — see below.
   */
  threshold: number | null;
  /** What it means, in the words an admin reads. */
  note: string;
}

export const TIERS: Record<TierId, TierSpec> = {
  member: {
    id: "member",
    label: "Member",
    threshold: 0,
    note: "Joined and verified. Everyone starts here, including a parent who has only ever asked.",
  },
  contributor: {
    id: "contributor",
    label: "Contributor",
    threshold: 1,
    note: "Has given something the network could use — one approved contribution, or one answered Network Ask.",
  },
  trusted: {
    id: "trusted",
    label: "Trusted",
    threshold: 3,
    note: "Gives consistently. Three quality responses, or the freshness confirmations that add up to them.",
  },
  local_expert: {
    id: "local_expert",
    label: "Local Expert",
    threshold: 8,
    note: "The people the network runs on. Eight quality responses is roughly a year of answering when asked.",
  },
  founding: {
    id: "founding",
    label: "Founding",
    threshold: null,
    note: "Granted by an admin on the second approved contribution, and never taken away. Not a volume tier.",
  },
};

/**
 * How many quality responses one thing is worth.
 *
 * **Three confirmations is one response**, which is 9.4's own number and its own
 * word "configurable" — hence a named constant rather than a `/ 3` somewhere in
 * a query. Confirming a freshness ping is a real contribution (it is what keeps
 * "Last confirmed" honest) and it is one tap, so it cannot be worth the same as
 * writing an answer.
 */
export const FRESHNESS_PER_RESPONSE = 3;

export type ImpactKind =
  | "contribution_approved"
  | "blast_answered"
  | "freshness_confirmed"
  | "answer_used";

/**
 * What each kind of impact is worth toward a tier.
 *
 * **`answer_used` is worth nothing here, and that is the design.** It is the
 * best signal that somebody genuinely helped — 9.3's own purpose — but it is an
 * outcome rather than an act: one popular recommendation could be used fifty
 * times and mint a Local Expert out of a single share, while a parent who
 * answers ten questions about quieter subjects stays a Contributor. So the
 * ladder counts what a person **did**, and usage is what the impact receipts
 * report back to them. Both read the same table; only one is a threshold.
 *
 * An unrated `blast_answered` is worth half. A reply is giving, and strategy 6
 * is explicit that a parent who answers has done the thing being asked of them —
 * but "quality response" is the unit, and until an admin has rated it (7.6)
 * nobody has said it was one.
 */
export const EVENT_WEIGHT: Record<ImpactKind, number> = {
  contribution_approved: 1,
  blast_answered: 1,
  freshness_confirmed: 1 / FRESHNESS_PER_RESPONSE,
  answer_used: 0,
};

/** The rating at which an answered Ask counts as a full quality response. */
export const QUALITY_RATING_FLOOR = 3;

export interface ImpactEvent {
  kind: ImpactKind;
  /** The admin's 1-5 rating (7.6), where one was given. */
  quality?: number | null;
}

/** What one event is worth, rating included. */
export function weightOf(event: ImpactEvent): number {
  const base = EVENT_WEIGHT[event.kind] ?? 0;
  if (event.kind !== "blast_answered") return base;
  if (event.quality == null) return base / 2;
  return event.quality >= QUALITY_RATING_FLOOR ? base : 0;
}

/**
 * The lifetime total, in quality responses.
 *
 * Rounded down only at the threshold comparison, never here: two freshness
 * confirmations are two thirds of a response and stay two thirds, or a
 * contributor who confirms twice a month would round to zero forever.
 */
export function responseEquivalents(events: ImpactEvent[]): number {
  return events.reduce((total, event) => total + weightOf(event), 0);
}

export interface TierInput {
  /** `people.founding = 'founding'` — an admin's decision, already made. */
  founding: boolean;
  equivalents: number;
}

/**
 * Which tier somebody is on.
 *
 * **Two rules that are not preferences.**
 *
 * *Founding wins outright, and it is permanent.* The estimate says founding
 * contributors keep the status; it is granted by a person on the second approved
 * contribution (a Phase 1 decision) and no amount of later quiet takes it back.
 * It is checked first, so a founding contributor is never reported as a Member
 * because their events predate the impact table.
 *
 * *The ladder is lifetime and monotonic.* A tier computed over a rolling window
 * would swing — somebody would be a Local Expert in March and a Contributor in
 * May, having done nothing wrong — and access earned is not access rented. What
 * handles current engagement is the response-rate governor in
 * `outreach-policy.ts`, which lowers how often a quiet contributor is *asked*.
 * Two mechanisms, two jobs; duplicating one inside the other would punish the
 * same silence twice.
 */
export function tierFor(input: TierInput): TierId {
  if (input.founding) return "founding";
  let earned: TierId = "member";
  for (const id of TIER_IDS) {
    const spec = TIERS[id];
    if (spec.threshold === null) continue;
    if (input.equivalents >= spec.threshold) earned = id;
  }
  return earned;
}

/**
 * The next rung, for the admin's contributor page.
 *
 * Deliberately **not** for the parent: telling somebody they are two responses
 * from Trusted turns a status into a score, which is the thing 9.4 says the
 * reward must not be. It exists so a human can see who is close.
 */
export function nextTier(current: TierId): TierSpec | null {
  if (current === "founding") return null;
  const index = TIER_IDS.indexOf(current);
  for (let i = index + 1; i < TIER_IDS.length; i++) {
    const spec = TIERS[TIER_IDS[i]];
    if (spec.threshold !== null) return spec;
  }
  return null;
}

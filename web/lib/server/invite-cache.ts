import "server-only";

import type { MarketId } from "@/lib/types";

/**
 * The read cache behind invite resolution, in its own module so the admin write
 * side can clear it — the same shape and the same reason as
 * `lib/server/market-cache.ts`.
 *
 * Why it matters more here than for a chip list: **every** entry to the Seed Tool
 * resolves a code, including the server render of `/join`. Without a cache that is
 * a database round trip on the first screen a parent ever sees, and against the
 * pooler the round trip is the whole cost (see CLAUDE.md).
 *
 * Cleared after an admin creates or retires an invite, so a link is live the moment
 * it is copied rather than a minute later — which matters because the first thing
 * an admin does after creating one is open it to check.
 */

export interface InviteRecord {
  id: string;
  code: string;
  market_id: MarketId;
  label: string;
  group_option_value: string | null;
  /**
   * The first name of the parent whose own link this is — `null` for a group
   * or a school link, which is most of them.
   *
   * Only a **personal** invite (`invites.kind`, drizzle 0034) has a person
   * behind it, so this is null wherever there is nobody to name. That is the
   * whole of the client's rule for the join screen: *"if the invite code
   * resolves, show '{first name} invited you'; otherwise show nothing"* — a
   * group link resolves perfectly well and still names nobody.
   *
   * First name only. It is what the parent already knows, since they were sent
   * the link by that person, and it is the least this can be and still answer
   * "who is this from".
   */
  inviter_first_name: string | null;
}

const TTL_MS = 60_000;

const store = globalThis as typeof globalThis & {
  __pandoInvites?: { at: number; table: Map<string, InviteRecord> } | null;
};

export function cachedInvites(): Map<string, InviteRecord> | null {
  const hit = store.__pandoInvites;
  if (!hit) return null;
  if (Date.now() - hit.at >= TTL_MS) {
    store.__pandoInvites = null;
    return null;
  }
  return hit.table;
}

export function cacheInvites(table: Map<string, InviteRecord>): void {
  store.__pandoInvites = { at: Date.now(), table };
}

/** Called after any admin write that changes which codes are live. */
export function invalidateInvites(): void {
  store.__pandoInvites = null;
}

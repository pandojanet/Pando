import "server-only";

import type { MarketCategory, Option } from "@/lib/types";

/**
 * The read cache behind `GET /api/market/options`, in its own module so the write
 * side can clear it.
 *
 * Without that, an admin promoting an "other" answer would watch the chip fail to
 * appear for up to a minute and reasonably conclude the button does nothing. With
 * it, the only path that waits for the TTL is `npm run options:import`, which runs
 * in a different process and cannot reach this — said plainly on the admin screen
 * rather than left to be discovered.
 *
 * Process-local, like the OTP store: one container, and a stale minute after a
 * deploy is not a correctness problem. It becomes a shared cache the day there are
 * two containers, and the shape here is what that replaces.
 */

export interface MarketOptionsBody {
  configured: boolean;
  market_id: string;
  options: Partial<Record<MarketCategory, Option[]>>;
}

const TTL_MS = 60_000;

const store = globalThis as typeof globalThis & {
  __pandoMarketOptions?: Map<string, { at: number; body: MarketOptionsBody }>;
};
store.__pandoMarketOptions ??= new Map();
const cache = store.__pandoMarketOptions;

export function cachedOptions(marketId: string): MarketOptionsBody | null {
  const hit = cache.get(marketId);
  if (!hit) return null;
  if (Date.now() - hit.at >= TTL_MS) {
    cache.delete(marketId);
    return null;
  }
  return hit.body;
}

export function cacheOptions(marketId: string, body: MarketOptionsBody): void {
  cache.set(marketId, { at: Date.now(), body });
}

/** Called after any admin write that changes what the tap lists contain. */
export function invalidateOptions(): void {
  cache.clear();
}

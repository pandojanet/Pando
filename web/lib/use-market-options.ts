"use client";

import { useEffect, useSyncExternalStore } from "react";
import {
  marketOptionsVersion,
  setRuntimeOptions,
  subscribeMarketOptions,
} from "./market-options";
import type { MarketCategory, MarketId, Option } from "./types";
import { MARKET_CATEGORIES } from "./types";

/**
 * Loads the tap lists from `market_options` and re-renders what was built from
 * them (spec §8.5, §16.2).
 *
 * Every screen that shows chips builds them with a pure function — `optionsFor`,
 * `buildScripts`, `caregiverSteps` — called during render. So the hook does two
 * things and no more: it kicks off the fetch once per market, and it subscribes to
 * the module store so a component re-renders when the table arrives. Callers pass
 * the returned version into their `useMemo` deps; the value itself means nothing.
 *
 * **Failure is silent and safe.** A network error, a 502, an unconfigured
 * database — all leave the built-in lists in place, because a parent midway
 * through a profile must not be shown an empty screen because a fetch failed. What
 * is *not* silent is a promotion that never lands: the admin now says how long the
 * chip takes to appear, rather than claiming it is already there.
 */

/** Markets already fetched (or in flight) this page load. */
const started = new Set<MarketId>();

async function load(market: MarketId): Promise<void> {
  if (started.has(market)) return;
  started.add(market);

  try {
    const res = await fetch(
      `/api/market/options?market_id=${encodeURIComponent(market)}`,
    );
    if (!res.ok) return;

    const body = (await res.json()) as {
      configured?: boolean;
      options?: Record<string, Option[]>;
    };
    if (!body.configured || !body.options) return;

    const table: Partial<Record<MarketCategory, Option[]>> = {};
    for (const category of MARKET_CATEGORIES) {
      const list = body.options[category];
      if (Array.isArray(list) && list.length > 0) table[category] = list;
    }
    if (Object.keys(table).length > 0) setRuntimeOptions(market, table);
  } catch {
    /* Offline, or the route is unreachable. The built-in lists still work — this
       is the same rule as `persisted: false`: degrade honestly, never blank. */
    started.delete(market);
  }
}

export function useMarketOptions(market: MarketId): number {
  const version = useSyncExternalStore(
    subscribeMarketOptions,
    marketOptionsVersion,
    /* Server snapshot. The runtime table is only ever populated in the browser,
       so the server always renders the built-in lists — and hydration matches. */
    () => 0,
  );

  useEffect(() => {
    void load(market);
  }, [market]);

  return version;
}

import "server-only";

import { MARKET_LABELS } from "../market-options";
import type { InviteResult, MarketId } from "../types";

/**
 * Invite validation for the shared link (estimate 1.1).
 *
 * Decision recorded from the estimate: "Uses one shareable link (not a unique
 * link per parent), matching how Janet distributes it to existing parent
 * groups." So a code identifies a *market*, not a person — it is a soft gate
 * that keeps the tool off the open web, not authentication.
 *
 * Configure with SEED_INVITE_CODES="sgv-founding:pasadena,pasadena:pasadena".
 */

const DEFAULT_CODES: Record<string, MarketId> = {
  "sgv-founding": "pasadena",
  pasadena: "pasadena",
};

function codeTable(): Record<string, MarketId> {
  const raw = process.env.SEED_INVITE_CODES;
  if (!raw) return DEFAULT_CODES;

  const table: Record<string, MarketId> = {};
  for (const pair of raw.split(",")) {
    const [code, market] = pair.split(":").map((s) => s?.trim());
    if (code) table[code.toLowerCase()] = (market || "pasadena") as MarketId;
  }
  return Object.keys(table).length > 0 ? table : DEFAULT_CODES;
}

export function normalizeCode(code: string | null | undefined): string | null {
  const trimmed = code?.trim().toLowerCase();
  return trimmed ? trimmed : null;
}

export function validateInviteCode(code: string | null | undefined): InviteResult {
  const normalized = normalizeCode(code);
  const fallback: MarketId = "pasadena";

  if (!normalized) {
    return {
      valid: false,
      market_id: fallback,
      market_label: MARKET_LABELS[fallback],
      reason: "missing",
    };
  }

  const market = codeTable()[normalized];
  if (!market) {
    return {
      valid: false,
      market_id: fallback,
      market_label: MARKET_LABELS[fallback],
      reason: "unknown",
    };
  }

  return {
    valid: true,
    market_id: market,
    market_label: MARKET_LABELS[market] ?? market,
  };
}

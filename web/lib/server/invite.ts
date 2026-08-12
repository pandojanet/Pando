import "server-only";

import { sql } from "drizzle-orm";
import { MARKET_LABELS } from "../market-options";
import type { InviteResult, MarketId } from "../types";
import { withDb } from "./db";
import { cachedInvites, cacheInvites, type InviteRecord } from "./invite-cache";

/**
 * Invite resolution (estimate 1.1).
 *
 * **A code identifies a group and its market — never a person.** That is the 31 Jul
 * decision, put to QuitCode again on 12 Aug against QC Answers Q3's "both" and kept:
 * no unique link per founding contributor. What a code *does* carry, since the
 * `invites` table exists, is which parent group a contributor arrived through —
 * the one thing "one shared link" could never answer.
 *
 * Two sources, in this order:
 *
 *  1. **The `invites` table**, which an admin manages at `/admin/invites`.
 *  2. **`SEED_INVITE_CODES`** — `"sgv-founding:pasadena,pasadena:pasadena"` — kept as
 *     the fallback so an unconfigured or unreachable database still lets a parent
 *     in. Same honesty rule as `persisted: false`: degrade, never blank.
 *
 * An **unknown or retired code still lets the parent in**, with the market falling
 * back and no attribution recorded. A typo in a link forwarded around a group chat
 * is not a dead end, and a code retired last week must not strand the parent who
 * got it the week before.
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

/** Active invites, keyed by code. Cached — see `invite-cache.ts` for why. */
async function liveInvites(): Promise<Map<string, InviteRecord>> {
  const hit = cachedInvites();
  if (hit) return hit;

  const result = await withDb(async (db) => {
    const rows = (await db.execute(
      sql`select id, code, market_id, label, group_option_value
            from invites where active`,
    )) as unknown as Array<Record<string, unknown>>;
    return rows;
  });

  const table = new Map<string, InviteRecord>();
  if (result.persisted) {
    for (const row of result.data) {
      table.set(String(row.code), {
        id: String(row.id),
        code: String(row.code),
        market_id: String(row.market_id) as MarketId,
        label: String(row.label),
        group_option_value:
          typeof row.group_option_value === "string"
            ? row.group_option_value
            : null,
      });
    }
    cacheInvites(table);
  }
  return table;
}

export async function validateInviteCode(
  code: string | null | undefined,
): Promise<InviteResult> {
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

  const invite = (await liveInvites()).get(normalized);
  if (invite) {
    return {
      valid: true,
      market_id: invite.market_id,
      market_label: MARKET_LABELS[invite.market_id] ?? invite.market_id,
      invite_id: invite.id,
      group_label: invite.label,
      group_option_value: invite.group_option_value,
    };
  }

  /* Not in the table — either there is no database, or this code predates it.
     The env list is what the pilot ran on before `/admin/invites` existed. */
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

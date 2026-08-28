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
 * ## Where a code comes from
 *
 *  1. **With a database, the `invites` table is the only source** (12 Aug). Not
 *     "unless it is empty" — if there is a store to read, it is the answer, even
 *     when the answer is "no invites exist yet". A built-in code that keeps working
 *     next to a real table is a way in that no admin created and no admin can
 *     retire, which is precisely what was wrong with `sgv-founding` outliving it.
 *  2. **`SEED_INVITE_CODES` applies only when there is no database at all.** That
 *     is the laptop-and-sample-data case, where nothing could be stored anyway.
 *  3. **An unreadable store falls back to the env list** — the one place this
 *     deliberately differs from `admin_users`, which fails closed. There, an outage
 *     that let a revoked admin in would be a security failure; here, an outage that
 *     turned every invite link into a dead end would take the tool offline for
 *     people who did nothing wrong. What is lost is attribution, and attribution is
 *     recoverable.
 *
 * **The consequence to accept:** a fresh deployment with a database and no invites
 * yet admits nobody by code. That is the same shape as the admin being dark until
 * somebody is added, and the fix is the same — one invite at `/admin/invites`.
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

/**
 * Active invites, keyed by code — and **whether there was a store to read at
 * all**, which is the difference between "no invites exist" and "no database
 * exists". Only the second one may fall back to the environment.
 *
 * Cached; see `invite-cache.ts` for why that matters on the first screen.
 */
async function liveInvites(): Promise<{
  table: Map<string, InviteRecord>;
  authoritative: boolean;
}> {
  const hit = cachedInvites();
  if (hit) return { table: hit, authoritative: true };

  const result = await withDb(async (db) => {
    const rows = (await db.execute(
      sql`select id, code, market_id, label, group_option_value
            from invites where active`,
    )) as unknown as Array<Record<string, unknown>>;
    return rows;
  });

  const table = new Map<string, InviteRecord>();
  if (!result.persisted) {
    /* No database, or it could not be read. Either way there is no store to be
       authoritative, so the env list answers — see the header for why this one
       degrades open while `admin_users` fails closed. */
    return { table, authoritative: false };
  }

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
  return { table, authoritative: true };
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

  const { table: live, authoritative } = await liveInvites();
  const invite = live.get(normalized);
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

  /**
   * There is a store, and this code is not in it — so it is not an invite,
   * whatever `SEED_INVITE_CODES` says. **Including when the store is empty:** a
   * built-in code that works next to a real table is a door no admin opened and
   * no admin can close.
   */
  if (authoritative) {
    return {
      valid: false,
      market_id: fallback,
      market_label: MARKET_LABELS[fallback],
      reason: "unknown",
    };
  }

  /* No store at all: the env list is the whole answer, which is what keeps the
     flow walkable on a laptop with no database. */
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

/**
 * Records that a link was opened — estimate 2.2's per-link funnel.
 *
 * ## Why it is a separate call rather than part of `validateInviteCode`
 *
 * That function runs on every profile save and every card save, because the
 * server re-resolves the code rather than trusting the body. Counting there would
 * make "opens" mean "requests", and a parent who shares six recommendations would
 * register seven opens. This is called from **one** place: the `/join` page's
 * server render, which is the thing an open actually is.
 *
 * ## Three properties it needs, and none of them is exactness
 *
 * **It never blocks or breaks the page.** A failed increment loses a metric; a
 * thrown error loses the parent. So it swallows everything and returns nothing —
 * the same rule the analytics calls follow.
 *
 * **It does not de-duplicate.** Doing so needs an identifier before consent, and
 * nothing about a person may be stored before their number is verified
 * (invariant 11). So a reopened link counts twice, bots count, and link previews
 * count. That inflation is roughly uniform across channels, which is what makes
 * comparing them usable even though no single figure is a headcount.
 *
 * **It does not create a row.** An unknown or retired code still admits the
 * parent (see the decisions in CLAUDE.md), and inventing an invite for it would
 * turn a typo into a channel.
 */
export async function recordInviteOpen(code: string | null | undefined): Promise<void> {
  const normalized = normalizeCode(code);
  if (!normalized) return;

  try {
    await withDb(async (db) => {
      await db.execute(
        sql`update invites
               set opens = opens + 1,
                   last_opened_at = now()
             where code = ${normalized}`,
      );
      return null;
    });
  } catch {
    /* A metric is not worth a 500 on the first screen a parent sees. */
  }
}

import "server-only";

import type { TwilioMessage } from "@/lib/messages-summary";

/**
 * Twilio's record of Pando's messages, read for Pando MCP's `messages_summary` (27 Nov). GET requests only,
 * on the same keys `costs_summary` and the send layer use (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN): nothing
 * here can send, change or delete a message. Each message is cut to the fields `summarizeMessages` reads —
 * the recipient, the text and the numbers are dropped as they arrive, before anything else sees them.
 *
 * Two reads: the account's messages for the period (Twilio filters by UTC date sent, a page of 1,000 at a
 * time, at most `MAX_PAGES`), and each of Pando's own messages that has no final status by its SID — a
 * message that failed inside Twilio may carry no date sent, and the period filter would miss exactly the
 * one this exists to find.
 */

const MAX_PAGES = 10;
const MAX_BY_SID = 60;
const cache = new Map<string, { at: number; value: TwilioRead }>();
const TEN_MINUTES = 10 * 60 * 1000;

export type TwilioRead =
  | { configured: false }
  | { configured: true; messages: TwilioMessage[]; truncated: boolean; error?: string };

const keep = (m: Record<string, unknown>): TwilioMessage => ({
  sid: String(m.sid ?? ""),
  status: String(m.status ?? "unknown"),
  error_code: m.error_code === null || m.error_code === undefined || m.error_code === "" ? null : Number(m.error_code),
  direction: String(m.direction ?? ""),
  /* Only the channel prefix survives: `rcs:` or `whatsapp:` — never the number after it. */
  from: typeof m.from === "string" ? (/^(rcs|whatsapp):/i.exec(m.from)?.[0] ?? "") : null,
  num_segments: (m.num_segments as string | null) ?? null,
  num_media: (m.num_media as string | null) ?? null,
  price: (m.price as string | null) ?? null,
  price_unit: (m.price_unit as string | null) ?? null,
  date_created: (m.date_created as string | null) ?? null,
});

/** The account's messages from `from` to `to` (YYYY-MM-DD, UTC dates, inclusive), plus `sids` fetched one by one. */
export async function twilioMessages(from: string, to: string, sids: readonly string[]): Promise<TwilioRead> {
  const account = process.env.TWILIO_ACCOUNT_SID?.trim();
  const token = process.env.TWILIO_AUTH_TOKEN?.trim();
  if (!account || !token) return { configured: false };
  const key = `${from}|${to}|${[...sids].sort().join(",")}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TEN_MINUTES) return hit.value;

  const base = process.env.TWILIO_API_BASE ?? "https://api.twilio.com";
  const headers = { Authorization: `Basic ${Buffer.from(`${account}:${token}`).toString("base64")}` };
  const get = async (path: string) => {
    const res = await fetch(`${base}${path}`, { headers, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`Twilio answered ${res.status}`);
    return (await res.json()) as Record<string, unknown>;
  };

  const found = new Map<string, TwilioMessage>();
  let truncated = false;
  try {
    /* `DateSent>` / `DateSent<` are Twilio's own names for "on or after" / "on or before". */
    let path: string | null = `/2010-04-01/Accounts/${account}/Messages.json?${new URLSearchParams({ "DateSent>": from, "DateSent<": to, PageSize: "1000" })}`;
    for (let page = 0; path; page++) {
      if (page === MAX_PAGES) {
        truncated = true;
        break;
      }
      const body = await get(path);
      for (const m of (body.messages as Array<Record<string, unknown>> | undefined) ?? []) found.set(String(m.sid), keep(m));
      path = typeof body.next_page_uri === "string" && body.next_page_uri ? body.next_page_uri : null;
    }
    const missing = sids.filter((s) => !found.has(s)).slice(0, MAX_BY_SID);
    if (sids.length - found.size > MAX_BY_SID) truncated = true;
    for (const sid of missing) {
      if (!/^(SM|MM)[0-9a-f]{32}$/.test(sid)) continue;
      try {
        found.set(sid, keep(await get(`/2010-04-01/Accounts/${account}/Messages/${sid}.json`)));
      } catch {
        /* One message Twilio no longer has (a 404 after its retention) does not fail the rest. */
      }
    }
  } catch (err) {
    return { configured: true, messages: [...found.values()], truncated: true, error: err instanceof Error ? err.message.slice(0, 60) : "error" };
  }
  const value: TwilioRead = { configured: true, messages: [...found.values()], truncated };
  cache.set(key, { at: Date.now(), value });
  return value;
}

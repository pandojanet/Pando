import "server-only";

import { DEFAULT_MARKET_ID, marketConfig } from "@/lib/markets";

/**
 * What Pando spends (20 Nov), for Pando MCP's `costs_summary`: Twilio's own usage records (SMS, MMS,
 * RCS, numbers — the price Twilio charged, not an estimate) and the AI spend `tracedFetch` already
 * sends PostHog with every model call (`$ai_total_cost_usd`, by `$ai_span_name`). Read-only; each half
 * says "not configured" when its keys are missing, and a result is kept for an hour.
 *
 * Days (23 Nov, the review): the AI half counts Pasadena days, as every other Pando number does.
 * Twilio's usage records are whole UTC days and cannot be asked otherwise, so the answer says so
 * (`days`) rather than pretending the two halves line up to the hour.
 *
 * Env: TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN (already set for sending), POSTHOG_PERSONAL_API_KEY and
 * POSTHOG_PROJECT_ID (new: a personal key with query:read), POSTHOG_API_HOST (default from
 * POSTHOG_SERVER_HOST, `us.i.posthog.com` → `us.posthog.com`).
 */

export interface CostsSummary {
  from: string;
  to: string;
  days: { sms: string; ai: string };
  sms: { configured: boolean; currency: string | null; total: number | null; by_category: Array<{ category: string; description: string; count: number; price: number }> ; error?: string };
  ai: { configured: boolean; total_usd: number | null; by_purpose: Array<{ purpose: string; calls: number; usd: number }>; error?: string };
}

/** The market's clock, a constant of lib/markets.ts — the only value spliced into the HogQL besides the checked dates. */
const TZ = marketConfig(DEFAULT_MARKET_ID).timeZone;

const cache = new Map<string, { at: number; value: CostsSummary }>();
const HOUR = 60 * 60 * 1000;

async function twilio(from: string, to: string): Promise<CostsSummary["sms"]> {
  const sid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const token = process.env.TWILIO_AUTH_TOKEN?.trim();
  if (!sid || !token) return { configured: false, currency: null, total: null, by_category: [] };
  const base = process.env.TWILIO_API_BASE ?? "https://api.twilio.com";
  try {
    const res = await fetch(`${base}/2010-04-01/Accounts/${sid}/Usage/Records.json?StartDate=${from}&EndDate=${to}&PageSize=1000`, {
      headers: { Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return { configured: true, currency: null, total: null, by_category: [], error: `Twilio answered ${res.status}` };
    const body = (await res.json()) as { usage_records?: Array<{ category: string; description: string; count: string; price: string; price_unit: string }> };
    const recs = body.usage_records ?? [];
    const total = recs.find((r) => r.category === "totalprice");
    const kept = recs
      .filter((r) => /^(sms|mms|rcs|phonenumbers|calls|lookups|a2p|carrierfees)/.test(r.category) && Number(r.price) > 0)
      .map((r) => ({ category: r.category, description: r.description, count: Number(r.count), price: Math.round(Number(r.price) * 100) / 100 }))
      .sort((a, b) => b.price - a.price)
      .slice(0, 20);
    return { configured: true, currency: total?.price_unit?.toUpperCase() ?? recs[0]?.price_unit?.toUpperCase() ?? null, total: total ? Math.round(Number(total.price) * 100) / 100 : null, by_category: kept };
  } catch (err) {
    return { configured: true, currency: null, total: null, by_category: [], error: err instanceof Error ? err.constructor.name : "error" };
  }
}

function posthogApiHost(): string {
  const explicit = process.env.POSTHOG_API_HOST?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const ingest = (process.env.POSTHOG_SERVER_HOST?.trim() || "https://us.i.posthog.com").replace(/\/+$/, "");
  return ingest.replace(".i.posthog.com", ".posthog.com");
}

async function posthog(from: string, to: string): Promise<CostsSummary["ai"]> {
  const key = process.env.POSTHOG_PERSONAL_API_KEY?.trim();
  const project = process.env.POSTHOG_PROJECT_ID?.trim();
  if (!key || !project) return { configured: false, total_usd: null, by_purpose: [] };
  const query = `select properties.$ai_span_name as purpose, count() as calls, sum(toFloat(properties.$ai_total_cost_usd)) as usd
                   from events where event = '$ai_generation' and timestamp >= toDateTime('${from} 00:00:00', '${TZ}') and timestamp < toDateTime('${to} 00:00:00', '${TZ}') + interval 1 day
                  group by purpose order by usd desc limit 50`;
  try {
    const res = await fetch(`${posthogApiHost()}/api/projects/${encodeURIComponent(project)}/query/`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: { kind: "HogQLQuery", query } }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return { configured: true, total_usd: null, by_purpose: [], error: `PostHog answered ${res.status}` };
    const body = (await res.json()) as { results?: unknown[][] };
    const byPurpose = (body.results ?? []).map((r) => ({ purpose: String(r[0] ?? "unnamed"), calls: Number(r[1] ?? 0), usd: Math.round(Number(r[2] ?? 0) * 100) / 100 }));
    return { configured: true, total_usd: Math.round(byPurpose.reduce((s, r) => s + r.usd, 0) * 100) / 100, by_purpose: byPurpose };
  } catch (err) {
    return { configured: true, total_usd: null, by_purpose: [], error: err instanceof Error ? err.constructor.name : "error" };
  }
}

/** Both halves for `from`..`to` inclusive (YYYY-MM-DD), each on its own, cached for an hour. */
export async function costsSummary(from: string, to: string): Promise<CostsSummary> {
  const key = `${from}|${to}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < HOUR) return hit.value;
  const [sms, ai] = await Promise.all([twilio(from, to), posthog(from, to)]);
  const value = { from, to, days: { sms: "UTC days (Twilio's usage records)", ai: `${TZ} days` }, sms, ai };
  if (!sms.error && !ai.error) cache.set(key, { at: Date.now(), value });
  return value;
}

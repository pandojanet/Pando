/**
 * Twilio's own record of Pando's messages, summed for Pando MCP's `messages_summary` (27 Nov).
 *
 * Why it exists: on 24 Nov Twilio failed a reply with 19023 and Pando's `message_log` still holds no
 * status for it — the failure never came back on the status callback, so `delivery_health` counted it
 * "in flight" and no report showed it. Twilio's API is the record of what happened; this compares it with
 * Pando's log, message by message, and says where they disagree.
 *
 * Counts and SIDs only: a phone number, a message's text or a recipient never leaves this function
 * (invariant 7). A SID names a message, not a person. Pure and import-free, so `npm run test:messages`
 * loads it in plain node; the server passes in the error titles it knows (`lib/delivery.ts`).
 */

/** The fields this reads from Twilio's Message resource — never `to`, `body` or a number from `from`. */
export interface TwilioMessage {
  sid: string;
  status: string;
  error_code: number | null;
  direction: string;
  /** Only its prefix is read: `rcs:` or `whatsapp:` names the channel. */
  from: string | null;
  num_segments: string | number | null;
  num_media: string | number | null;
  price: string | null;
  price_unit: string | null;
  date_created: string | null;
}

/** What Pando's log says about one of its own outbound messages. */
export interface PandoLogRow {
  sid: string;
  template: string | null;
  category: string | null;
  status: string | null;
  error_code: number | null;
}

export const TERMINAL = ["delivered", "read", "undelivered", "failed"] as const;
const FAILED = new Set(["undelivered", "failed"]);
const DELIVERED = new Set(["delivered", "read"]);
const EXAMPLES = 5;

export const channelOf = (m: Pick<TwilioMessage, "from" | "num_media">): "rcs" | "whatsapp" | "mms" | "sms" => {
  const from = (m.from ?? "").toLowerCase();
  if (from.startsWith("rcs:")) return "rcs";
  if (from.startsWith("whatsapp:")) return "whatsapp";
  return Number(m.num_media ?? 0) > 0 ? "mms" : "sms";
};

const bump = (o: Record<string, number>, k: string, by = 1) => {
  o[k] = (o[k] ?? 0) + by;
};

export interface MessagesSummary {
  messages: number;
  inbound: number;
  outbound: number;
  outbound_by_status: Record<string, number>;
  outbound_by_channel: Record<string, number>;
  /** Delivered (or read) out of those with a final status; null with none final yet. */
  delivery_rate: number | null;
  segments: number;
  price: { total: number; currency: string | null };
  errors: Array<{ code: number; count: number; title: string; docs: string; example_sids: string[] }>;
  by_day: Array<{ day: string; outbound: number; delivered: number; failed: number; inbound: number }>;
  by_template: Array<{ template: string; outbound: number; delivered: number; failed: number }>;
  /**
   * Where Twilio and Pando's log disagree about one of Pando's own messages — the 24 Nov hole: Twilio has
   * a final status and Pando has none, or a different one.
   */
  pando_out_of_step: { count: number; examples: Array<{ sid: string; template: string | null; twilio: string; pando: string | null; error_code: number | null }> };
  /** Outbound in Twilio with no row in Pando's log: sent from somewhere else (the console, a test, another app). */
  not_sent_by_pando: { count: number; example_sids: string[] };
}

/**
 * Sum Twilio's messages, and set each of Pando's own beside its log row. `day` turns a Twilio date into
 * the day it is counted on (the server passes Pasadena's).
 */
export function summarizeMessages(input: {
  twilio: TwilioMessage[];
  pando: PandoLogRow[];
  titles: Record<number, string>;
  day: (iso: string) => string;
}): MessagesSummary {
  const log = new Map(input.pando.map((r) => [r.sid, r]));
  const byStatus: Record<string, number> = {};
  const byChannel: Record<string, number> = {};
  const errors = new Map<number, { count: number; sids: string[] }>();
  const days = new Map<string, { outbound: number; delivered: number; failed: number; inbound: number }>();
  const templates = new Map<string, { outbound: number; delivered: number; failed: number }>();
  const outOfStep: MessagesSummary["pando_out_of_step"]["examples"] = [];
  let outOfStepCount = 0;
  const notOurs: string[] = [];
  let notOursCount = 0;
  let inbound = 0;
  let outbound = 0;
  let segments = 0;
  let price = 0;
  let currency: string | null = null;
  let final = 0;
  let delivered = 0;

  for (const m of input.twilio) {
    const out = m.direction !== "inbound";
    const day = m.date_created ? input.day(m.date_created) : "unknown";
    const d = days.get(day) ?? { outbound: 0, delivered: 0, failed: 0, inbound: 0 };
    days.set(day, d);
    segments += Number(m.num_segments ?? 0) || 0;
    /* Twilio gives a price as a negative number of the account's currency; a missing one is not zero cost. */
    if (m.price !== null && m.price !== undefined && m.price !== "") price += Math.abs(Number(m.price)) || 0;
    currency ??= m.price_unit ? m.price_unit.toUpperCase() : null;
    if (!out) {
      inbound++;
      d.inbound++;
      continue;
    }
    outbound++;
    d.outbound++;
    bump(byStatus, m.status);
    bump(byChannel, channelOf(m));
    const isFinal = (TERMINAL as readonly string[]).includes(m.status);
    if (isFinal) final++;
    if (DELIVERED.has(m.status)) {
      delivered++;
      d.delivered++;
    }
    if (FAILED.has(m.status)) d.failed++;
    if (m.error_code) {
      const e = errors.get(m.error_code) ?? { count: 0, sids: [] };
      e.count++;
      if (e.sids.length < EXAMPLES) e.sids.push(m.sid);
      errors.set(m.error_code, e);
    }
    const row = log.get(m.sid);
    if (!row) {
      notOursCount++;
      if (notOurs.length < EXAMPLES) notOurs.push(m.sid);
      continue;
    }
    const t = templates.get(row.template ?? "untemplated") ?? { outbound: 0, delivered: 0, failed: 0 };
    templates.set(row.template ?? "untemplated", t);
    t.outbound++;
    if (DELIVERED.has(m.status)) t.delivered++;
    if (FAILED.has(m.status)) t.failed++;
    /* Out of step: Twilio is final and Pando's log is not the same (a missing status included). */
    if (isFinal && row.status !== m.status) {
      outOfStepCount++;
      if (outOfStep.length < 10) outOfStep.push({ sid: m.sid, template: row.template, twilio: m.status, pando: row.status, error_code: m.error_code });
    }
  }

  return {
    messages: input.twilio.length,
    inbound,
    outbound,
    outbound_by_status: byStatus,
    outbound_by_channel: byChannel,
    delivery_rate: final > 0 ? Math.round((delivered / final) * 1000) / 1000 : null,
    segments,
    price: { total: Math.round(price * 100) / 100, currency },
    errors: [...errors.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .map(([code, e]) => ({ code, count: e.count, title: input.titles[code] ?? `Twilio error ${code}`, docs: `https://www.twilio.com/docs/api/errors/${code}`, example_sids: e.sids })),
    by_day: [...days.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([day, v]) => ({ day, ...v })),
    by_template: [...templates.entries()].sort((a, b) => b[1].outbound - a[1].outbound).map(([template, v]) => ({ template, ...v })),
    pando_out_of_step: { count: outOfStepCount, examples: outOfStep },
    not_sent_by_pando: { count: notOursCount, example_sids: notOurs },
  };
}

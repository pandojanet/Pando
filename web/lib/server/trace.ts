import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";

/**
 * Tracing for the SMS agent, sent to PostHog from the server (27 Oct).
 *
 * One **trace** per unit of work — an inbound text, a scheduled job — and inside
 * it **spans** (a step: classify, retrieve, the web search, the rewrite, a
 * send), **generations** (one model call each: model, tokens, cost, latency)
 * and **events** (what the code already logs: `[sms:answer] queued {…}`).
 * PostHog's LLM analytics reads `$ai_trace`, `$ai_span` and `$ai_generation`
 * and draws the tree; the same `trace_id` prefixes every log line written
 * inside the trace, so `docker logs | grep <id>` gives the same story.
 *
 * ## What never leaves (invariant 7)
 *
 * No phone number, no name, no free text — **ever**, not even "just for
 * debugging". A generation carries counts only (no `$ai_input` / `$ai_output`);
 * a person is a one-way hash of their id, never their phone; every property
 * passes `safeProps`, which keeps numbers and booleans and only short
 * identifier-shaped strings, and drops anything carrying a run of digits. The
 * log lines it forwards are already enums and counts by the same invariant —
 * this is the second net, not the first.
 *
 * ## Switched off unless configured
 *
 * `POSTHOG_SERVER_KEY` unset ⇒ nothing is sent anywhere (the trace id still
 * prefixes the logs). A failed send is logged as an enum and never fails the
 * work it describes: tracing is not allowed to cost a parent an answer.
 */

type Prop = string | number | boolean | null;
type Props = Record<string, Prop>;

interface Captured {
  event: string;
  properties: Props;
  timestamp: string;
}

interface Trace {
  id: string;
  name: string;
  startedAt: number;
  distinctId: string;
  personKnown: boolean;
  spans: string[];
  out: Captured[];
}

const store = new AsyncLocalStorage<Trace>();

/* ------------------------------------------------------------------ config */

function config(): { key: string; host: string } | null {
  const key = process.env.POSTHOG_SERVER_KEY?.trim() ?? "";
  if (!key) return null;
  const host = (process.env.POSTHOG_SERVER_HOST?.trim() || "https://us.i.posthog.com").replace(/\/+$/, "");
  return { key, host };
}

export function isTracingConfigured(): boolean {
  return config() !== null;
}

/* ----------------------------------------------------------------- privacy */

/**
 * Only what cannot be a person. Numbers and booleans pass; a string passes if it
 * is short and shaped like an identifier or an enum ("ask_recommendation",
 * "claude-haiku-5-5", "sms:inbound", "offer-2026-10-26"), and never if it holds
 * seven digits in a row (a phone, however written). Everything else is dropped
 * and counted, so a leak shows up as a number rather than as a person's words.
 */
const SAFE_STRING = /^[A-Za-z0-9_.:\-/ ]{0,64}$/;
/* Seven digits in one run, however punctuated — after an ISO date is taken out,
   so "offer-2026-10-26" (a version) passes and "(626) 555-0001" never does. */
const ISO_DATE = /\b\d{4}-\d{2}-\d{2}\b/g;
const digitRun = (v: string) =>
  (v.replace(ISO_DATE, " ").match(/[\d\s().+-]+/g) ?? []).some((run) => (run.match(/\d/g) ?? []).length >= 7);

export function safeProps(input: Record<string, unknown>): { props: Props; dropped: number } {
  const props: Props = {};
  let dropped = 0;
  for (const [k, v] of Object.entries(input)) {
    if (!/^[$A-Za-z_][A-Za-z0-9_.$]{0,63}$/.test(k)) { dropped++; continue; }
    if (v === null || v === undefined) props[k] = null;
    else if (typeof v === "number") props[k] = Number.isFinite(v) ? v : null;
    else if (typeof v === "boolean") props[k] = v;
    else if (typeof v === "string" && SAFE_STRING.test(v) && !digitRun(v) && v.trim().split(/\s+/).length <= 4) props[k] = v;
    else dropped++;
  }
  return { props, dropped };
}

/** A person, as PostHog sees them: a one-way hash of the id, never the phone. */
export function personKey(personId: string): string {
  return "p_" + createHash("sha256").update(`pando:${personId}`).digest("hex").slice(0, 24);
}

/* ------------------------------------------------------------------ traces */

/** The ids this module makes itself: they pass whole, and only as UUIDs. */
const ID_KEYS = ["$ai_span_id", "$ai_parent_id"] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function capture(t: Trace | undefined, event: string, input: Record<string, unknown>) {
  const raw = { ...input };
  const ids: Props = {};
  for (const k of ID_KEYS) {
    const v = raw[k];
    delete raw[k];
    if (typeof v === "string" && UUID.test(v)) ids[k] = v;
  }
  const { props, dropped } = safeProps(raw);
  const properties: Props = {
    ...props,
    ...ids,
    ...(dropped ? { props_dropped: dropped } : {}),
    $ai_trace_id: t?.id ?? null,
    trace_name: t?.name ?? null,
    environment: process.env.TRACE_ENVIRONMENT?.trim() || "production",
  };
  const row: Captured = { event, properties, timestamp: new Date().toISOString() };
  if (t) t.out.push(row);
  else void send([row], "anon", false);
}

/**
 * Run `fn` as one trace. Nested calls join the outer trace rather than starting
 * their own — a job that sends texts is one trace, not one per text.
 */
export async function withTrace<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const outer = store.getStore();
  if (outer) return fn();
  const t: Trace = {
    id: randomUUID(),
    name,
    startedAt: Date.now(),
    distinctId: "",
    personKnown: false,
    spans: [],
    out: [],
  };
  t.distinctId = `trace_${t.id}`;
  let outcome = "ok";
  try {
    return await store.run(t, fn);
  } catch (err) {
    outcome = "error";
    throw err;
  } finally {
    capture(t, "$ai_trace", {
      $ai_span_name: name,
      $ai_latency: (Date.now() - t.startedAt) / 1000,
      $ai_is_error: outcome === "error",
      outcome,
      generations: t.out.filter((e) => e.event === "$ai_generation").length,
      spans: t.out.filter((e) => e.event === "$ai_span").length,
    });
    await send(t.out, t.distinctId, t.personKnown);
  }
}

/** The trace id of the work in hand, for a log line or a row. Null outside a trace. */
export function currentTraceId(): string | null {
  return store.getStore()?.id ?? null;
}

/** Once the person is known: every event of this trace is theirs, by hash. */
export function traceIdentify(personId: string | null | undefined): void {
  const t = store.getStore();
  if (!t || !personId) return;
  t.distinctId = personKey(personId);
  t.personKnown = true;
}

/** A product event inside the current trace ("answer_queued", "ask_created"…). */
export function traceEvent(event: string, props: Record<string, unknown> = {}): void {
  capture(store.getStore(), event, props);
}

/**
 * One step, timed. The outcome is "error" when it throws; `describe` may add
 * counts from the result (never the result itself).
 */
export async function span<T>(
  name: string,
  fn: () => Promise<T>,
  describe?: (result: T) => Record<string, unknown>,
): Promise<T> {
  const t = store.getStore();
  if (!t) return fn();
  const id = randomUUID();
  const parent = t.spans[t.spans.length - 1] ?? t.id;
  t.spans.push(id);
  const started = Date.now();
  let extra: Record<string, unknown> = {};
  let error = false;
  try {
    const result = await fn();
    try { extra = describe ? describe(result) : {}; } catch { extra = {}; }
    return result;
  } catch (err) {
    error = true;
    throw err;
  } finally {
    t.spans.pop();
    capture(t, "$ai_span", {
      ...extra,
      $ai_span_id: id,
      $ai_parent_id: parent,
      $ai_span_name: name,
      $ai_latency: (Date.now() - started) / 1000,
      $ai_is_error: error,
    });
  }
}

/* ------------------------------------------------------------- generations */

/** $ per million tokens (input, output), and per web search. Anthropic list prices. */
const PRICE: Record<string, [number, number]> = {
  "claude-haiku-5-5": [0.1, 0.5],
  "claude-sonnet-5-5": [2, 10],
  "claude-opus-5-5": [4, 20],
};
const WEB_SEARCH_USD = 0.01;

export function costOf(model: string, u: {
  input_tokens?: number; output_tokens?: number;
  cache_read_input_tokens?: number; cache_creation_input_tokens?: number;
  web_search_requests?: number;
}): number | null {
  const p = PRICE[model];
  if (!p) return null;
  const input = (u.input_tokens ?? 0) + 1.25 * (u.cache_creation_input_tokens ?? 0) + 0.1 * (u.cache_read_input_tokens ?? 0);
  return (input * p[0] + (u.output_tokens ?? 0) * p[1]) / 1e6 + (u.web_search_requests ?? 0) * WEB_SEARCH_USD;
}

/**
 * A `fetch` for the Anthropic client that records every Messages call as a
 * `$ai_generation`: model, tokens, cost, latency, stop reason, the step it was
 * for. It reads the response's `usage` from a clone and never the content, and
 * hands the original response back untouched — the caller's parsing does not
 * know it is there.
 *
 *     new Anthropic({ apiKey, fetch: tracedFetch("intent") })
 */
export function tracedFetch(purpose: string): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const started = Date.now();
    let res: Response;
    try {
      res = await fetch(input, init);
    } catch (err) {
      if (url.includes("/v1/messages")) {
        traceEvent("$ai_generation", {
          $ai_provider: "anthropic",
          $ai_span_name: purpose,
          $ai_latency: (Date.now() - started) / 1000,
          $ai_is_error: true,
          error: "network",
          $ai_parent_id: store.getStore()?.spans.at(-1) ?? store.getStore()?.id ?? null,
        });
      }
      throw err;
    }
    if (!url.includes("/v1/messages") || url.includes("count_tokens")) return res;
    try {
      const body = (await res.clone().json()) as {
        model?: string;
        stop_reason?: string;
        usage?: {
          input_tokens?: number; output_tokens?: number;
          cache_read_input_tokens?: number; cache_creation_input_tokens?: number;
          server_tool_use?: { web_search_requests?: number; web_fetch_requests?: number };
        };
      };
      const u = body.usage ?? {};
      const model = String(body.model ?? "unknown");
      traceEvent("$ai_generation", {
        $ai_provider: "anthropic",
        $ai_model: model,
        $ai_span_name: purpose,
        $ai_parent_id: store.getStore()?.spans.at(-1) ?? store.getStore()?.id ?? null,
        $ai_input_tokens: (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0),
        $ai_output_tokens: u.output_tokens ?? 0,
        $ai_cache_read_input_tokens: u.cache_read_input_tokens ?? 0,
        $ai_cache_creation_input_tokens: u.cache_creation_input_tokens ?? 0,
        $ai_total_cost_usd: costOf(model, { ...u, web_search_requests: u.server_tool_use?.web_search_requests }),
        $ai_latency: (Date.now() - started) / 1000,
        $ai_http_status: res.status,
        $ai_is_error: !res.ok,
        stop_reason: body.stop_reason ?? null,
        web_searches: u.server_tool_use?.web_search_requests ?? 0,
        web_fetches: u.server_tool_use?.web_fetch_requests ?? 0,
      });
    } catch {
      /* A body we cannot read is still the caller's to handle; nothing is recorded. */
    }
    return res;
  }) as typeof fetch;
}

/* -------------------------------------------------------------------- logs */

/**
 * Every log line written inside a trace carries its id, and a line of the
 * house shape — `console.info("[sms:answer] queued", { … })`, enums and counts
 * by invariant 7 — is also an event of the trace (`pando_log`), so the
 * decisions the code already explains are on the trace without a second set of
 * calls. Installed once, on first import.
 */
const LOG_LINE = /^\[([a-z0-9:_-]+)\]\s*(.{0,60})$/i;
const installed = Symbol.for("pando.trace.console");
if (!(globalThis as Record<symbol, unknown>)[installed]) {
  (globalThis as Record<symbol, unknown>)[installed] = true;
  for (const level of ["info", "warn", "error"] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      const t = store.getStore();
      if (!t) return original(...args);
      original(`[t:${t.id.slice(0, 8)}]`, ...args);
      const head = typeof args[0] === "string" ? LOG_LINE.exec(args[0]) : null;
      if (head) {
        const detail = args[1] && typeof args[1] === "object" && !Array.isArray(args[1]) ? (args[1] as Record<string, unknown>) : {};
        capture(t, "pando_log", { level, tag: head[1], message: head[2].trim() || null, ...detail });
      }
    };
  }
}

/* -------------------------------------------------------------------- send */

const SEND_TIMEOUT_MS = 3000;

async function send(rows: Captured[], distinctId: string, personKnown: boolean): Promise<void> {
  const c = config();
  if (!c || rows.length === 0) return;
  try {
    const res = await fetch(`${c.host}/batch/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: c.key,
        batch: rows.map((r) => ({
          event: r.event,
          timestamp: r.timestamp,
          /* No person profile for a number Pando cannot name yet (a cold text, a job). */
          properties: { ...r.properties, distinct_id: distinctId, ...(personKnown ? {} : { $process_person_profile: false }) },
        })),
      }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
    if (!res.ok) process.stderr.write(`[trace] send refused ${JSON.stringify({ status: res.status })}\n`);
  } catch (err) {
    process.stderr.write(`[trace] send failed ${JSON.stringify({ error: err instanceof Error ? err.name : "unknown" })}\n`);
  }
}

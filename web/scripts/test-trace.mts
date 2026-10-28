/**
 * lib/server/trace.ts — the PostHog traces (27 Oct). No network: `fetch` is a
 * stand-in that plays both PostHog's /batch/ and Anthropic's /v1/messages.
 *
 * The suite's first job is invariant 7: nothing a parent wrote, and no phone,
 * leaves in a trace — not in a property, not in a model call, not as the person.
 */

/* lib/server/trace.ts carries `server-only`; Next's own empty stub stands in for it, as Next does on the server. */
type Resolve = (spec: string, ctx: unknown, next: (spec: string, ctx: unknown) => unknown) => unknown;
const { registerHooks } = (await import("node:module")) as unknown as { registerHooks: (hooks: { resolve: Resolve }) => void };
const stub = new URL("../node_modules/next/dist/compiled/server-only/empty.js", import.meta.url).href;
registerHooks({ resolve: (spec, ctx, next) => (spec === "server-only" ? { url: stub, format: "commonjs", shortCircuit: true } : next(spec, ctx)) });

let pass = 0;
let fail = 0;
const ok = (label: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? `  ${detail}` : ""}`); }
};

/* ---- the stand-in network ---- */
type Batch = { api_key: string; batch: Array<{ event: string; properties: Record<string, unknown> }> };
const batches: Batch[] = [];
let messagesCalls = 0;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.endsWith("/batch/")) {
    batches.push(JSON.parse(String(init?.body)) as Batch);
    return new Response(JSON.stringify({ status: 1 }), { status: 200 });
  }
  if (url.includes("/v1/messages")) {
    messagesCalls++;
    return new Response(JSON.stringify({
      model: "claude-haiku-5-5",
      stop_reason: "end_turn",
      content: [{ type: "text", text: "Maya said the teacher at Little Maestros is lovely, call +1 626 555 0001" }],
      usage: { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, server_tool_use: { web_search_requests: 2 } },
    }), { status: 200, headers: { "content-type": "application/json" } });
  }
  return new Response("not here", { status: 404 });
}) as typeof fetch;

process.env.POSTHOG_SERVER_KEY = "phc_test";
process.env.POSTHOG_SERVER_HOST = "https://posthog.test";
process.env.TRACE_ENVIRONMENT = "test";

const tr = (await import(`../lib/server/trace.ts?v=${Date.now()}`)) as typeof import("../lib/server/trace");

console.log("\n=== what may leave (invariant 7) ===");
{
  const { props, dropped } = tr.safeProps({
    intent: "ask_recommendation",
    model: "claude-haiku-5-5",
    used: 3,
    sensitive: false,
    template: "offer-2026-10-26",
    phone: "+16265550001",
    phone_spaced: "(626) 555-0001",
    words: "Maya said the teacher is lovely",
    long: "x".repeat(80),
    nested: { a: 1 } as unknown,
  });
  ok("enums, ids, numbers and booleans pass", props.intent === "ask_recommendation" && props.model === "claude-haiku-5-5" && props.used === 3 && props.sensitive === false && props.template === "offer-2026-10-26");
  ok("a phone, however written, is dropped", !("phone" in props) && !("phone_spaced" in props));
  ok("a sentence and a long string are dropped", !("words" in props) && !("long" in props) && !("nested" in props));
  ok("and the drop is counted, so a leak shows up as a number", dropped === 5, String(dropped));
  const k = tr.personKey("8873c507-ef17-4e6f-864f-43e48a7f0ed5");
  ok("a person is a one-way hash of their id", /^p_[0-9a-f]{24}$/.test(k) && k === tr.personKey("8873c507-ef17-4e6f-864f-43e48a7f0ed5") && k !== tr.personKey("another"));
}

console.log("\n=== cost ===");
ok("Haiku 5.5: $0.10 / $0.50 a million, $0.01 a search", Math.abs((tr.costOf("claude-haiku-5-5", { input_tokens: 1_000_000, output_tokens: 1_000_000, web_search_requests: 1 }) ?? 0) - 0.61) < 1e-9);
ok("Sonnet 5.5: $2 / $10", Math.abs((tr.costOf("claude-sonnet-5-5", { input_tokens: 1_000_000, output_tokens: 0 }) ?? 0) - 2) < 1e-9);
ok("an unknown model has no invented price", tr.costOf("some-model", { input_tokens: 10 }) === null);

console.log("\n=== one inbound text, end to end ===");
{
  batches.length = 0;
  await tr.withTrace("sms_inbound", async () => {
    console.info("[sms:inbound]", { keyword: "text", length: 52 });
    tr.traceIdentify("8873c507-ef17-4e6f-864f-43e48a7f0ed5");
    await tr.span("classify", async () => {
      const f = tr.tracedFetch("intent");
      const res = await f("https://api.anthropic.com/v1/messages", { method: "POST", body: "{}" });
      const body = (await res.json()) as { content: Array<{ text: string }> };
      ok("the caller still reads the model's answer untouched", body.content[0].text.startsWith("Maya said"));
      return { intent: "ask_recommendation" };
    }, (r) => ({ intent: r.intent }));
    /* A nested trace joins the outer one. */
    await tr.withTrace("job:thanks_prompt", async () => tr.traceEvent("answer_queued", { used: 2, hold: "not_held" }));
  });
  ok("one batch per trace, sent with the project key", batches.length === 1 && batches[0].api_key === "phc_test", String(batches.length));
  const ev = batches[0]?.batch ?? [];
  const by = (name: string) => ev.filter((e) => e.event === name);
  const traceId = by("$ai_trace")[0]?.properties.$ai_trace_id as string;
  ok("a trace, a span, a generation, a log line and an event", by("$ai_trace").length === 1 && by("$ai_span").length === 1 && by("$ai_generation").length === 1 && by("pando_log").length === 1 && by("answer_queued").length === 1, ev.map((e) => e.event).join(","));
  ok("every event carries the trace id", ev.every((e) => e.properties.$ai_trace_id === traceId));
  const span = by("$ai_span")[0]?.properties ?? {};
  const gen = by("$ai_generation")[0]?.properties ?? {};
  ok("the span hangs off the trace and the model call off the span (ids are whole UUIDs)", span.$ai_parent_id === traceId && gen.$ai_parent_id === span.$ai_span_id && typeof span.$ai_span_id === "string");
  ok("the generation has model, tokens, cost and the step", gen.$ai_model === "claude-haiku-5-5" && gen.$ai_input_tokens === 1000 && gen.$ai_output_tokens === 200 && gen.$ai_span_name === "intent" && Math.abs(Number(gen.$ai_total_cost_usd) - (1000 * 0.1 + 200 * 0.5) / 1e6 - 0.02) < 1e-9);
  ok("and never the model's input or output", !("$ai_input" in gen) && !("$ai_output_choices" in gen) && !("$ai_output" in gen));
  ok("the person is the hash, on every event, once known", ev.every((e) => e.properties.distinct_id === tr.personKey("8873c507-ef17-4e6f-864f-43e48a7f0ed5")) && ev.every((e) => !("$process_person_profile" in e.properties)));
  const json = JSON.stringify(batches);
  ok("nothing the model wrote and no phone is anywhere in what was sent", !json.includes("Maya") && /* The phone in every form it was given — not a bare "555", which a random id or hash contains often enough to fail now and then (28 Oct). */ !["6265550001", "626 555 0001", "555-0001"].some((p) => json.includes(p)) && !json.includes("Little Maestros"));
  ok("the log line became an event with its enums", by("pando_log")[0]?.properties.tag === "sms:inbound" && by("pando_log")[0]?.properties.keyword === "text");
}

console.log("\n=== a trace with nobody named ===");
{
  batches.length = 0;
  await tr.withTrace("job:freshness_ping", async () => tr.traceEvent("ran", { processed: 0 }));
  const ev = batches[0]?.batch ?? [];
  ok("no person profile, and a trace-scoped id rather than a person", ev.every((e) => e.properties.$process_person_profile === false && String(e.properties.distinct_id).startsWith("trace_")));
}

console.log("\n=== switched off ===");
{
  delete process.env.POSTHOG_SERVER_KEY;
  batches.length = 0;
  const before = messagesCalls;
  await tr.withTrace("sms_inbound", async () => {
    await tr.tracedFetch("intent")("https://api.anthropic.com/v1/messages", { method: "POST", body: "{}" });
  });
  ok("no key: nothing is sent, and the model call still goes through", batches.length === 0 && messagesCalls === before + 1 && !tr.isTracingConfigured());
}

console.log(`\n  ${pass} checks passed${fail > 0 ? `, ${fail} FAILED` : ""}.\n`);
process.exit(fail > 0 ? 1 : 0);

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
      const res = await f("https://api.anthropic.com/v1/messages", {
        method: "POST",
        body: JSON.stringify({
          system: "You classify a single SMS.",
          messages: [{ role: "user", content: [{ type: "text", text: "swim for Maya? call me at (626) 555-0001" }, { type: "image", source: { type: "base64", media_type: "image/png", data: "QUFBQUFBQUFB" } }] }],
        }),
      });
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
  /* Since 5 Nov, the developer's approved decision: the conversation, masked (invariant 7's one exception). */
  const input = JSON.stringify(gen.$ai_input ?? null);
  const output = JSON.stringify(gen.$ai_output_choices ?? null);
  ok("the model's input: the system prompt and the turns", input.includes("You classify a single SMS.") && input.includes("swim for Maya?"));
  ok("with phone numbers masked and a picture replaced by a marker, never its bytes",
    input.includes("[number]") && !input.includes("555-0001") && input.includes("[image omitted]") && !input.includes("QUFBQUFBQUFB"));
  ok("the model's output, masked the same way", output.includes("Maya said the teacher at Little Maestros") && output.includes("[number]") && !output.includes("555 0001"));
  ok("the person is the hash, on every event, once known", ev.every((e) => e.properties.distinct_id === tr.personKey("8873c507-ef17-4e6f-864f-43e48a7f0ed5")) && ev.every((e) => !("$process_person_profile" in e.properties)));
  const json = JSON.stringify(batches);
  ok("no phone is anywhere in what was sent", !["6265550001", "626 555 0001", "555-0001"].some((p) => json.includes(p)));
  const CONTENT = ["$ai_input", "$ai_output_choices", "$ai_input_state", "$ai_output_state"];
  ok("words appear only under the four content keys", ev.every((e) => Object.entries(e.properties).every(([k, v]) => CONTENT.includes(k) || !JSON.stringify(v ?? "").includes("Maya"))));
  ok("the log line became an event with its enums", by("pando_log")[0]?.properties.tag === "sms:inbound" && by("pando_log")[0]?.properties.keyword === "text");
}

console.log("\n=== the conversation, and its switch (5 Nov) ===");
{
  batches.length = 0;
  await tr.withTrace("sms_inbound", async () => {
    tr.traceContent({ said: "any swim lessons? text me at 626-555-0001" });
    tr.traceContent({ sent: "2 parents near you have used Rose Bowl Aquatics" });
  });
  const t = batches[0]?.batch.find((e) => e.event === "$ai_trace")?.properties ?? {};
  ok("the trace carries what the parent said and what Pando sent",
    t.$ai_input_state === "any swim lessons? text me at [number]" && t.$ai_output_state === "2 parents near you have used Rose Bowl Aquatics");
  ok("a field past the cap is cut and says so", String(tr.cleanContent("x".repeat(tr.CONTENT_MAX + 10))).includes("[cut at"));
  process.env.POSTHOG_TRACE_CONTENT = "off";
  batches.length = 0;
  await tr.withTrace("sms_inbound", async () => {
    tr.traceContent({ said: "any swim lessons?" });
    const f = tr.tracedFetch("intent");
    await f("https://api.anthropic.com/v1/messages", { method: "POST", body: JSON.stringify({ messages: [{ role: "user", content: "hello Maya" }] }) });
  });
  const offJson = JSON.stringify(batches);
  ok("POSTHOG_TRACE_CONTENT=off sends no words at all", !offJson.includes("swim lessons") && !offJson.includes("hello Maya") && !offJson.includes('"$ai_input"'));
  delete process.env.POSTHOG_TRACE_CONTENT;
}

console.log("\n=== each decision between model calls, readable (6 Nov) ===");
{
  batches.length = 0;
  await tr.withTrace("sms_inbound", async () => {
    await tr.span("retrieve", async () => {
      tr.traceState("answer_plan", { question: "swim lessons for a 7 year old, call 626-555-0001" }, { parents_found: ["Rose Bowl Aquatics"], web_dropped_not_fitting: ["Little Gym"] });
    });
  });
  const ev = batches[0]?.batch ?? [];
  const retrieve = ev.find((e) => e.event === "$ai_span" && e.properties.$ai_span_name === "retrieve")?.properties ?? {};
  const plan = ev.find((e) => e.event === "$ai_span" && e.properties.$ai_span_name === "answer_plan")?.properties ?? {};
  ok("a decision is a span under the step in hand", plan.$ai_parent_id === retrieve.$ai_span_id && typeof plan.$ai_span_id === "string");
  ok("carrying what it was given and what it chose, masked",
    JSON.stringify(plan.$ai_input_state).includes("swim lessons for a 7 year old, call [number]") &&
      JSON.stringify(plan.$ai_output_state).includes("Rose Bowl Aquatics") && JSON.stringify(plan.$ai_output_state).includes("Little Gym"));
  process.env.POSTHOG_TRACE_CONTENT = "off";
  batches.length = 0;
  await tr.withTrace("sms_inbound", async () => tr.traceState("answer_plan", { question: "swim lessons" }, { parents_found: ["Rose Bowl Aquatics"] }));
  ok("and nothing of it with the switch off", !JSON.stringify(batches).includes("swim lessons") && !JSON.stringify(batches).includes("Rose Bowl"));
  delete process.env.POSTHOG_TRACE_CONTENT;
}

console.log("\n=== a trace with nobody named ===");
{
  batches.length = 0;
  await tr.withTrace("job:freshness_ping", async () => tr.traceEvent("ran", { processed: 0 }));
  const ev = batches[0]?.batch ?? [];
  ok("no person profile, and a trace-scoped id rather than a person", ev.every((e) => e.properties.$process_person_profile === false && String(e.properties.distinct_id).startsWith("trace_")));
}

console.log("\n=== switched off ===");
console.log("\n=== each trace says what it was about and what it answered (29 Oct) ===");
{
  const traceOf = async (name: string, body: () => Promise<void>) => {
    batches.length = 0;
    await tr.withTrace(name, body);
    return batches[0]?.batch.find((e) => e.event === "$ai_trace")?.properties ?? {};
  };
  const sent = (template: string) => tr.span("send", async () => ({ sent: true }), () => ({ template, sent: true, category: "transactional" }));

  const read = await traceOf("sms_inbound", async () => {
    console.info("[sms:inbound]", { keyword: "text", length: 40 });
    console.info("[sms:inbound] read as", { intent: "ask_recommendation", source: "model", sensitive: false });
    console.info("[sms:answer] queued", { intent: "something_else_later" });
    await sent("answer_sent");
  });
  ok("a read text: the model's intent and its source", read.intent === "ask_recommendation" && read.intent_source === "model", JSON.stringify(read));
  ok("the first reading wins over a later line that mentions an intent", read.intent === "ask_recommendation");
  ok("the reply that went out, and how many", read.reply_template === "answer_sent" && read.replies === 1);
  ok("PostHog's input and output of the trace are the two enums", read.$ai_input_state === "ask_recommendation" && read.$ai_output_state === "answer_sent");
  ok("a plain text is not reported as a keyword", read.keyword === null);

  const stop = await traceOf("sms_inbound", async () => {
    console.info("[sms:inbound]", { keyword: "opt_out", length: 4 });
  });
  ok("a keyword with no reply: the keyword is the intent", stop.intent === "opt_out" && stop.intent_source === "keyword" && stop.replies === 0 && stop.$ai_output_state === null);

  const settings = await traceOf("sms_inbound", async () => {
    console.info("[sms:inbound]", { keyword: "text", length: 8 });
    await sent("settings");
  });
  ok("SETTINGS, read by no model: told by its reply, and marked so", settings.intent === "settings" && settings.intent_source === "reply" && settings.reply_template === "settings");

  const refused = await traceOf("sms_inbound", async () => {
    await tr.span("send", async () => ({ sent: false }), () => ({ template: "answer_sent", sent: false }));
  });
  ok("a reply that did not go out is not the reply", refused.reply_template === null && refused.replies === 0);

  const job = await traceOf("job:freshness_ping", async () => {
    await sent("freshness_ping");
    await sent("freshness_ping");
  });
  ok("a job is not given an intent; its texts are counted", job.intent === null && job.intent_source === null && job.reply_template === "freshness_ping" && job.replies === 2);

  ok(
    "reply families, written out",
    tr.replyFamily("settings_confirmed") === "settings" &&
      tr.replyFamily("capture_kind") === "capture" &&
      tr.replyFamily("clarify_child_age") === "clarification" &&
      tr.replyFamily("deep_dive_started") === "deep_dive" &&
      tr.replyFamily("intro_requested") === "intro" &&
      tr.replyFamily("ask_not_started") === "ask_offer_reply" &&
      tr.replyFamily("freshness_reply_saved") === "freshness_reply" &&
      tr.replyFamily("opener") === "opener",
  );
  const all = JSON.stringify([read, stop, settings, job]);
  /* The name and the phone in every form the suite uses — not a bare "555" or
     "+1", which a random trace id or a duration contains often enough to fail
     CI now and then (Deploy #139, 4 Nov; line 106 was fixed the same way on
     28 Oct). */
  ok(
    "still nothing but enums and counts on the trace",
    !["Maya", "6265550001", "626 555 0001", "555-0001"].some((p) => all.includes(p)),
  );
}

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

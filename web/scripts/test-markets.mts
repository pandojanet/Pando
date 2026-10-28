/**
 * test:markets — one place for what a market is, and nothing written in twice (27 Oct).
 *
 * The pilot market used to be written into the code wherever it was needed. This
 * suite holds the registry (lib/markets.ts) and the model table (lib/models.ts)
 * together with the modules that may not import them, and scans the source so a
 * new `?? "pasadena"`, a time zone, a model id, a local crisis line or a policy
 * window typed into SQL fails here instead of surfacing when a second market opens.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

let pass = 0;
let fail = 0;
const ok = (label: string, cond: boolean, detail = "") => {
  if (cond) {
    pass++;
    console.log(`  ok    ${label}`);
  } else {
    fail++;
    console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ""}`);
  }
};
const fresh = <T,>(p: string) => import(`${p}?v=${Date.now()}`) as Promise<T>;

const mk = await fresh<typeof import("../lib/markets.ts")>("../lib/markets.ts");
const models = await fresh<typeof import("../lib/models.ts")>("../lib/models.ts");
const answer = await fresh<typeof import("../lib/answer.ts")>("../lib/answer.ts");
const trust = await fresh<typeof import("../lib/trust-labels.ts")>("../lib/trust-labels.ts");
const provider = await fresh<typeof import("../lib/provider-check.ts")>("../lib/provider-check.ts");
const geo = await fresh<typeof import("../lib/geo.ts")>("../lib/geo.ts");

console.log("\n=== the registry ===");
const def = mk.marketConfig();
ok("the default market is in the registry", mk.isMarketId(mk.DEFAULT_MARKET_ID) && def.id === mk.DEFAULT_MARKET_ID);
ok("an unknown or missing id is the default market", mk.marketConfig("detroit").id === def.id && mk.marketConfig(null).id === def.id && mk.marketConfig(" PASADENA ").id === "pasadena");
const PHONE = /^1-\d{3}-\d{3}-\d{4}$/;
for (const m of Object.values(mk.MARKETS)) {
  ok(`${m.id}: a real IANA zone`, (() => { try { new Intl.DateTimeFormat("en-US", { timeZone: m.timeZone }); return true; } catch { return false; } })(), m.timeZone);
  ok(`${m.id}: a two-letter state and its name`, /^[A-Z]{2}$/.test(m.state) && m.stateName.length > 2);
  ok(`${m.id}: a search rectangle the right way round`, m.sw.lat < m.ne.lat && m.sw.lng < m.ne.lng);
  ok(`${m.id}: the local lines are phone numbers`, (PHONE.test(m.crisis.nurseLine.phone) || /^\d{3}$/.test(m.crisis.nurseLine.phone)) && PHONE.test(m.crisis.legalHelp.phone) && PHONE.test(m.crisis.childProtection.phone));
  /* The names go into SMS: plain ASCII keeps a reply GSM-7 (one curly apostrophe triples the segments). */
  ok(`${m.id}: names and zone in plain ASCII`, [m.crisis.nurseLine.name, m.crisis.legalHelp.name, m.crisis.childProtection.name, m.timeZoneName, m.city, m.label].every((s) => /^[\x20-\x7e]+$/.test(s)));
}

console.log("\n=== quiet hours, on the parent's clock ===");
const at = (iso: string) => new Date(iso);
/* 26 Oct 2026 is PDT (UTC-7): 15:00Z = 08:00 PT, 04:00Z next day = 21:00 PT. */
ok("07:59 Pacific is quiet", mk.isQuietHoursIn("America/Los_Angeles", at("2026-10-26T14:59:00Z")));
ok("08:00 Pacific is open", !mk.isQuietHoursIn("America/Los_Angeles", at("2026-10-26T15:00:00Z")));
ok("20:59 Pacific is open", !mk.isQuietHoursIn("America/Los_Angeles", at("2026-10-27T03:59:00Z")));
ok("21:00 Pacific is quiet", mk.isQuietHoursIn("America/Los_Angeles", at("2026-10-27T04:00:00Z")));
ok("midnight reads as hour 0, not 24", mk.hourIn("America/Los_Angeles", at("2026-10-27T07:00:00Z")) === 0);
ok("the same instant can be open in New York and quiet in Los Angeles", !mk.isQuietHoursIn("America/New_York", at("2026-10-26T12:30:00Z")) && mk.isQuietHoursIn("America/Los_Angeles", at("2026-10-26T12:30:00Z")));
ok("an unreadable market is quiet wherever any market is", mk.isQuietHoursAnywhere(at("2026-10-26T14:59:00Z")) && !mk.isQuietHoursAnywhere(at("2026-10-26T18:00:00Z")));
ok("the window reads as the copy always did", mk.quietWindowPhrase() === "8am-9pm Pacific" && mk.quietWindowPhrase(def, "–") === "8am–9pm Pacific");
const sms = readFileSync("lib/server/sms.ts", "utf8");

console.log("\n=== the sender ===");
ok("the default market sends from the service the deploy already sets", def.messagingServiceEnv === "TWILIO_MESSAGING_SERVICE_SID");
ok("every market names an environment variable", Object.values(mk.MARKETS).every((m) => /^[A-Z][A-Z0-9_]+$/.test(m.messagingServiceEnv)));
ok("while every market shares a sender, the send layer reads no market to pick it", mk.ONE_SENDER === (new Set(Object.values(mk.MARKETS).map((m) => m.messagingServiceEnv)).size === 1) &&
  sms.includes("const senderMarket = ONE_SENDER\n    ? null") && sms.includes(": await marketIdForPhone(to);"));
ok("always a Messaging Service, never a number (invariant 6)", sms.includes("MessagingServiceSid: service,") && !/["']?\bFrom["']?\s*[:,]|\(\s*["']From["']/.test(sms));
ok("the send layer fails closed when the market cannot be read", sms.includes("isMarketId(marketId)") && sms.includes(": isQuietHoursAnywhere();"));

console.log("\n=== modules that may not import the registry agree with it ===");
ok("answer.ts dates on the default market's clock", answer.ANSWER_TIME_ZONE === def.timeZone);
ok("trust labels' fallback clock is the default market's", trust.LABEL_TIME_ZONE === def.timeZone);
ok("a caller's clock is used when given", trust.lastConfirmedLabel("2026-11-01T06:00:00Z", "America/New_York") === "Last confirmed Nov 2026" && trust.lastConfirmedLabel("2026-11-01T06:00:00Z") === "Last confirmed Oct 2026");
ok("NPPES searches the default market's state and city", provider.NPPES_DEFAULT_STATE === def.state && provider.NPPES_FALLBACK_CITY === def.city);
ok("and another market's when the server passes it", provider.npiQuery("Dr Jane Smith", null, "IL")?.get("state") === "IL" && provider.npiCities(null, "Evanston").join() === "Evanston");
ok("geo.ts's fallback state is the default market's", geo.GEO_DEFAULT_STATE === def.state);

console.log("\n=== models and prices ===");
for (const [role, id] of Object.entries(models.MODELS)) {
  ok(`${role} (${id}) has a price`, Boolean(models.MODEL_PRICES[id]));
}

console.log("\n=== nothing written in twice ===");
const files: string[] = [];
const walk = (dir: string) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(ts|tsx)$/.test(name)) files.push(p.replace(/\\/g, "/"));
  }
};
for (const d of ["lib", "app", "components"]) walk(d);
/* Code only: comment lines are prose about the rule, not the rule. */
const code = (f: string) =>
  readFileSync(f, "utf8")
    .split(/\r?\n/)
    .map((l, i) => ({ l, n: i + 1 }))
    .filter(({ l }) => !/^\s*(\/\/|\*|\/\*)/.test(l));
const hits = (re: RegExp, allowed: readonly string[]) =>
  files.filter((f) => !allowed.includes(f)).flatMap((f) => code(f).filter(({ l }) => re.test(l)).map(({ n }) => `${f}:${n}`));

/* Any quote style, and the SQL and URL spellings (27 Oct review: coalesce(p.market_id, 'pasadena') passed a double-quote scan). */
const Q = `["'\`]`;
const marketFallback = hits(new RegExp(`(\\?\\?|\\|\\|)\\s*${Q}pasadena${Q}|coalesce\\([^)]*,\\s*'pasadena'\\)|market_id=pasadena`), []);
ok("no default market typed in (?? / || / coalesce / a URL)", marketFallback.length === 0, marketFallback.join(", "));
const zones = hits(new RegExp(`${Q}America/[A-Za-z_]+${Q}`), ["lib/markets.ts", "lib/answer.ts", "lib/trust-labels.ts"]);
ok("no time zone outside the registry (and the two pinned fallbacks)", zones.length === 0, zones.join(", "));
const modelIds = hits(new RegExp(`${Q}claude-(haiku|sonnet|opus|fable)-\\d`), ["lib/models.ts"]);
ok("no model id outside lib/models.ts", modelIds.length === 0, modelIds.join(", "));
const localLines = hits(/1-800-\d{3}-\d{4}|LA County/, ["lib/markets.ts"]);
ok("no local crisis line outside the registry", localLines.length === 0, localLines.join(", "));
const policySql = ["lib/server/repo/outreach.ts", "lib/server/repo/blast.ts", "lib/server/repo/admin-read.ts"]
  .flatMap((f) => code(f).filter(({ l }) => /sent_at >=? now\(\) - (interval '\d+ (day|days|month|months)'|make_interval\(days => \d+\))/.test(l)).map(({ n }) => `${f}:${n}`));
ok("the allowance, weekly and governor windows in SQL are the policy's constants", policySql.length === 0, policySql.join(", "));
const standing = readFileSync("lib/server/repo/admin-read.ts", "utf8");
ok("the admin's asked counts use the allowance window, as the send layer does", /ALLOWANCE_WINDOW_DAYS\}\)\)::int\s+as asked_30/.test(standing) && !/RESPONSE_WINDOW_DAYS\}\)\)(::int)?\s+as asked_30/.test(standing));

console.log(`\n  ${pass} checks passed${fail > 0 ? `, ${fail} FAILED` : ""}.\n`);
process.exit(fail > 0 ? 1 : 0);

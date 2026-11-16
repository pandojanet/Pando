/**
 * A parent's older SMS exchanges as a structured memory (12 Nov): what may be
 * folded, that only allowed values can be stored whatever the model returns,
 * how asks merge, and the wiring that keeps it out of the log, deletes it with
 * the person, clears it on STOP and never rebuilds it from before a STOP.
 */
import fs from "node:fs";

let pass = 0;
let fail = 0;
const ok = (label: string, cond: boolean, detail = "") => {
  if (cond) {
    pass++;
    console.log(`  ok    ${label}`);
  } else {
    fail++;
    console.log(`  FAIL  ${label}${detail ? `  ${detail}` : ""}`);
  }
};
const read = (p: string) => fs.readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

const m = (await import(`../lib/conversation-memory.ts?v=${Date.now()}`)) as typeof import("../lib/conversation-memory.ts");
const demand = (await import(`../lib/demand.ts?v=${Date.now()}`)) as typeof import("../lib/demand.ts");
const sensitive = (text: string) => demand.classifyDemand(text, null) !== "ordinary";
type Exchange = import("../lib/conversation-memory.ts").MemoryExchange;

const x = (question: string, answer = "Parents near you like Rose Bowl Aquatics and the Pasadena Swim Academy.", over: Partial<Exchange> = {}): Exchange => ({
  question,
  answer,
  status: "sent",
  hold_reason: "not_held",
  on: "2026-11-01",
  ...over,
});
const AREAS = ["Pasadena", "Altadena", "Arcadia", "South Pasadena", "Temple City"];

console.log("\n=== what may be folded ===");
ok("an ordinary question that went out", m.mayFold(x("any good swim lessons for my 6 year old near Pasadena?"), sensitive));
ok("never one held for a person: sensitive or caregiver (the routing holds both)",
  !m.mayFold(x("swim classes?", undefined, { hold_reason: "sensitive" }), sensitive) &&
    !m.mayFold(x("a sitter for Fridays?", undefined, { hold_reason: "caregiver" }), sensitive));
ok("never one that did not go out", !m.mayFold(x("swim classes?", undefined, { status: "pending" }), sensitive));
ok("never health, even if it went out unheld", !m.mayFold(x("my son keeps getting ear infections, which ENT?"), sensitive));
const REVIEW = [
  "speech therapy near Pasadena for my 4 year old",
  "do you have sliding scale or scholarship swim lessons? we can't afford much",
  "camps for kids who are deaf",
  "any sunday school or hebrew school classes",
  "classes in spanish, we are latino",
  "my husband passed away last year, any dad-and-me classes",
  "we are two moms looking for toddler gym",
  "single mom here, after school care near Lincoln Elementary",
  "my ex and I share kids, weekend camps?",
  "occupational therapy and a camp for kids with down syndrome",
  "cerebral palsy friendly pool",
  "wheelchair accessible playground",
  "our son is on the spectrum",
  "kids foster care adoption support groups swim",
  "we're on calfresh/EBT, free camps?",
  "kid is bullied at school, martial arts?",
  "ICE raids worry us, where are safe parks?",
  "mi hijo tiene autismo, hay clases de natacion?",
];
const leaked = REVIEW.filter((q) => m.mayFold(x(q), sensitive));
ok("the blind review's phrasings are kept out before the model sees them", leaked.length === 0, JSON.stringify(leaked));
ok("a town named for a temple is not religion", m.mayFold(x("anything fun in Temple City this weekend?"), sensitive));
ok("an empty question or answer is nothing", !m.mayFold(x(" "), sensitive) && !m.mayFold(x("swim?", " "), sensitive));

console.log("\n=== whatever the model returns, only allowed values are kept ===");
const ex = [x("any good swim lessons near Pasadena on weekends?"), x("what about art classes?", "Try the Armory Center for the Arts.")];
const kept = m.readMemoryAsks({ asks: [
  { exchange: 1, topic: "swim lessons", area: "Pasadena", when: ["weekends"], reaction: "liked a suggestion" },
  { exchange: 2, topic: "art classes", area: "", when: [], reaction: "" },
] }, ex, AREAS);
ok("an honest answer is kept as given",
  kept.length === 2 && kept[0].topic === "swim lessons" && kept[0].area === "Pasadena" && kept[0].when.join() === "weekends" &&
    kept[0].reaction === "liked a suggestion" && kept[1].area === null && kept[1].reaction === null && kept[0].on === "2026-11-01",
  JSON.stringify(kept));
/* The second review's answer: a parent's tip naming children, a home daycare's owner, faith and community centres. */
const tipAnswer = "A parent in Silver Lake says her son Emma's brother Jake struggles with reading and loved Sunrise Swim. Try Temple Beth El Preschool, the Korean Community Center, Lisa Cheng's Home Daycare, Islamic Center Kids Club, Planned Parenthood, Rosa Parks Park.";
const hostile = m.readMemoryAsks({ asks: [
  { exchange: 1, topic: "speech therapy", area: "Pasadena", when: [], reaction: "" },
  { exchange: 1, topic: "tutoring", area: "450 Oak Street", when: ["when Emma is free"], reaction: "too expensive",
    suggested: ["Jake", "Emma", "Lisa Cheng's Home Daycare", "Islamic Center Kids Club", "her son Emma's brother Jake struggles with reading"], note: "single mom, latino family" },
  { exchange: 1, topic: "swim lessons", area: "Pasadena", when: [], reaction: "too expensive", suggested: ["Korean Community Center"] },
  { exchange: 9, topic: "swim lessons", area: "Pasadena", when: [], reaction: "" },
] }, [x("swim?", tipAnswer)], AREAS);
const stored = JSON.stringify(hostile);
ok("nothing but the allowed values survives: no name, place, note, money or off-list topic (second review, 12 Nov)",
  hostile.length === 1 && hostile[0].topic === "swim lessons" && hostile[0].reaction === null &&
    !/Jake|Emma|Lisa|Islamic|Korean|Temple|Planned|single|latino|Oak|tutoring|therapy|expensive|suggested|note/.test(stored), stored);
ok("no name of any kind is kept, not even an approved record's (third review, 12 Nov: \"Special Olympics Soccer\", \"Chabad Kids Club\")",
  !JSON.stringify(m.readMemoryAsks({ asks: [{ exchange: 1, topic: "soccer", area: "", when: [], reaction: "", places: ["Special Olympics Soccer"] }] }, [x("soccer?", "Try Special Olympics Soccer.")], AREAS)).includes("Special"));
ok("not a list at all is nothing", m.readMemoryAsks("They are a single mom.", ex, AREAS).length === 0 && m.readMemoryAsks({ asks: "x" }, ex, AREAS).length === 0);
ok("no reaction is about money, no topic about how a child is doing or a community",
  !(m.MEMORY_REACTIONS as readonly string[]).includes("too expensive") && !/tutoring|reading|language/.test(m.MEMORY_TOPICS.join("|")));

console.log("\n=== merging, re-checking, showing ===");
const a = (topic: string, area: string | null, on: string, reaction: string | null = null) =>
  ({ topic, area, when: [], reaction, on }) as import("../lib/conversation-memory.ts").MemoryAsk;
const merged = m.mergeMemory([a("swim lessons", "Pasadena", "2026-10-01", "liked a suggestion")], [a("swim lessons", "Pasadena", "2026-11-01", "already tried"), a("chess", null, "2026-11-02")]);
ok("one per topic and area, the newer wins",
  merged.length === 2 && merged[0].on === "2026-11-01" && merged[0].reaction === "already tried" && merged[1].topic === "chess");
ok("a follow-up that names no area joins the latest ask on its topic (the lab: signed up for chess)",
  (() => { const r = m.mergeMemory([a("chess", "Arcadia", "2026-10-29"), a("art classes", null, "2026-10-30")], [a("chess", null, "2026-10-31", "booked or signed up")]);
    return r.length === 2 && r[1].topic === "chess" && r[1].area === "Arcadia" && r[1].reaction === "booked or signed up" && r[1].on === "2026-10-31"; })());
ok("a new area on the same topic is its own ask", m.mergeMemory([a("swim lessons", "Altadena", "2026-10-21")], [a("swim lessons", "South Pasadena", "2026-10-22", "too far")]).length === 2);
ok("at most thirty, the oldest go", m.mergeMemory([], Array.from({ length: 40 }, (_, i) => a(m.MEMORY_TOPICS[i], null, "2026-11-01"))).length === m.MEMORY_MAX_ASKS);
const now = new Date("2026-11-10T12:00:00Z");
ok("a stored row is re-checked on read: anything off the lists is dropped, and any name it once held",
  JSON.stringify(m.validMemory([{ topic: "swim lessons", area: "450 Oak Street", when: ["weekends", "Tuesdays after therapy"], suggested: ["Coach Dave"], reaction: "too expensive", on: "2026-11-01" },
    { topic: "speech therapy", on: "2026-11-01" }, "free text"], AREAS, now)) ===
    JSON.stringify([{ topic: "swim lessons", area: null, when: ["weekends"], reaction: null, on: "2026-11-01" }]));
ok("each ask is dropped 90 days after it was asked, whatever else was added since",
  m.validMemory([{ topic: "chess", area: null, when: [], reaction: null, on: "2026-07-01" }, { topic: "chess", area: null, when: [], reaction: null, on: "2026-10-01" }], AREAS, now).length === 1);
const line = m.memoryLine(kept)!;
ok("the classifier's line is built from the allowed values only",
  line.includes("- 2026-11-01: swim lessons (Pasadena, weekends); about an earlier suggestion: liked a suggestion") && m.memoryLine([]) === null);
ok("the model is told to pick from the lists and given them", /never write anything in your own words/i.test(m.memoryPrompt(ex, AREAS).system) &&
  m.memoryPrompt(ex, AREAS).user.includes("Allowed topics: swim lessons") && m.memoryPrompt(ex, AREAS).user.includes("Allowed areas: Pasadena"));
ok("the answer schema's enums are the lists", m.MEMORY_SCHEMA.properties.asks.items.properties.topic.enum.length === m.MEMORY_TOPICS.length &&
  m.MEMORY_SCHEMA.properties.asks.items.properties.reaction.enum.includes(""));
ok("no topic names health, therapy, care, faith or community", !m.MEMORY_TOPICS.some((t) => sensitive(t) || m.privateIn(t) || /care|sitter|nanny|doctor|dentist/.test(t)));
ok("kept 90 days from the last addition",
  !m.memoryExpired(new Date("2026-09-01"), new Date("2026-11-10")) && m.memoryExpired(new Date("2026-08-01"), new Date("2026-11-10")) && m.MEMORY_IDLE_DAYS === 90);

console.log("\n=== the table, the wiring, the job ===");
const migration = read("drizzle/0066_conversation_summaries.sql");
ok("one row per person, deleted with the person, no free-text column, capped, locked away from the browser roles",
  /person_id\s+uuid PRIMARY KEY REFERENCES people\(id\) ON DELETE CASCADE/.test(migration) && !/\btext NOT NULL CHECK/.test(migration) &&
    /jsonb_array_length\(asks\) <= 30/.test(migration) && /ENABLE ROW LEVEL SECURITY/.test(migration) &&
    /REVOKE ALL ON conversation_summaries FROM anon, authenticated/.test(migration));
ok("and it is in the journal", /"tag": "0066_conversation_summaries"/.test(read("drizzle/meta/_journal.json")));
const repo = read("lib/server/repo/conversation-memory.ts");
ok("only what mayFold allows is sent to the model, and only readMemoryAsks' output is stored",
  /const foldable = exchanges\.filter\(\(x\) => mayFold\(x, sensitive\)\);/.test(repo) && /else added = readMemoryAsks\(JSON\.parse\(text\), foldable, areas\);/.test(repo) &&
    /mergeMemory\(validMemory\(previous, areas\), added\)/.test(repo) && !/share_ids|shares/.test(repo));
ok("a failed call is not tried again on every text (second review): the cursor moves, nothing is added",
  /let callFailed = false;/.test(repo) && /callFailed \? "failed"/.test(repo));
ok("never folded again from before covers_through, the last real STOP, or 90 days (review: STOP then START rebuilt it)",
  /\(select covers_through from conversation_summaries where person_id/.test(repo) &&
    /where phone = \$\{phone\} and \(opted_in_at is null or opted_in_at > opted_out_at\)\),/.test(repo) &&
    /now\(\) - make_interval\(days => \$\{MEMORY_IDLE_DAYS\}::int\)\s+\)::text as floor/.test(repo));
ok("never written while they are opted out, nor after a STOP that came while it ran (reviews: a fold running at STOP wrote it back)",
  /where not exists \(\s+select 1 from sms_opt_outs o/.test(repo) && /or o\.opted_out_at > \$\{started\}::timestamptz\)\)/.test(repo));
ok("the window is what the next reading shows: the twelve newest already there (review: thirteen left one in neither)",
  /offset \$\{EARLIER_EXCHANGES - 1\} limit 1\)::text as twelfth/.test(repo));
ok("one fold per person at a time", /if \(folding\.has\(personId\)\) return "busy";/.test(repo) && /finally \{\s+folding\.delete\(personId\);/.test(repo));
ok("the fast model, from the registry", /model: MODELS\.fast/.test(repo) && !/claude-(haiku|sonnet|opus)/.test(repo));
const logs = [...repo.matchAll(/console\.info\("\[memory\] fold", (\{[^}]*\})\)/g)].map((c) => c[1]);
ok("it logs counts and enums only (invariant 7): every logged value is a count or the outcome",
  logs.length === 3 && logs.every((l) => [...l.matchAll(/(\w+): ([^,}]+)/g)].every(([, , v]) => /^(outcome|"[a-z_]+"|\w+\.length)$/.test(v.trim()))), JSON.stringify(logs));
const inbound = read("lib/server/inbound.ts");
ok("STOP clears it", /await setOptOut\(from, "out", body\);\s+\/\*[^*]*\*\/\s+await forgetMemory\(from\);/.test(inbound));
ok("the classifier is shown it in both readings, and the fold never holds up the turn",
  /memory: exchange && !exchange\.held \? await memoryFor\(person\.person_id\) : \[\],/.test(inbound) &&
    /const memory = exchange && !exchange\.held \? await memoryFor\(person\?\.person_id\) : \[\];/.test(inbound) &&
    /if \(person\) void foldMemory\(person\.person_id, from\);/.test(inbound));
ok("the classifier puts it first, before the verbatim exchanges", /content: \[\s+memoryLine\(input\.memory\),/.test(read("lib/server/intent.ts")));
ok("a daily job deletes what is idle, and sends nothing",
  /expire_memory: \{\s+name: "expire_memory",\s+min_interval_minutes: 60 \* 23,\s+sends: false,/.test(read("lib/jobs.ts")) &&
    /expire_memory,\n/.test(read("lib/server/repo/jobs.ts")) && /expire_memory/.test(read("../deploy/.env.example")));

console.log(`\n  ${pass} checks passed${fail ? `, ${fail} FAILED` : ""}.`);
if (fail) process.exit(1);

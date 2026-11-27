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
const read = (p: string) => fs.readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

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

console.log("\n=== a kind of activity the list does not have (27 Nov) ===");
{
  const open = (other: string, question = "any fencing lessons near Pasadena?", answer = "Try the fencing club in Pasadena.") =>
    m.readMemoryAsks({ asks: [{ exchange: 1, topic: "other", other_topic: other, area: "", when: [], reaction: "" }] }, [x(question, answer)], AREAS, sensitive);
  ok("a plain generic kind is kept, marked open", open("fencing")[0]?.topic === "fencing" && open("fencing")[0]?.open === true);
  ok("two words too", open("scuba diving", "scuba diving for kids?", "Try a dive shop.")[0]?.topic === "scuba diving");
  ok("a name the exchange wrote with a capital is a proper noun: refused (the 12 Nov failures)",
    open("kesem", "is Camp Kesem good?", "Camp Kesem runs in summer.").length === 0 && open("chabad kids", "tell me about Chabad Kids Club", "It meets on Sundays.").length === 0);
  ok("a word a business put in its name is still a kind when the exchange also writes it lowercase (the SMS lab, 27 Nov)",
    open("fencing", "any fencing lessons near Pasadena?", "Swords Fencing Studio, youth fencing classes and camps in Pasadena.")[0]?.topic === "fencing");
  ok("a capital only at the start of a sentence is not a name", open("fencing", "Fencing lessons near Pasadena?", "Try a club.")[0]?.topic === "fencing");
  ok("nothing sensitive, private, about a language, a faith, a community or how a child is doing",
    ["speech therapy", "korean classes", "hebrew lessons", "bible study", "math tutoring", "reading help", "spanish immersion", "special needs swim"].every((o) => open(o, `${o}?`, "Here are some.").length === 0));
  ok("a business word, an area, a digit or more than four words: refused",
    ["fencing studio", "pasadena fencing", "fencing 101", "a very long kind of activity"].every((o) => open(o, `${o}?`, "Here.").length === 0));
  ok("a name that is a listed topic in other words becomes that topic", open("horse dressage", "horse dressage lessons?", "Try a stable.")[0]?.topic === "horse riding" && open("horse dressage", "horse dressage lessons?", "Try a stable.")[0]?.open === false);
  ok("the schema offers \"other\" and asks for its name", (m.MEMORY_SCHEMA.properties.asks.items.properties.topic.enum as readonly string[]).includes("other") && "other_topic" in m.MEMORY_SCHEMA.properties.asks.items.properties);
}

console.log("\n=== merging, re-checking, showing ===");
const a = (topic: string, area: string | null, on: string, reaction: string | null = null, open = false) =>
  ({ topic, open, area, when: [], reaction, on }) as import("../lib/conversation-memory.ts").MemoryAsk;
const merged = m.mergeMemory([], [a("swim lessons", "Pasadena", "2026-10-01", "liked a suggestion"), a("swim lessons", "Arcadia", "2026-11-01", "already tried"), a("chess", null, "2026-11-02")]);
ok("one entry per topic, its asks counted, every area kept, the latest reaction holding (27 Nov: nothing forgotten)",
  merged.length === 2 && merged[0].topic === "swim lessons" && merged[0].times === 2 && merged[0].first === "2026-10-01" && merged[0].last === "2026-11-01" &&
    merged[0].areas.join() === "Pasadena,Arcadia" && merged[0].reaction === "already tried" && merged[1].topic === "chess", JSON.stringify(merged));
ok("a follow-up that names no area keeps the areas it had (the lab: signed up for chess)",
  (() => { const r = m.mergeMemory(m.mergeMemory([], [a("chess", "Arcadia", "2026-10-29"), a("art classes", null, "2026-10-30")]), [a("chess", null, "2026-10-31", "booked or signed up")]);
    return r.length === 2 && r[1].topic === "chess" && r[1].areas.join() === "Arcadia" && r[1].reaction === "booked or signed up" && r[1].last === "2026-10-31" && r[1].times === 2; })());
ok("a topic is never pushed out by newer ones: forty topics are forty entries",
  m.mergeMemory([], Array.from({ length: 40 }, (_, i) => a(i < m.MEMORY_TOPICS.length ? m.MEMORY_TOPICS[i] : `open topic ${"abcdefghij"[i % 10]}`, null, "2026-11-01"))).length === 40);
ok("only past the bound (150) does the one asked about longest ago go",
  (() => { const many = Array.from({ length: 160 }, (_, i) => a(`kind ${"abcdefghijklmnop"[Math.floor(i / 10)]}${"abcdefghij"[i % 10]}`, null, `2026-${String(1 + Math.floor(i / 28)).padStart(2, "0")}-${String(1 + (i % 28)).padStart(2, "0")}`, null, true));
    const r = m.mergeMemory([], many); return r.length === m.MEMORY_MAX_INTERESTS && r[0].topic === many[10].topic; })());
const now = new Date("2026-11-10T12:00:00Z");
ok("a stored row is re-checked on read: anything off the lists is dropped, and any name it once held; the 12–26 Nov shape is read and merged",
  JSON.stringify(m.validMemory([{ topic: "swim lessons", area: "450 Oak Street", when: ["weekends", "Tuesdays after therapy"], suggested: ["Coach Dave"], reaction: "too expensive", on: "2026-11-01" },
    { topic: "speech therapy", on: "2026-11-01" }, { topic: "Camp Kesem", on: "2026-11-01" }, "free text"], AREAS, now)) ===
    JSON.stringify([{ topic: "swim lessons", open: false, times: 1, first: "2026-11-01", last: "2026-11-01", areas: [], when: ["weekends"], reaction: null }]));
ok("the kept shape reads back as it was written", (() => { const w = m.mergeMemory([], [a("swim lessons", "Pasadena", "2026-10-01"), a("fencing", null, "2026-10-02", null, true)]);
  return JSON.stringify(m.validMemory(JSON.parse(JSON.stringify(w)), AREAS, now)) === JSON.stringify(w); })());
ok("an interest is dropped a year after it was last asked about, whatever else was added since (27 Nov: was 90 days)",
  m.validMemory([{ topic: "chess", times: 3, first: "2025-09-01", last: "2025-10-01", areas: [], when: [], reaction: null }, { topic: "soccer", times: 1, first: "2026-01-01", last: "2026-01-01", areas: [], when: [], reaction: null }], AREAS, now).map((i) => i.topic).join() === "soccer");
{
  const long = m.mergeMemory([], [
    ...Array.from({ length: 20 }, (_, i) => a(m.MEMORY_TOPICS[i], null, `2026-10-${String(1 + i).padStart(2, "0")}`)),
    a("swim lessons", "Pasadena", "2026-09-01", "liked a suggestion"), a("swim lessons", null, "2026-09-02"),
  ]);
  const shown = m.memoryLine(long, "going back to the swim lessons — which is cheapest?")!;
  ok("the classifier sees the interests the message touches first, then the latest, at most twelve — and how many more",
    shown.split("\n")[1].startsWith("- swim lessons (Pasadena): asked 3 times, first 2026-09-01, last 2026-10-01; about an earlier suggestion: liked a suggestion") && shown.split("\n").filter((l) => l.startsWith("- ")).length === m.MEMORY_LINES && /\(and \d+ other topics asked about before\)/.test(shown), shown);
  ok("built from the allowed values only", m.memoryLine([]) === null && !/[A-Z][a-z]+ (Street|Club)/.test(shown));
}
ok("the model is told to pick from the lists and given them", /never write anything in your own words/i.test(m.memoryPrompt(ex, AREAS).system) &&
  m.memoryPrompt(ex, AREAS).user.includes("Allowed topics: swim lessons") && m.memoryPrompt(ex, AREAS).user.includes("Allowed areas: Pasadena") &&
  /never the name of a place, business, school, team, group or person/.test(m.memoryPrompt(ex, AREAS).system));
ok("the answer schema's enums are the lists, and \"other\"", m.MEMORY_SCHEMA.properties.asks.items.properties.topic.enum.length === m.MEMORY_TOPICS.length + 1 &&
  m.MEMORY_SCHEMA.properties.asks.items.properties.reaction.enum.includes(""));
ok("no topic names health, therapy, care, faith or community", !m.MEMORY_TOPICS.some((t) => sensitive(t) || m.privateIn(t) || /care|sitter|nanny|doctor|dentist/.test(t)));
ok("kept a year from the last addition (27 Nov)",
  !m.memoryExpired(new Date("2026-01-01"), new Date("2026-11-10")) && m.memoryExpired(new Date("2025-11-01"), new Date("2026-11-10")) && m.MEMORY_IDLE_DAYS === 365);

console.log("\n=== the verbatim window: every place an answer named (27 Nov) ===");
{
  const answer = "There's nothing from parents near Altadena on this yet. Here's what I found. Public/general information:\nChildren's Art Classes, nine-month kids art program: Beginning Art for ages 7 & 8.\nKirk Newman Art School (Kiarts), children's art classes, grades 1-3 in Pasadena: Saturdays 9:30-11am, 11 weeks $255.\nRachel's Young Art Studio, open studio for kids: ages 3 to 10, Fridays.\nThe Arterie, kids art classes, in-studio and online: ages 4-8, Thursdays 3:30-4:30p.\nWant me to ask a few nearby parents for more?";
  const gist = m.answerGist(answer);
  ok("every place's name is there, the last one included (27 Nov: the first 400 characters of an average 748-character answer stop halfway)",
    ["Children's Art Classes", "Kirk Newman Art School", "Rachel's Young Art Studio", "The Arterie"].every((n) => gist.includes(n)), gist);
  ok("the offer is dropped, the opening kept, the details after each colon left out", !gist.includes("Want me to ask") && gist.startsWith("There's nothing from parents") && !gist.includes("$255"));
  ok("never longer than asked", m.answerGist("x".repeat(3000)).length <= 700);
  ok("the window is built with it, and the classifier given 700 characters of it",
    /answer: answerGist\(x\.a\)/.test(read("lib/server/repo/deep-dives.ts")) && /A: \$\{x\.answer\.slice\(0, 700\)\}/.test(read("lib/server/intent.ts")));
}

console.log("\n=== the table, the wiring, the job ===");
const migration = read("drizzle/0066_conversation_summaries.sql");
ok("one row per person, deleted with the person, no free-text column, capped, locked away from the browser roles",
  /person_id\s+uuid PRIMARY KEY REFERENCES people\(id\) ON DELETE CASCADE/.test(migration) && !/\btext NOT NULL CHECK/.test(migration) &&
    /jsonb_array_length\(asks\) <= 30/.test(migration) && /ENABLE ROW LEVEL SECURITY/.test(migration) &&
    /REVOKE ALL ON conversation_summaries FROM anon, authenticated/.test(migration));
ok("and it is in the journal", /"tag": "0066_conversation_summaries"/.test(read("drizzle/meta/_journal.json")));
ok("27 Nov: the CHECK widened to 200 entries, in the journal, and the schema says the same",
  /DROP CONSTRAINT IF EXISTS conversation_summaries_asks_check/.test(read("drizzle/0082_memory_interests.sql")) && /jsonb_array_length\(asks\) <= 200/.test(read("drizzle/0082_memory_interests.sql")) &&
    /"tag": "0082_memory_interests"/.test(read("drizzle/meta/_journal.json")) && /jsonb_array_length\(\$\{t\.asks\}\) <= 200/.test(read("lib/db/schema.ts")) && m.MEMORY_MAX_INTERESTS <= 200);
const repo = read("lib/server/repo/conversation-memory.ts");
ok("only what mayFold allows is sent to the model, and only readMemoryAsks' output is stored",
  /const foldable = exchanges\.filter\(\(x\) => mayFold\(x, sensitive\)\);/.test(repo) && /else added = readMemoryAsks\(JSON\.parse\(text\), foldable, areas, sensitive\);/.test(repo) &&
    /mergeMemory\(validMemory\(previous, areas\), added\)/.test(repo) && !/share_ids|shares/.test(repo));
ok("a failed call is not tried again on every text (second review): the cursor moves, nothing is added",
  /let callFailed = false;/.test(repo) && /callFailed \? "failed"/.test(repo));
ok("never folded again from before covers_through, the last real STOP, or 90 days (review: STOP then START rebuilt it)",
  /\(select covers_through from conversation_summaries where person_id/.test(repo) &&
    /where phone = \$\{phone\} and \(opted_in_at is null or opted_in_at > opted_out_at\)\),/.test(repo) &&
    /now\(\) - make_interval\(days => \$\{MEMORY_IDLE_DAYS\}::int\)\s+\)::text as floor/.test(repo));
ok("never written while they are opted out, nor after a STOP that came while it ran (reviews: a fold running at STOP wrote it back)",
  /where not exists \(\s+select 1 from sms_opt_outs o/.test(repo) && /or o\.opted_out_at > \$\{started\}::timestamptz\)\)/.test(repo));
/* 27 Nov: every exchange that went out is filed, not only the ones leaving the window — up to the first still on its way. */
ok("every exchange is filed once it has gone out, up to the first one still waiting to be read or sent (not held, under a day)",
  /const settling = candidates\.findIndex\(\(r\) => \(r\.status === "pending_review" \|\| r\.status === "approved"\) && r\.hold_reason === "not_held" && !r\.stale\);/.test(repo) &&
    /const leaving = settling === -1 \? candidates : candidates\.slice\(0, settling\);/.test(repo) && !/twelfth/.test(repo));
ok("one fold per person at a time", /if \(folding\.has\(personId\)\) return "busy";/.test(repo) && /finally \{\s+folding\.delete\(personId\);/.test(repo));
ok("the fast model, from the registry", /model: MODELS\.fast/.test(repo) && !/claude-(haiku|sonnet|opus)/.test(repo));
const logs = [...repo.matchAll(/console\.info\("\[memory\] fold", (\{[^}]*\})\)/g)].map((c) => c[1]);
ok("it logs counts and enums only (invariant 7): every logged value is a count or the outcome",
  logs.length === 3 && logs.every((l) => [...l.matchAll(/(\w+): ([^,}]+)/g)].every(([, , v]) => /^(outcome|"[a-z_]+"|\w+\.length)$/.test(v.trim()))), JSON.stringify(logs));
const inbound = read("lib/server/inbound.ts");
ok("STOP clears it", /await setOptOut\(from, "out", body\);\s+\/\*[^*]*\*\/\s+await forgetMemory\(from\);/.test(inbound));
ok("the classifier is shown it in both readings, and the fold never holds up the turn",
  /memory: !exchange\?\.held \? await memoryFor\(person\.person_id\) : \[\],/.test(inbound) &&
    /const memory = readsHistory \? await memoryFor\(person\?\.person_id\) : \[\];/.test(inbound) &&
    /if \(person\) void foldMemory\(person\.person_id, from\);/.test(inbound));
/* 25 Nov: a parent back after three quiet days is shown the week and the memory too — only a held last question stops it. */
ok("the history is read without a question in the last three days, never after a held one",
  /const readsHistory = person !== null && !attached\.attached && !exchange\?\.held;/.test(inbound) &&
    /const earlier = readsHistory \? await earlierExchangesFor\(from\) : \[\];/.test(inbound) &&
    /earlier: !exchange\?\.held \? await earlierExchangesFor\(from\) : \[\],/.test(inbound) &&
    !/exchange && !exchange\.held \? await (memoryFor|earlierExchangesFor)/.test(inbound));
{
  const blast = read("lib/server/repo/blast.ts");
  ok("a Network Ask's pool puts who asked about its topic first, adding and dropping nobody (25 Nov)",
    /const shares = \(id: string\) => \(interestsOf\.get\(id\) \?\? \[\]\)\.some\(\(t\) => input\.topics!\.includes\(t\)\);\s+candidates = \[\.\.\.candidates\.filter\(\(c\) => shares\(c\.person_id\)\), \.\.\.candidates\.filter\(\(c\) => !shares\(c\.person_id\)\)\];/.test(blast));
  ok("an Ask for the adult asking is not ranked by the asker's children: everyone near, by interest",
    /const rankedNear = input\.forSelf \? \[\] : ranked\.ranked\.filter/.test(blast) && /topics: topicsIn\(asked\),\s+forSelf,/.test(blast));
}
ok("an open question leans on the family's interests, read only for one (25 Nov)",
  /isOpenQuestion\(body, focus, \[place\.label, place\.area\]\)\s*\?\s*\(\(await familyInterestsFor\(\[person\.person_id\]\)\)/.test(inbound) &&
    /\/\* An open question's lean \(25 Nov, above\)\. \*\/\s*interests,/.test(inbound));
ok("the classifier puts it first, before the verbatim exchanges, chosen by the message", /content: \[\s+memoryLine\(input\.memory, text\),/.test(read("lib/server/intent.ts")));
ok("a daily job deletes what is idle, and sends nothing",
  /expire_memory: \{\s+name: "expire_memory",\s+min_interval_minutes: 60 \* 23,\s+sends: false,/.test(read("lib/jobs.ts")) &&
    /expire_memory,\n/.test(read("lib/server/repo/jobs.ts")) && /expire_memory/.test(read("../deploy/.env.example")));

console.log("\n=== interests (25 Nov): what a family asked about, as fixed topics ===");
{
  const sens = (t: string) => demand.classifyDemand(t, null) !== "ordinary";
  ok("every topic has words", m.MEMORY_TOPICS.every((t) => (m.MEMORY_TOPIC_WORDS[t] ?? []).length > 0));
  ok("dressage reads as horse riding", m.topicsIn("horse dressage lessons in Pasadena for my 8 year old").join() === "horse riding");
  ok("a pony ride and an equestrian centre too", m.topicsIn("Pony rides at the Equestrian Center").includes("horse riding"));
  ok("whole words: 'rash guard' at the pool is swim, 'parkway' is no park", m.topicsIn("swim lessons, rash guard needed").includes("swim lessons") && !m.topicsIn("near the parkway").includes("parks and playgrounds"));
  ok("hyphens and ampersands read as words", m.topicsIn("Mommy & Me music").includes("parent and me classes") && m.topicsIn("after-school robotics").includes("after school programs"));
  ok("nothing on the list is nothing", m.topicsIn("any recommendations for a good dentist?").length === 0);
  ok("touchesInterest reads an item's title", m.touchesInterest("Saturday Pony Day at Rancho Park Stables", ["horse riding"]) && !m.touchesInterest("Toddler Storytime", ["horse riding"]));
  ok("no interests touch nothing", !m.touchesInterest("anything", []));

  const ask = (topic: string, on: string, reaction: (typeof m.MEMORY_REACTIONS)[number] | null = null, times = 1, open = false) =>
    ({ topic, open, times, first: on, last: on, areas: [], when: [], reaction }) as import("../lib/conversation-memory.ts").MemoryInterest;
  const fi = (memory: ReturnType<typeof ask>[], recentQuestions: string[]) => m.familyInterests({ memory, recentQuestions, isSensitive: sens, now: new Date("2026-11-10T12:00:00Z") });
  ok("the week's questions first, newest first, then the memory by weight",
    fi([ask("chess", "2026-10-01"), ask("soccer", "2026-11-01")], ["dressage lessons?", "swim lessons for my 4 year old"]).join("|") === "horse riding|swim lessons|soccer|chess");
  ok(`at most ${5}`, fi([ask("chess", "2026-10-01"), ask("soccer", "2026-11-01"), ask("tennis", "2026-11-02"), ask("golf", "2026-11-03")], ["dressage?", "swim?"]).length === m.INTERESTS_MAX && m.INTERESTS_MAX === 5);
  ok("asked often outweighs asked once a little later (27 Nov: weight, not only the newest)",
    fi([ask("chess", "2026-10-20", null, 6), ask("soccer", "2026-11-05")], []).join("|") === "chess|soccer");
  ok("an open topic is an interest, leads when a newer question touches it, and its own name finds a digest item",
    fi([ask("soccer", "2026-11-05", null, 4), ask("fencing", "2026-09-01", null, 1, true)], ["any fencing camps over winter break?"])[0] === "fencing" &&
      m.touchesInterest("Youth Fencing Open House", ["fencing"]) && !m.touchesInterest("Saturday swim", ["fencing"]));
  ok("once each", fi([ask("swim lessons", "2026-10-01")], ["swim lessons?", "more swim lessons?"]).join() === "swim lessons");
  ok("'not for them' is never an interest, from the memory or the week", fi([ask("soccer", "2026-11-01", "not for them")], ["soccer camps?"]).length === 0);
  ok("a sensitive question gives no interest", fi([], ["my son has asthma, is swimming ok?"]).length === 0);
  ok("a private one neither", fi([], ["single mom here, any swim lessons?"]).length === 0);
  ok("the brief line names the topics and says it is a lean", (m.interestsBriefLine(["horse riding"]) ?? "").includes("horse riding") && (m.interestsBriefLine(["horse riding"]) ?? "").includes("among the others"));
  ok("no interests, no brief line", m.interestsBriefLine([]) === null);
}

console.log(`\n  ${pass} checks passed${fail ? `, ${fail} FAILED` : ""}.`);
if (fail) process.exit(1);

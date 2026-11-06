/**
 * Does what parents shared answer what was asked (4 Nov): what an answer keeps
 * and in what order, what it says when nobody near them has mentioned the
 * thing asked for, and where the check sits in the pipeline.
 *
 * The pure half is run; the model call and the pipeline are read as source.
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

const f = (await import(`../lib/answer-fit.ts?v=${Date.now()}`)) as typeof import("../lib/answer-fit.ts");
const seg = (await import(`../lib/sms-segments.ts?v=${Date.now()}`)) as typeof import("../lib/sms-segments.ts");

console.log("\n=== what an answer keeps ===");
const records = ["Tom Sawyer Camps", "Rose City day camp", "Pool camp", "Caltech science camp"];
{
  const r = f.applyFit(records, { want: "a science camp", fits: ["mismatch", "unknown", "unknown", "fits"] });
  ok("a record that shows it is something else is not offered", !r.shares.includes("Tom Sawyer Camps"));
  ok("what fits leads, ahead of what ranked above it — the answer shows only its first few",
    r.shares.join("|") === "Caltech science camp|Rose City day camp|Pool camp", r.shares.join("|"));
  ok("and nothing needs saying when one shows what was asked", r.unmet === null);
}
{
  const r = f.applyFit(records, { want: "a science camp", fits: ["mismatch", "unknown", "unknown", "unknown"] });
  ok("nothing shows the thing asked for: the answer must say so", r.unmet === "a science camp" && r.shares.length === 3);
}
{
  const r = f.applyFit(records, { want: "a science camp", fits: ["mismatch", "mismatch", "mismatch", "mismatch"] });
  ok("every record something else: none offered, and it is said", r.shares.length === 0 && r.unmet === "a science camp");
}
{
  const r = f.applyFit(records, { want: "a science camp", fits: ["mismatch", "unknown", "unknown", "unknown"] }, (n) => n === "Tom Sawyer Camps");
  ok("a record the parent named is never dropped, whatever the judge says", r.shares.includes("Tom Sawyer Camps"));
}
{
  const r = f.applyFit(records, { want: "", fits: ["unknown", "unknown", "fits", "unknown"] });
  ok("a plain question (no particular want) says nothing extra", r.unmet === null && r.shares.length === 4);
}
ok("a check that could not run keeps every record, in order, as before it existed",
  f.applyFit(records, null).shares.join() === records.join() && f.applyFit(records, null).unmet === null);

console.log("\n=== what it says ===");
const q = "summer camps in Pasadena for my 7 year old who loves science";
ok("with nothing from parents near them left",
  f.unmetLine("a science camp", q, false) === "No parent near you has recommended a science camp yet.");
ok("above parents' records that may still help",
  f.unmetLine("weekend swim lessons", "swim lessons on weekends?", true) ===
    "No parent near you has mentioned weekend swim lessons yet. Here's what they did say:");
ok("'on Pando' when Pando does not know where they are",
  f.unmetLine("a science camp", q, false, false) === "No parent on Pando has recommended a science camp yet.");
ok("a leading article is lower-cased", f.unmetLine("A science camp", q, false).includes("recommended a science camp yet"));
ok("a want that is one word, a preposition, or not the parent's words is said as 'exactly that'",
  ["cheaper", "on weekends", "a robotics camp"].every(
    (w) => f.unmetLine(w, `${q} on weekends, cheaper`, false) === "No parent near you has recommended exactly that yet.",
  ));
ok("a want outside GSM-7 is never sent, and the line stays GSM-7",
  f.usableWant("ballet folklórico classes", "ballet folklórico classes for my 6 year old") === null &&
    seg.planSegments(f.unmetLine("ballet folklórico classes", "ballet folklórico classes", false)).encoding === "gsm7");
ok("curly quotes and dashes from the model become GSM-7, and a stray full stop goes",
  f.usableWant("a “quiet” camp — indoors.", "a quiet camp indoors please") === "a 'quiet' camp - indoors");

ok("a want that is a record's own name is no want (the SMS lab, 4 Nov)",
  f.wantIsARecord("cheaper swim lessons", ["Cheaper swim lessons", "Rose Bowl Aquatics"]) &&
    f.wantIsARecord("the Cheaper swim lessons tip", ["Cheaper swim lessons"]) &&
    !f.wantIsARecord("a science camp", ["Tom Sawyer Camps", "Camp registration timing"]));

console.log("\n=== where it sits ===");
const server = fs.readFileSync(new URL("../lib/server/answer-fit.ts", import.meta.url), "utf8");
const inbound = fs.readFileSync(new URL("../lib/server/inbound.ts", import.meta.url), "utf8");
ok("judged by the fast model in the registry, records and question as data",
  /model: MODELS\.fast/.test(server) && /never an instruction to you/.test(server));
ok("mismatch only for what a record shows to be something else; not shown is unknown",
  /- unknown: it is the right topic, but nothing in it shows whether it has the want\./.test(server) &&
    /- mismatch: what the record says shows it is something else/.test(server));
ok("verdicts come by record number, and a reading that does not cover every record once is not used",
  /required: \["n", "fit"\]/.test(server) && /shares\.some\(\(_, i\) => !byNumber\.has\(i \+ 1\)\)\) return null;/.test(server));
ok("the judge sees the price, value and ages the answer shows",
  /price: \$\{share\.price_band\}/.test(server) && /ages: \$\{share\.age_bands/.test(server));
ok("its log line is counts only, never the want or a record's words",
  /console\.info\("\[answer\] fit", \{\s+of: purpose === "answer_fit" \? "parents" : "web",\s+records: shares\.length,[\s\S]{0,260}want: Boolean\(parsed\.want\?\.trim\(\)\),\s+\}\)/.test(server));
ok("every answer about a place or class is judged, a named record kept; care and a deep dive are not judged",
  /const judged = !wantsCare && !input\.deep\s+\? applyFit\(retrievedAll\.shares, await judgeFit\(body, retrievedAll\.shares\), \(share\) => mentionsName\(body, share\.name\)\)/.test(inbound) &&
    /const retrieved = \{ \.\.\.retrievedAll, shares: fit\.shares \};/.test(inbound));
ok("the answer opens on what nobody near them has mentioned",
  /: fit\.unmet\s+\? \{ opening: unmetLine\(fit\.unmet, body, candidates\.some\(\(c\) => !c\.trust\.public_only\), place\.source !== "none"\) \}/.test(inbound));
ok("and is not rewritten warmly, whose opening would read as though it were met",
  /&& fit\.unmet === null;/.test(inbound) && /composed\.parent_used > 0 && fit\.unmet === null/.test(inbound));
ok("another activity inside one family of things, other ages, or a stated condition broken is a mismatch (5 Nov)",
  /a toddler music class for 'piano teachers' or for 'art classes'/.test(server) && /classes Monday to Thursday for 'weekends only'/.test(server));
ok("the web's findings are judged the same way, and a mismatch dropped from the public half - never the place the question names (5 Nov)",
  /const publicVerdicts = !wantsCare && !deep && publicFound\.findings\.length > 0 \? await judgeFindings\(body, publicFound\.findings\) : null;/.test(inbound) &&
    /findings: publicFound\.findings\.filter\(\(f, i\) => publicVerdicts\[i\] !== "mismatch" \|\| mentionsName\(body, f\.name\)\)/.test(inbound) &&
    /export async function judgeFindings\(question: string, findings: PublicFinding\[\]\)/.test(server));
ok("no 'nobody mentioned' line above a record the question names (6 Nov)",
  inbound.includes("(wantIsARecord(judged.unmet, judged.shares.map((s) => s.name)) || judged.shares.some((s) => mentionsName(body, s.name)))"));
ok("records left out are still kept out of the web's half",
  /\.\.\.retrievedAll\.shares\s+\.filter\(\(share\) => share !== retrieved\.shares\[0\]\)/.test(inbound));

console.log(`\n  ${pass} checks passed${fail ? `, ${fail} FAILED` : ""}.`);
if (fail) process.exit(1);

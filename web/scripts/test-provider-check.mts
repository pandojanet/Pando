/**
 * The doctor check's pure half (8 Oct): a match the model claims is believed
 * only when the search really returned that page, the licence step's page is on
 * DCA's host, and the page names the provider the parent typed.
 *
 * Every check here is a refusal or its counterpart: the failure this exists to
 * prevent is a model reporting a page that was never in its results, and a
 * record marked "valid" on the strength of it.
 *
 *     npm run test:provider-check
 */
const { DCA_HOST, nameWords, namesCarry, npiCities, npiQuery, NPPES_LIMIT, NPPES_VIEW, readNpiResults, readProviderReply, searchableName, verifiedMatch } = (await import(
  `../lib/provider-check.ts?v=${Date.now()}`
)) as typeof import("../lib/provider-check.ts");

let failed = 0;
let passed = 0;
const ok = (label: string, cond: boolean, detail = "") => {
  if (cond) {
    passed += 1;
    console.log(`  ok    ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${label}${detail ? `  (${detail})` : ""}`);
  }
};

const DCA_PAGE = "https://search.dca.ca.gov/details/8002/A/123456/0a1b2c3d4e5f";
const hits = [
  { url: DCA_PAGE, title: "search.dca.ca.gov" },
  { url: "https://www.pasadenapediatrics.com/our-team/", title: "Our Team | Pasadena Pediatrics" },
];
const reply = (patch: Record<string, unknown>) =>
  readProviderReply(JSON.stringify({ match: true, url: DCA_PAGE, name: "LEE, MAYA J", ...patch }));

console.log("\n=== reading the model's reply ===");
ok("a JSON object is read, prose around it ignored",
  readProviderReply('Here you go: {"match": true, "url": "https://a.b/c", "name": "X"} done')?.url === "https://a.b/c");
ok("a reply that is not the object is no reply", readProviderReply("I found Dr. Lee on the DCA site.") === null);
ok("match must be a boolean, not the word", readProviderReply('{"match": "yes", "url": "https://a.b"}') === null);
ok("an empty url reads as none", readProviderReply('{"match": true, "url": "", "name": "X"}')?.url === null);

console.log("\n=== a claimed match is checked, not believed ===");
ok("DCA's page, returned by the search, naming the doctor: a licence",
  verifiedMatch({ reply: reply({}), hits, name: "Dr. Maya Lee", host: DCA_HOST })?.url === DCA_PAGE);
ok("a URL the search never returned is refused, however plausible",
  verifiedMatch({
    reply: reply({ url: "https://search.dca.ca.gov/details/8002/A/999999/ffff" }),
    hits, name: "Dr. Maya Lee", host: DCA_HOST,
  }) === null);
ok("on the licence step, a page off DCA's host is refused even if it was returned",
  verifiedMatch({
    reply: reply({ url: "https://www.pasadenapediatrics.com/our-team/", name: "Maya Lee, MD" }),
    hits, name: "Dr. Maya Lee", host: DCA_HOST,
  }) === null);
ok("on the open web, a page whose title does not name them is refused, whatever the model read on it",
  verifiedMatch({
    reply: reply({ url: "https://www.pasadenapediatrics.com/our-team/", name: "Maya Lee, MD" }),
    hits, name: "Dr. Maya Lee",
  }) === null);
ok("and one whose title does is accepted",
  verifiedMatch({
    reply: reply({ url: "https://directory.example/maya-lee", name: "Maya Lee, MD" }),
    hits: [...hits, { url: "https://directory.example/maya-lee", title: "Dr. Maya Lee, MD — Pediatrics, Pasadena CA" }],
    name: "Dr. Maya Lee",
  }) !== null);
ok("a page naming someone else is refused — 'Dr.' in common is not a match",
  verifiedMatch({ reply: reply({ name: "Dr. Raj Patel" }), hits, name: "Dr. Maya Lee", host: DCA_HOST }) === null);
ok("match: false is never upgraded", verifiedMatch({ reply: reply({ match: false }), hits, name: "Dr. Maya Lee", host: DCA_HOST }) === null);
ok("no reply is no match", verifiedMatch({ reply: null, hits, name: "Dr. Maya Lee" }) === null);
ok("a trailing slash or a fragment does not make two pages different",
  verifiedMatch({ reply: reply({ url: `${DCA_PAGE}/#top` }), hits, name: "Maya Lee", host: DCA_HOST }) !== null);
ok("a practice matches on its own distinguishing word",
  verifiedMatch({
    reply: reply({ url: "https://www.pasadenapediatrics.com/our-team/", name: "Pasadena Pediatrics" }),
    hits, name: "Pasadena Pediatrics",
  }) !== null);
ok("a practice sharing only the town is refused — Pasadena Pediatrics is not Pasadena Dental",
  verifiedMatch({
    reply: reply({ url: "https://pasadenadental.example/", name: "Pasadena Dental Group" }),
    hits: [...hits, { url: "https://pasadenadental.example/", title: "Pasadena Dental Group" }],
    name: "Pasadena Pediatrics",
  }) === null);
ok("a surname alone does not stand for a first name and surname",
  verifiedMatch({ reply: reply({ name: "LEE, DAVID" }), hits, name: "Dr. Maya Lee", host: DCA_HOST }) === null);
ok("on DCA, a surname alone cannot take a licence — any Lee's would do (review, 8 Oct)",
  verifiedMatch({ reply: reply({ name: "Lee" }), hits, name: "Dr. Lee", host: DCA_HOST }) === null);
ok("on the open web the page's own title decides, never the model's echo of the name",
  verifiedMatch({
    reply: reply({ url: "https://www.pasadenapediatrics.com/our-team/", name: "Zzyzx Quokka" }),
    hits, name: "Zzyzx Quokka",
  }) === null);
ok("and a page whose title names them is accepted on one word",
  verifiedMatch({
    reply: reply({ url: "https://drlee.example/", name: "Dr. Lee" }),
    hits: [...hits, { url: "https://drlee.example/", title: "Dr. Lee — Pediatrics in Altadena" }],
    name: "Dr. Lee",
  }) !== null);
ok("a two-letter surname is a name, not noise — Dr. Wu can be found",
  verifiedMatch({
    reply: reply({ url: "https://wupeds.example/", name: "Dr. Wu" }),
    hits: [...hits, { url: "https://wupeds.example/", title: "Dr. Wu Pediatrics" }],
    name: "Dr. Wu",
  }) !== null);
ok("a name made only of titles and generic words can never match",
  verifiedMatch({ reply: reply({ name: "Dr. Family Medical Center" }), hits, name: "Dr. Family Medical Center", host: DCA_HOST }) === null);

console.log("\n=== the words a name is matched on ===");
ok("titles and degrees are dropped", nameWords("Dr. Maya J. Lee, MD, FAAP").join(" ") === "maya lee");
ok("accents do not split a name", nameWords("Dr. José Núñez").join(" ") === "jose nunez");

console.log("\n=== what may go to a search engine ===");
ok("a phone number, an email and a note in parentheses are cut",
  searchableName("Dr Lee (my son Jake's ped, call me) 626-555-0101 me@mail.com") === "Dr Lee",
  String(searchableName("Dr Lee (my son Jake's ped, call me) 626-555-0101 me@mail.com")));
ok("a link is cut", searchableName("Dr Lee https://evil.example/x") === "Dr Lee");
ok("it is capped at a name's length", (searchableName("Dr " + "a".repeat(200)) ?? "").length <= 80);
ok("nothing name-like left means nothing is searched", searchableName("626-555-0101") === null);
ok("a practice with a number in its name keeps it", searchableName("Kids First 360 Pediatrics") === "Kids First 360 Pediatrics");

/* ── NPPES, the first step since 9 Oct ── */
{
  const q = npiQuery("Dr. Maya J. Lee, MD", "La Cañada Flintridge");
  ok("the query: last name, first name, CA, individuals, the full page",
    q?.get("last_name") === "lee" && q?.get("first_name") === "maya" && q?.get("state") === "CA" &&
      q?.get("enumeration_type") === "NPI-1" && q?.get("limit") === String(NPPES_LIMIT), q?.toString());
  ok("the neighbourhood is the city, with the ñ the API refuses made plain",
    q?.get("city") === "La Canada Flintridge", q?.get("city") ?? undefined);
  ok("a surname alone sends no first name", npiQuery("Dr. Lee", null)?.has("first_name") === false);
  ok("no neighbourhood sends no city", npiQuery("Dr. Lee", null)?.has("city") === false);
  ok("a phone number in the field never reaches the query",
    !(npiQuery("Dr Lee (call 626-555-0101)", "Pasadena")?.toString() ?? "").includes("555"));
  ok("nothing name-like means no query", npiQuery("626-555-0101", "Pasadena") === null);

  const rec = (npi: string, first: string, last: string, status = "A", middle = "") =>
    ({ number: npi, basic: { first_name: first, middle_name: middle, last_name: last, status } });
  const one = readNpiResults({ result_count: 1, results: [rec("1234567890", "MAYA", "LEE", "A", "J")] }, "Dr. Maya Lee");
  ok("one active record whose current name is theirs: one, linked to the registry's page",
    one?.kind === "one" && one.url === NPPES_VIEW + "1234567890", JSON.stringify(one));
  ok("a record found by a FORMER name is refused — the API returned one live on 9 Oct",
    readNpiResults({ results: [rec("1234567890", "CLAIRE", "CERNIGLIA")] }, "Dr. Smith")?.kind === "none");
  ok("an inactive record is refused",
    readNpiResults({ results: [rec("1234567890", "MAYA", "LEE", "D")] }, "Maya Lee")?.kind === "none");
  ok("two records naming them: several, never a pick",
    readNpiResults({ results: [rec("1234567890", "MAYA", "LEE"), rec("1234567891", "DAVID", "LEE")] }, "Dr. Lee")?.kind === "several");
  ok("one match on a full page is several — the next page may hold another",
    readNpiResults({ results: [rec("1234567890", "MAYA", "LEE"), ...Array.from({ length: NPPES_LIMIT - 1 }, (_, i) => rec("2" + String(i).padStart(9, "0"), "X", "PATEL"))] }, "Maya Lee")?.kind === "several");
  ok("no record: none, and the web step decides", readNpiResults({ result_count: 0, results: [] }, "Maya Lee")?.kind === "none");
  ok("the API refusing the input is none, not an outage",
    readNpiResults({ Errors: [{ description: "Field contains special character(s)" }] }, "Maya Lee")?.kind === "none");
  ok("a reply that is not the API's shape is unknown, never not-found",
    readNpiResults("<html>", "Maya Lee") === null && readNpiResults({ foo: 1 }, "Maya Lee") === null);
  ok("an NPI that is not ten digits is refused",
    readNpiResults({ results: [rec("12345", "MAYA", "LEE")] }, "Maya Lee")?.kind === "none");
  ok("namesCarry: a surname does not stand for first name and surname", !namesCarry("Maya Lee", "DAVID LEE"));
  /* 9 Oct, the developer: "if there is no city, search by Pasadena". */
  ok("the neighbourhood first, then Pasadena",
    JSON.stringify(npiCities("Bungalow Heaven")) === JSON.stringify(["Bungalow Heaven", "Pasadena"]));
  ok("no neighbourhood: Pasadena", JSON.stringify(npiCities(null)) === JSON.stringify(["Pasadena"]));
  ok("Pasadena is never asked twice", JSON.stringify(npiCities("Pasadena")) === JSON.stringify(["Pasadena"]));
}

console.log(`\n  ${passed} checks passed${failed ? `, ${failed} FAILED` : ""}.`);
if (failed) process.exit(1);

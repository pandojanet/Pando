/**
 * The weekly digest (3 Nov): when it is due, what of the agent's findings may
 * be sent, what each household gets, what it says, and the rules around it —
 * its own yes, its own send category, out of the contributor-protection limits.
 * The review of 3 Nov added the length, the exact-page check, the month in an
 * age and what an agent run that ends badly means.
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

const d = (await import(`../lib/digest.ts?v=${Date.now()}`)) as typeof import("../lib/digest.ts");
const seg = (await import(`../lib/sms-segments.ts?v=${Date.now()}`)) as typeof import("../lib/sms-segments.ts");
const policy = (await import(`../lib/outreach-policy.ts?v=${Date.now()}`)) as typeof import("../lib/outreach-policy.ts");
const tpl = (await import(`../lib/sms-templates.ts?v=${Date.now()}`)) as typeof import("../lib/sms-templates.ts");
type Item = import("../lib/digest.ts").DigestItem;

const LA = "America/Los_Angeles";

console.log("\n=== Saturday, on the market's clock ===");
/* 2026-11-07 is a Saturday. 17:00 UTC is 9:00 in Los Angeles (PST). */
ok("Saturday 9:00 is due, for that Saturday", d.digestDue(new Date("2026-11-07T17:00:00Z"), LA) === "2026-11-07");
ok("Saturday 8:59 is not", d.digestDue(new Date("2026-11-07T16:59:00Z"), LA) === null);
ok("Saturday 20:00 is not — a late run never reaches quiet hours", d.digestDue(new Date("2026-11-08T04:00:00Z"), LA) === null);
ok("Friday is not", d.digestDue(new Date("2026-11-06T18:00:00Z"), LA) === null);
ok("a Saturday morning in UTC that is still Friday in Los Angeles is not", d.digestDue(new Date("2026-11-07T06:00:00Z"), LA) === null);

console.log("\n=== links ===");
ok("the same page however it is written",
  d.urlKey("https://www.Example.org/events/?utm_source=x#top") === d.urlKey("http://example.org/events") &&
    d.urlKey("https://example.org/events") === "example.org/events");
ok("a different page is a different key", d.urlKey("https://example.org/events/1") !== d.urlKey("https://example.org/events/2"));
ok("a scheme in capitals is stored lower-case, so the table's CHECK takes it",
  d.cleanUrl("HTTPS://Example.org/a#x") === "https://example.org/a");
ok("not a web link is nothing", d.cleanUrl("javascript:alert(1)") === null && d.urlKey("not a url") === null);

console.log("\n=== what of the agent's findings may be sent ===");
const good = {
  kind: "event",
  title: "Dia de los Muertos family day",
  when_text: "Sun Nov 8, 10am-3pm",
  starts_on: "2026-11-08",
  ends_on: "2026-11-08",
  place: "Pasadena",
  age_min: 2,
  age_max: 10,
  summary: "Crafts, music and an altar walk for families, free with admission.",
  url: "https://www.kidspacemuseum.org/events/dia",
};
const seen = new Set([d.urlKey("https://kidspacemuseum.org/events/dia/")!, d.urlKey("https://cityofpasadena.net/camps")!]);
const ctx = { editionDate: "2026-11-07", seenUrls: seen };
ok("a dated event on a page the agent saw is kept", d.readAgentItems([good], ctx).length === 1);
ok("a made-up page on a site it did see is dropped — the host alone proves nothing",
  d.readAgentItems([{ ...good, url: "https://kidspacemuseum.org/events/holiday-fair-123" }], ctx).length === 0);
ok("a link to a site it never saw is dropped", d.readAgentItems([{ ...good, url: "https://made-up-events.example/x" }], ctx).length === 0);
ok("an event already over is dropped", d.readAgentItems([{ ...good, starts_on: "2026-11-01", ends_on: "2026-11-01" }], ctx).length === 0);
ok("an event a month out is not this week's", d.readAgentItems([{ ...good, starts_on: "2026-12-10", ends_on: null }], ctx).length === 0);
ok("an event with no date at all is dropped", d.readAgentItems([{ ...good, starts_on: null, ends_on: null }], ctx).length === 0);
ok("a summer camp registering now may be months out",
  d.readAgentItems([{ ...good, kind: "camp", starts_on: "2027-03-01", ends_on: null, url: "https://cityofpasadena.net/camps" }], ctx).length === 1);
ok("a kind the digest does not carry is dropped", d.readAgentItems([{ ...good, kind: "recommendation" }], ctx).length === 0);
ok("one per title", d.readAgentItems([good, { ...good }], ctx).length === 1);
ok("but a week's roundup page may carry several events",
  d.readAgentItems([good, { ...good, title: "Story time at the library" }], ctx).length === 2);
ok("an event that is only today is dropped: the digest is read today (6 Nov)",
  d.readAgentItems([{ ...good, starts_on: "2026-11-07", ends_on: "2026-11-07" }], ctx).length === 0 &&
    d.readAgentItems([{ ...good, starts_on: "2026-11-07", ends_on: null }], ctx).length === 0);
ok("one running for days through today stays",
  d.readAgentItems([{ ...good, starts_on: "2026-11-06", ends_on: "2027-01-10" }], ctx).length === 1);
ok("an aggregator's listing page is never an item's link (6 Nov)",
  d.isListingUrl("https://www.eventbrite.com/b/ca--arcadia/community/") && d.isListingUrl("https://www.eventbrite.co.uk/d/ca--pasadena/kids/") &&
    d.isListingUrl("https://allevents.in/pasadena/kids") && d.isListingUrl("https://www.meetup.com/find/?location=pasadena"));
ok("a test, draft or staging page is never an item's link (the real-graph run: /kids/storytime-test/)",
  d.isListingUrl("https://www.cityofpasadena.net/library/kids/storytime-test/") && d.isListingUrl("https://x.org/events/draft") &&
    !d.isListingUrl("https://x.org/sat-test-prep-class") && !d.isListingUrl("https://x.org/testing-center"));
ok("an event's own page, and a venue's calendar, are fine",
  !d.isListingUrl("https://www.eventbrite.com/e/turkey-trot-tickets-123") && !d.isListingUrl("https://kidspacemuseum.org/calendar/") &&
    !d.isListingUrl("https://www.meetup.com/pasadena-parents/events/123/") && !d.isListingUrl("not a url"));
{
  const listing = "https://www.eventbrite.com/b/ca--arcadia/community/";
  const seenListing = new Set([...seen, d.urlKey(listing)!]);
  ok("and it is dropped even when the agent saw it",
    d.readAgentItems([{ ...good, url: listing }], { editionDate: ctx.editionDate, seenUrls: seenListing }).length === 0);
}
console.log("\n=== the item must be on the page it links to (10 Nov) ===");
{
  const key = d.urlKey(good.url)!;
  const read = (text: string) => ({ editionDate: ctx.editionDate, seenUrls: seen, pages: new Map([[key, { text, url: good.url }]]) });
  const fair = "Renaissance Fair (In-Person Program) Sat Jun 27 Ages 5-12 San Gabriel Library";
  ok("an item on another event's page is dropped (the lab: a ukulele class linked to a Renaissance Fair)",
    d.readAgentItems([{ ...good, title: "Beginning Ukulele for Teens" }], read(fair)).length === 0);
  ok("and so is a second item sharing that page", d.readAgentItems([
    { ...good, title: "Beginning Ukulele for Teens" },
    { ...good, title: "Skateboarding and Native Americans - Fingerboard Art" },
  ], read(fair)).length === 0);
  ok("an item the page names is kept", d.readAgentItems([good], read("Kidspace calendar: Dia de los Muertos celebration, Nov 8. Plan your visit: open daily from ten to five, free parking on site, members free, tickets at the door, strollers welcome, cafe and garden open, accessible entrance by the main gate.")).length === 1);
  ok("half its words are enough, in any case, plural or accent",
    d.onPage("Altadena Libraries' Mobile Library at Kidspace", { url: "https://x.org/", text: "The ALTADENA LIBRARY mobile van visits on Fridays" }) &&
      d.onPage("Día de los Muertos", { url: "https://x.org/", text: "dia de los muertos" }));
  ok("a calendar's own words are not evidence: day names, ages, kinds and audiences",
    !d.onPage("Hunger Games Party for Teens", { url: "https://x.org/", text: "Teens events: Wednesday, Nov 18, party room. Ages 12-17. Free family programs." }));
  ok("a title with nothing to check passes", d.onPage("Toddler Tuesday", { url: "https://x.org/", text: "Calendar" }));
  ok("accents and marks stay inside a word", d.titleWords("Día de los Muertos Celebración").includes("celebracion"));
  ok("a PDF read with no text is not checked", d.onPage("Winter camp", null));
  ok("no page evidence at all: as before", d.readAgentItems([good], ctx).length === 1);
  const why: Record<string, number> = {};
  d.readAgentItems([{ ...good, title: "Beginning Ukulele for Teens" }], read(fair), why);
  ok("counted as not_on_page", why.not_on_page === 1, JSON.stringify(why));
}

ok("ages the wrong way round are put right", d.readAgentItems([{ ...good, age_min: 10, age_max: 2 }], ctx)[0]?.age_min === 2);
ok("the link is stored clean", d.readAgentItems([{ ...good, url: "HTTPS://www.kidspacemuseum.org/events/dia#x" }], ctx)[0]?.url === "https://www.kidspacemuseum.org/events/dia");
ok("the agent's own notes never reach a parent",
  d.withoutAsides("Weekly story time for young children. I read the Nov 5 listing and took Nov 12 as the next date. Confirm before attending.") ===
    "Weekly story time for young children. Confirm before attending.");
ok("a summary that is only an aside is too thin to send",
  d.readAgentItems([{ ...good, summary: "I could not confirm the time." }], ctx).length === 0);
ok("not an array is nothing", d.readAgentItems("[]", ctx).length === 0 && d.readAgentItems(null, ctx).length === 0);
const why: Record<string, number> = {};
d.readAgentItems([{ ...good, url: "https://made-up.example/x" }, { ...good, kind: "tip" }], ctx, why);
ok("every dropped item says why, by count", why.unseen_url === 1 && why.kind === 1, JSON.stringify(why));

console.log("\n=== an agent run that ends badly is tried again ===");
ok("items found: ready", d.editionOutcome({ end: "end_turn", parsed: true, returned: 5, kept: 3 }) === "ready");
ok("it finished and the list was empty: nothing this week", d.editionOutcome({ end: "end_turn", parsed: true, returned: 0, kept: 0 }) === "empty");
ok("a list whose every item was dropped is tried again, never a lost week (10 Nov)",
  d.editionOutcome({ end: "end_turn", parsed: true, returned: 8, kept: 0 }) === "failed");
for (const end of ["max_tokens", "deadline", "pause_limit", "refusal", "error", "not_configured"]) {
  ok(`${end}: tried again, never a lost week`, d.editionOutcome({ end, parsed: false, returned: 0, kept: 0 }) === "failed");
}
ok("a reply that finished but was not a list is tried again", d.editionOutcome({ end: "end_turn", parsed: false, returned: 0, kept: 0 }) === "failed");
ok("three attempts a Saturday", d.DIGEST_AGENT_ATTEMPTS === 3);

console.log("\n=== what each household gets ===");
const item = (over: Partial<Item>): Item => ({ ...(good as Item), ...over });
ok("an item with no ages suits everyone", d.ageFits({ age_min: null, age_max: null }, []) && d.ageFits({ age_min: null, age_max: null }, [4]));
ok("a parent's child must be inside the range", d.ageFits({ age_min: 2, age_max: 5 }, [4]) && !d.ageFits({ age_min: 6, age_max: 10 }, [4]));
ok("any child will do", d.ageFits({ age_min: 6, age_max: 10 }, [4, 8]));
ok("a baby on the way counts as a baby", d.ageFits({ age_min: 0, age_max: 2 }, [-1]));
ok("somebody with no children gets what is for everyone or for adults, not a toddler class",
  !d.ageFits({ age_min: 1, age_max: 4 }, []) && d.ageFits({ age_min: 18, age_max: null }, []));
ok("a December 2020 child is 5 in November 2026, not 6", d.ageOn(2020, 12, "2026-11-07") === 5 && d.ageOn(2020, 11, "2026-11-07") === 6);
ok("no month given: the year alone", d.ageOn(2020, null, "2026-11-07") === 6);
ok("a due year ahead is under 0", d.ageOn(2027, 3, "2026-11-07") < 0);
{
  /* The 21 Nov run: the baby groups' four were two or three at Kidspace. */
  const at = (title: string, place: string, starts_on: string) => item({ title, place, starts_on, kind: "event", url: `https://cityofpasadena.net/${title.length}` });
  const four = d.pickForPerson([
    at("Winter Frolic", "Kidspace Children's Museum, Pasadena", "2026-11-22"),
    at("Mobile Library at Kidspace", "Kidspace Children's Museum", "2026-11-23"),
    at("Baby Rhyme Time", "Sierra Madre Library", "2026-11-23"),
    at("Toddler Tuesday", "Kidspace Children's Museum, Pasadena", "2026-11-24"),
    at("Children's Storytime", "LA County Arboretum, Arcadia", "2026-11-26"),
    at("Holidayfest", "South Lake Avenue, Pasadena", "2026-12-05"),
  ], [4]);
  /* 19 Nov: different events at one venue all go (the developer: "це різні Kidspace"); by date. */
  ok("different events at one venue are not left out: events by date",
    four.map((i) => i.title).join("|") === "Winter Frolic|Mobile Library at Kidspace|Baby Rhyme Time|Toddler Tuesday");
  ok("one event written twice at one venue is still one item", d.poolForFamily([
    item({ title: "Video Games Club for teens", place: "Pasadena Public Library, Hastings Branch", starts_on: "2026-11-22", kind: "event", url: "https://a.example/1" }),
    item({ title: "Video Games Club for teens", place: "Pasadena Public Library, Hastings Branch", starts_on: "2026-11-29", kind: "event", url: "https://a.example/2" }),
  ], [], [14]).length === 1);
  ok("not one venue: two branches, two rooms' buildings, a chain in two towns, a bare or extended name, a placeholder (review, 11 Nov)",
    !d.atSameVenue({ place: "Pasadena Public Library, Hastings Branch" }, { place: "Pasadena Public Library, Allendale Branch" }) &&
      !d.atSameVenue({ place: "Community Room, Hastings Library" }, { place: "Community Room, Allendale Library" }) &&
      !d.atSameVenue({ place: "Barnes & Noble, Pasadena" }, { place: "Barnes & Noble, Arcadia" }) &&
      !d.atSameVenue({ place: "Central Library" }, { place: "Glendale Central Library" }) &&
      !d.atSameVenue({ place: "Pasadena Public Library" }, { place: "Pasadena Public Library Hastings" }) &&
      !d.atSameVenue({ place: "Various locations" }, { place: "Various locations" }) && !d.atSameVenue({ place: "Zoom meeting" }, { place: "Zoom meeting" }) &&
      d.atSameVenue({ place: "LA County Arboretum, Arcadia" }, { place: "LA County Arboretum" }));
  ok("a town is not a venue, nor one word: those are never held to it",
    !d.atSameVenue({ place: "Pasadena" }, { place: "Kidspace Children's Museum, Pasadena" }) && !d.atSameVenue({ place: "Pasadena" }, { place: "Pasadena" }) &&
      !d.atSameVenue({ place: "Kidspace" }, { place: "Kidspace Children's Museum" }) && d.atSameVenue({ place: "Sierra Madre Library" }, { place: "Sierra Madre Public Library" }) &&
      !d.atSameVenue({ place: "South Pasadena Public Library" }, { place: "South Lake Avenue, Pasadena" }) && !d.atSameVenue({ place: null }, { place: null }));
  const one = d.composeDigest([at("Video Game Club", "Hastings Branch Library", "2026-11-26")]);
  const two = d.composeDigest([at("Video Game Club", "Hastings Branch Library", "2026-11-26"), at("Holidayfest", "South Lake Avenue", "2026-12-05")]);
  ok("a digest of one says 1 (21 Nov run); a pick is a reminder, tapped again undone (11 Nov, evening)",
    /Tap 1 for a reminder\./.test(one.card) && /Reply 1 for a reminder\./.test(one.body) && !/tap again/.test(one.card) &&
      /Tap the ones you'd like a reminder for - tap again to undo\./.test(two.card) && /Reply with the numbers you'd like a reminder for \(e\.g\. 1 3\)\./.test(two.body));
}
const many = Array.from({ length: 8 }, (_, i) =>
  item({ title: `Thing ${i}`, kind: i % 2 ? "camp" : "event", starts_on: `2026-11-${String(15 - i).padStart(2, "0")}`, url: `https://cityofpasadena.net/${i}` }));
const picked = d.pickForPerson(many, [4]);
ok(`at most ${d.DIGEST_MAX_ITEMS}, events first by date`,
  picked.length === d.DIGEST_MAX_ITEMS && picked[0].kind === "event" &&
    picked.filter((p) => p.kind === "event").every((p, i, a) => i === 0 || a[i - 1].starts_on! <= p.starts_on!));

{
  const forTeens = item({ title: "Teen robotics workshop", kind: "event", starts_on: "2026-11-14", age_min: 12, age_max: 17, url: "https://cityofpasadena.net/teens" });
  const general = item({ title: "Flea market", kind: "event", starts_on: "2026-11-08", age_min: null, age_max: null, url: "https://cityofpasadena.net/flea" });
  const forKids = d.pickForPerson([general, forTeens], [14]);
  ok("made for their children first, ahead of an earlier all-ages one (6 Nov)", forKids[0]?.title === "Teen robotics workshop" && forKids[1]?.title === "Flea market");
  ok("with no children, only what has no ages", d.pickForPerson([general, forTeens], []).map((p) => p.title).join() === "Flea market");
}

console.log("\n=== a family in one group, children in two (11 Nov) ===");
{
  const toddlerClass = item({ title: "Toddler Storytime", age_min: 1, age_max: 3 });
  const allAges = item({ title: "Winter Frolic", age_min: null, age_max: null });
  const teenClub = item({ title: "Teen Video Games Club", age_min: 14, age_max: 19 });
  const teenFair = item({ title: "Holidayfest", age_min: null, age_max: null });
  const tweenArt = item({ title: "Tween Art Lab", age_min: 9, age_max: 12 });
  const mixed = d.poolForFamily([toddlerClass, allAges], [[teenClub, teenFair, tweenArt]], [2, 14]);
  ok("a toddler and a 14 year old: the teen's item from the teens' edition joins the toddlers'",
    mixed.some((i) => i.title === "Teen Video Games Club") && mixed.some((i) => i.title === "Toddler Storytime"));
  ok("never another group's all-ages items, nor one for an age none of theirs is",
    !mixed.some((i) => i.title === "Holidayfest") && !mixed.some((i) => i.title === "Tween Art Lab"));
  ok("and what is sent puts the made-for-them items first",
    d.pickForPerson(mixed, [2, 14]).slice(0, 2).map((i) => i.title).sort().join("|") === "Teen Video Games Club|Toddler Storytime");
  ok("a family with no children takes nothing from other groups", d.poolForFamily([allAges], [[teenClub, toddlerClass]], []).length === 1);
  ok("one per title across editions", d.poolForFamily([teenClub], [[{ ...teenClub }]], [14]).length === 1);
  const santaA = item({ title: "Old Pasadena Santa Letters", starts_on: "2026-12-06", age_min: null, age_max: 12 });
  const santaB = item({ title: "Santa Letters at Old Pasadena", starts_on: "2026-12-06", age_min: null, age_max: 12 });
  const ttA = item({ title: "Toddler Tuesday at Kidspace", starts_on: "2026-12-08", age_min: 0, age_max: 5, url: "https://kidspacemuseum.org/calendar/" });
  const ttB = item({ title: "Toddler Tuesday at Kidspace Children's Museum", starts_on: "2026-12-08", age_min: 0, age_max: 4, url: "https://kidspacemuseum.org/calendar/" });
  ok("the same thing under two titles is sent once (the lab, 5 Dec: Santa Letters and Toddler Tuesday twice)",
    d.poolForFamily([ttB], [[santaA, ttA], [santaB]], [2]).length === 2);
  ok("an edition that holds one thing twice is sent it once",
    d.poolForFamily([item({ title: "Toddler Storytime at Loma Alta Park", starts_on: "2026-11-17" }), item({ title: "Toddler Storytime at Loma Alta Park", starts_on: "2026-11-24" })], [], [2]).length === 1);
  ok("one word apart is two things, even on one calendar page (review, 11 Nov)",
    !d.sameThing(item({ title: "Kidspace Free Night", starts_on: "2026-12-08" }), item({ title: "Kidspace Halloween Party", starts_on: "2026-12-08" })) &&
      !d.sameThing(item({ title: "Pasadena Farmers Market", starts_on: "2026-12-08" }), item({ title: "Pasadena Farmers Market Cooking Demo for Kids", starts_on: "2026-12-08" })));
  ok("a longer name for the same thing is the same thing", d.sameThing(ttA, ttB));
  ok("something running for days, dated from two days, is one thing (review, 11 Nov)",
    d.sameThing(item({ title: "Winter Frolic", starts_on: "2026-11-06", ends_on: "2027-01-10" }), item({ title: "Winter Frolic at Kidspace", starts_on: "2026-11-13", ends_on: "2027-01-10" })) &&
      !d.sameThing(item({ title: "Toddler Storytime at Kidspace", starts_on: "2026-12-08", ends_on: "2026-12-08" }), item({ title: "Toddler Storytime at Kidspace Museum", starts_on: "2026-12-15", ends_on: "2026-12-15" })));
  ok("one title on two dates is one thing: a weekly storytime is sent once (the lab, 14 Nov)",
    d.sameThing(item({ title: "Toddler Storytime at Loma Alta Park", starts_on: "2026-11-17" }), item({ title: "Toddler Storytime at Loma Alta Park", starts_on: "2026-11-24" })) &&
      d.readAgentItems([{ ...good, title: "Toddler Storytime", starts_on: "2026-11-10", ends_on: "2026-11-10" }, { ...good, title: "Toddler Storytime", starts_on: "2026-11-12", ends_on: "2026-11-12" }], ctx).length === 1);
  ok("two titles alike on two dates are two things", !d.sameThing(ttA, { ...ttB, starts_on: "2026-12-15", ends_on: null }));
  ok("two things on one date are two", !d.sameThing(santaA, { ...santaA, title: "Breakfast with Santa" }) && !d.sameThing(ttA, item({ title: "Toddler Storytime", starts_on: "2026-12-08" })));
  /* The 21 Nov run: one weekly club under two spellings, two dates, one library — sent twice to five teen families. */
  const clubA = item({ title: "Video Games Club for teens", starts_on: "2026-11-26", ends_on: null, place: "Hastings Branch Library, Pasadena" });
  const clubB = item({ title: "Video Game Club (teens)", starts_on: "2026-12-03", ends_on: null, place: "Hastings Branch Library, Pasadena" });
  ok("the same words spelt differently at one venue are one thing, whatever the dates (21 Nov run)",
    d.sameThing(clubA, clubB) && !d.sameThing(clubA, { ...clubB, place: "La Pintoresca Branch Library, Pasadena" }) &&
      !d.sameThing(clubA, { ...clubB, place: "Pasadena" }) && !d.sameThing(clubA, { ...clubB, title: "Video Game Club for tweens" }));
  /* Review, 11 Nov: every word counts, short ones and numbers too, and ages that do not meet are two things. */
  const at = (title: string, extra: Partial<Item> = {}) => item({ title, starts_on: "2026-11-26", ends_on: null, place: "Hastings Branch Library, Pasadena", age_min: null, age_max: null, ...extra });
  ok("not merged: Jr, K-2/3-5, Level 1/2, Mon/Wed, ages 0-2/3-5, two branches (review, 11 Nov)",
    !d.sameThing(at("Lego Club", { age_min: 7, age_max: 12 }), at("Lego Club Jr", { age_min: 4, age_max: 6 })) &&
      !d.sameThing(at("Math Club K-2"), at("Math Club 3-5", { starts_on: "2026-12-03" })) &&
      !d.sameThing(at("Coding Club Level 1"), at("Coding Club Level 2", { starts_on: "2026-12-03" })) &&
      !d.sameThing(at("Mon Chess Club"), at("Wed Chess Club", { starts_on: "2026-12-03" })) &&
      !d.sameThing(at("Story Time Ages 0-2"), at("Story Time Ages 3-5", { starts_on: "2026-12-03" })) &&
      !d.sameThing(at("Toddler Storytime", { place: "Pasadena Public Library, Hastings Branch" }), at("Toddlers Storytime", { starts_on: "2026-12-03", place: "Pasadena Public Library, Allendale Branch" })) &&
      !d.sameThing(at("Video Games Club", { age_min: 14, age_max: 19 }), at("Video Games Club", { age_min: 10, age_max: 13 })));
  ok("a 5-year-old keeps the item made for them when an older one shares its name",
    d.pickForPerson(d.poolForFamily([at("Lego Club", { age_min: 7, age_max: 12 }), at("Lego Club Jr", { age_min: 4, age_max: 6 })], [], [5]), [5]).map((i) => i.title).join() === "Lego Club Jr");
  ok("and within one edition too",
    d.readAgentItems([{ ...good, title: "Dia de los Muertos at Kidspace" }, { ...good, title: "Kidspace Dia de los Muertos" }], ctx).length === 1);
  const jobs = read("lib/server/repo/jobs.ts");
  ok("source pin: the job builds every edition before it sends, and pools from the day's ready editions (the lab walk drives it)",
    /const ofDay = editions\.length \? await readyEditionsOfDay\(market\.id, editionDate, isTest\) : \[\];/.test(jobs) &&
      /pickForPerson\(poolForFamily\(edition\.items, others, families\[i\]\.ages\), families\[i\]\.ages\)/.test(jobs));
}

console.log("\n=== what it says ===");
const two = d.composeDigest([good as Item, item({ title: "Library “story time” — toddlers", url: "https://cityofpasadena.net/story" })]);
ok("numbered since 11 Nov, so a parent can pick by number; the items it carries are returned in that order",
  /\n\n1\. Dia de los Muertos/.test(two.body) && /\n\n2\. Library/.test(two.body) && two.included === 2 && two.items.length === 2 && two.items[0].title === good.title);
ok("the SMS says how to pick; the card's buttons are the numbers", /Reply with the numbers you'd like a reminder for \(e\.g\. 1 3\)/.test(two.body) && /Tap the ones/.test(two.card) && !/Tap the ones/.test(two.body));
ok("each with its own link", two.body.includes(good.url));
ok("said to be public listings — never human trust (invariant 3)", /Public listings/.test(two.body) && !/parents (recommend|said|used)/i.test(two.body));
ok("says how to stop it", /DIGEST OFF stops these/.test(two.body) && /DIGEST OFF stops these/.test(two.card));
ok("GSM-7 even when a listing has curly quotes and long dashes", seg.planSegments(two.body).encoding === "gsm7", seg.planSegments(two.body).offenders?.join(""));
{
  const town = d.composeDigest([item({ place: "Descanso Gardens, La Cañada Flintridge", summary: "Día de los Muertos crafts at the café." })]);
  ok("an accented letter loses its accent, not itself (10 Nov: \"La Caada Flintridge\")",
    town.body.includes("La Canada Flintridge") && town.card.includes("Dia de los Muertos crafts at the cafe.") && seg.planSegments(town.body).encoding === "gsm7");
  /* 13 Nov, a parent-eyes review: nine segments by SMS. */
  ok("the SMS leaves each summary to the card, keeps every link and number, and says who and how to stop",
    !town.body.includes("Dia de los Muertos crafts at the cafe.") && town.body.startsWith("Pando: your Saturday list") && /STOP stops all texts\.$/.test(town.body) && /STOP stops all texts\.$/.test(town.card));
}
/* The longest items the reader lets through: title 100, when 60, place 60, summary 180, a 400-character link. */
const longest = Array.from({ length: 5 }, (_, i) =>
  item({ title: "T".repeat(99) + i, when_text: "W".repeat(60), place: "P".repeat(60), summary: "S".repeat(180), url: `https://example.org/${"x".repeat(380)}${i}` }));
const capped = d.composeDigest(longest);
ok(`five of the longest items stay within Twilio's ${d.DIGEST_MAX_CHARS} characters`, capped.body.length <= d.DIGEST_MAX_CHARS, String(capped.body.length));
ok("by leaving items out whole, never cutting a link", capped.included < 5 && capped.included > 0 &&
  longest.slice(0, capped.included).every((it) => capped.body.includes(it.url)));
const ordinary = d.composeDigest(picked);
ok("five ordinary items all fit", ordinary.included === picked.length && ordinary.body.length <= d.DIGEST_MAX_CHARS);

console.log("\n=== its own yes ===");
ok("DIGEST turns it on, DIGEST OFF turns it off",
  d.digestCommand("digest") === "on" && d.digestCommand("Digest on!") === "on" && d.digestCommand("DIGEST OFF") === "off" && d.digestCommand("stop digest") === "off");
ok("a question that mentions a digest is a question", d.digestCommand("is there a digest of camps?") === null);
ok("STOP DIGEST is not the carrier's STOP, which ends everything", tpl.keywordOf("STOP DIGEST") === null && tpl.keywordOf("STOP") === "opt_out");
ok("the /join tick has its own words and version",
  /DIGEST_CONSENT_TEXT_VERSION = "digest-2026-11-03"/.test(read("lib/consent.ts")) && /weekly digest of local events, camps and classes \(optional\)/.test(read("lib/consent.ts")));
ok("a profile saved again never undoes a DIGEST OFF: the tick is written only once",
  /'digest', 'opted_in'[\s\S]{0,200}where not exists \(select 1 from consents where person_id = \$\{personId\}::uuid and scope = 'digest'\)/.test(read("lib/server/repo/profile.ts")));
ok("a parent who already joined is not shown a tick that would record nothing",
  /\{!alreadySaved && \(\s+<Consent\s+id="weekly-digest"/.test(read("components/seed/InviteLanding.tsx")));
const repo = read("lib/server/repo/digest.ts");
ok("only somebody whose newest digest consent is a yes is sent it",
  /k\.scope = 'digest'[\s\S]{0,80}order by k\.captured_at desc limit 1\) = 'opted_in'/.test(repo));

console.log("\n=== sending ===");
const jobs = read("lib/server/repo/jobs.ts");
const body = jobs.slice(jobs.indexOf("export async function runWeeklyDigest"));
ok("nobody signed up, no agent run", body.indexOf("hasDigestRecipients(") > 0 && body.indexOf("hasDigestRecipients(") < body.indexOf("digestEdition("));
ok("claimed before it is sent, so a failed write never means a second copy",
  body.indexOf("claimDigestSend(") > 0 && body.indexOf("claimDigestSend(") < body.indexOf("sendSms("));
ok("a send that may pass gives the claim back; STOP keeps it",
  /\} else \{\s+\/\*[^*]*\*\/\s+failed\+\+;\s+await releaseDigestSend/.test(body) && /result\.reason === "opted_out"\) \{\s+\/\*[^*]*\*\/\s+skipped\+\+;\s+\}/.test(body));
ok("a settled edition with no items still reaches its families, for the other groups' items (review, 11 Nov)",
  /if \(before && before\.attempts >= DIGEST_AGENT_ATTEMPTS\) return \{ \.\.\.before, items: \[\] \};/.test(repo) &&
    /const settled = stored\.data\.status !== "failed" \|\| stored\.data\.attempts >= DIGEST_AGENT_ATTEMPTS;/.test(repo));
ok("the edition is judged on what the agent returned", /editionOutcome\(\{ end: run\.end, parsed: run\.parsed, returned: run\.returned, kept: run\.items\.length \}\)/.test(repo));
ok("an edition that failed is not sent from, and is tried again", /if \(before && before\.status !== "failed"\) return before;/.test(repo) &&
  /where digest_editions\.status = 'failed'/.test(repo));
const sms = read("lib/server/sms.ts");
ok("its own send category", /\| "digest";/.test(sms) && /category: "digest"/.test(jobs));
ok("held in quiet hours like an Ask", policy.quietHoursBlocks({ category: "digest", inReplyTo: false, quiet: true, transport: "sms" }));
ok("and the contributor-protection step is outreach only, so it never counts", /if \(category === "outreach"\) \{\s+if \(!input\.personId\)/.test(sms));
ok("the schedule note lists it (Supabase Cron since 11 Nov)", /all eleven jobs[\s\S]{0,300}weekly_digest/.test(read("../deploy/.env.example")) &&
  /cron\.schedule\('pando-weekly_digest'/.test(read("drizzle/0068_supabase_cron.sql")));

console.log("\n=== the agent ===");
const agent = read("lib/server/digest-agent.ts");
ok("the agent reads its blocks with notePageBlocks and checks against them",
  /notePageBlocks\(response\.content, seen\);/.test(agent) &&
    /readAgentItems\(raw, \{ editionDate, seenUrls: seen\.urls, pages: seen\.pages, state \}, dropped, relinked\)/.test(agent) &&
    /relinked: run\.relinked,/.test(read("lib/server/repo/digest.ts")));
{
  /* The blocks as the SDK gives them (BetaServerToolUseBlock, BetaWebSearchToolResultBlock, BetaWebFetchToolResultBlock). */
  const fetchUse = (id: string, url: string) => ({ type: "server_tool_use", name: "web_fetch", id, input: { url } });
  const fetched = (id: string, url: string, text: string, title = "") =>
    ({ type: "web_fetch_tool_result", tool_use_id: id, content: { type: "web_fetch_result", url, retrieved_at: null, content: { type: "document", title, citations: null, source: { type: "text", media_type: "text/plain", data: text } } } });
  const failed = (id: string) => ({ type: "web_fetch_tool_result", tool_use_id: id, content: { type: "web_fetch_tool_result_error", error_code: "url_not_in_prior_context" } });
  const search = (...urls: string[]) => [{ type: "server_tool_use", name: "web_search", id: "s", input: { query: "q" } },
    { type: "web_search_tool_result", tool_use_id: "s", content: urls.map((url) => ({ type: "web_search_result", url, title: "Events", encrypted_content: "x", page_age: null })) }];

  const a = d.seenPages();
  d.notePageBlocks([...search("https://lib.org/calendar"), fetchUse("f1", "https://lib.org/event/1"), fetched("f1", "https://www.lib.org/event/1/", "Renaissance Fair, June 27")], a);
  ok("a search result is seen, and counted as a search", a.urls.has(d.urlKey("https://lib.org/calendar")!) && a.searches === 1);
  ok("a search result alone carries no page text: not checked", !a.pages.has(d.urlKey("https://lib.org/calendar")!));
  ok("a page read is seen with its text, at the address asked for and the one returned",
    a.pages.get(d.urlKey("https://lib.org/event/1")!)?.text.includes("Renaissance Fair") === true && a.urls.size === 2);

  const b = d.seenPages();
  d.notePageBlocks([fetchUse("f2", "https://x.org/teen-ukulele"), failed("f2")], b);
  ok("a failed fetch is not seen (review, 10 Nov: the SDK's type is web_fetch_tool_result_error)",
    b.urls.size === 0 && b.pages.size === 0 &&
      d.readAgentItems([{ ...good, url: "https://x.org/teen-ukulele" }], { editionDate: ctx.editionDate, seenUrls: b.urls, pages: b.pages }).length === 0);

  const c = d.seenPages();
  d.notePageBlocks([fetchUse("f3", "https://lib.org/flyer.pdf"),
    { type: "web_fetch_tool_result", tool_use_id: "f3", content: { type: "web_fetch_result", url: "https://lib.org/flyer.pdf", retrieved_at: null, content: { type: "document", title: null, citations: null, source: { type: "base64", media_type: "application/pdf", data: "JVBER" } } } },
    ...search("https://lib.org/flyer.pdf")], c);
  ok("a PDF read is seen but not checked, and a later search result does not change that",
    c.urls.has(d.urlKey("https://lib.org/flyer.pdf")!) && c.pages.get(d.urlKey("https://lib.org/flyer.pdf")!) === null);

  const e = d.seenPages();
  d.notePageBlocks([...search("https://kidspacemuseum.org/events/dia")], e);
  d.notePageBlocks([fetchUse("f4", "https://kidspacemuseum.org/events/dia"), fetched("f4", "https://kidspacemuseum.org/events/dia", "Dia de los Muertos celebration on Nov 8. Plan your visit: open daily from ten to five, free parking on site, members free, tickets at the door, strollers welcome, cafe and garden open, accessible entrance by the main gate.")], e);
  ok("across responses, a search then a read: the read's text is what is checked",
    d.readAgentItems([good], { editionDate: ctx.editionDate, seenUrls: e.urls, pages: e.pages }).length === 1 &&
      d.readAgentItems([{ ...good, title: "Beginning Ukulele for Teens" }], { editionDate: ctx.editionDate, seenUrls: e.urls, pages: e.pages }).length === 0);
}
console.log("\n=== the dates it states are on the page it read (12 Nov) ===");
{
  const ed = "2026-12-12";
  const at = (when_text: string, starts_on: string | null, ends_on: string | null = starts_on) => ({ when_text, starts_on, ends_on });
  const carol = "A Christmas Carol at A Noise Within. Performances: December 13, 17-20, 22-24. Sundays at 2pm; Thursdays-Saturdays 7:30pm.";
  ok("the lab's play: Dec 16 is a night with no performance (reviewers, 12 Dec)",
    !d.datesOnPage(at("Dec 13, 16-20, 22-24", "2026-12-13", "2026-12-24"), carol, ed));
  ok("and the dates the page does give pass", d.datesOnPage(at("Dec 13, 17-20, 22-24", "2026-12-13", "2026-12-24"), carol, ed) &&
    d.datesOnPage(at("Fri Dec 18, 7:30pm", "2026-12-18"), carol, ed));
  const southPas = "Toddler Storytime, Tuesdays 10:30-11am. Fall session: September 8 - November 21. Winter session: January 6 - March 10.";
  ok("the lab's storytime: a Tuesday between two sessions is not a Tuesday it meets (reviewers, 12 Dec)",
    !d.datesOnPage(at("Tue Dec 15, 10:30-11am", "2026-12-15"), southPas, ed));
  ok("a Tuesday inside a session is", d.datesOnPage(at("Tue Jan 12, 10:30-11am", "2027-01-12"), southPas, ed));
  ok("weekly with no season given: the weekday is enough",
    d.datesOnPage(at("Thursdays, 10am (next: Dec 17)", "2026-12-17", null), "Toddler Storytime every Thursday at 10am. Updated Oct 3.", ed));
  ok("a range across months holds the days inside it",
    d.datesOnPage(at("Daily through Jan 10", "2026-12-13", "2027-01-10"), "Winter Frolic: November 6, 2026 - January 10, 2027", ed) &&
      d.datesOnPage(at("Mon Dec 21, 5:30-10pm", "2026-12-21"), "Enchanted Forest of Light, Nov 22 through Jan 9, nightly", ed));
  ok("a time is not a day: \"Dec 10, 4-6pm\" claims Dec 10 only",
    [...d.textDates("Thursdays (next: Dec 10, 4-6pm)").days].join() === "12-10" && [...d.textDates("Dec 13, 10:30-11am").days].join() === "12-13");
  ok("an open start holds what follows it (the lab, 19 Dec: Kidspace's page says only \"Starting November 6\")",
    d.datesOnPage(at("Daily through Sun Jan 10, 2027", "2026-12-20", "2027-01-10"), "Join the Merrymaking! Starting November 6, Kidspace Winter Frolic returns!", ed) &&
      !d.datesOnPage(at("Sat Oct 31", "2026-10-31"), "Starting November 6, Winter Frolic returns", ed));
  ok("a weekly date before a session's start is not held by it",
    !d.datesOnPage(at("Tue Dec 15", "2026-12-15"), "Storytime on Tuesdays. Winter session begins January 6.", ed) &&
      d.datesOnPage(at("Tue Jan 12", "2027-01-12"), "Storytime on Tuesdays. Winter session begins January 6.", ed));
  /* 13 Nov, a parent-eyes review: a web finding for a swim class in May was offered in November. */
  ok("a text whose every dated day has passed is past; one with no year, an open start or a weekly day is not",
    d.datesAllPast("Sunday 9:30-10:00 AM, May 3-31, 2026, $100.00", "2026-11-13") &&
      d.datesAllPast("Summer camp June 8 - Aug 14, 2026", "2026-11-13") &&
      !d.datesAllPast("Jan 5 - Mar 1, 2027", "2026-11-13") &&
      !d.datesAllPast("Dec 13", "2026-11-13") &&
      !d.datesAllPast("Mondays 4-6pm, starts Jan 11", "2026-11-13") &&
      !d.datesAllPast("Nov 2 - Dec 20, 2026", "2026-11-13"));
  ok("web findings drop one whose dates have all passed", /!datesAllPast\(`\$\{f\.what\} \$\{f\.detail \?\? ""\}`, today\)/.test(fs.readFileSync(new URL("../lib/server/web-search.ts", import.meta.url), "utf8")));
  ok("\"from Dec 1 to Dec 5\" is a range, not an open start", (() => { const t = d.textDates("from Dec 1 to Dec 5"); return t.opens.length === 0 && t.days.has("12-03"); })());
  ok("across the new year, by the edition's year", d.datesOnPage(at("Sat Jan 2", "2027-01-02"), "Dec 20 - Jan 3 holiday camp", ed) &&
    !d.datesOnPage(at("Sat Jan 9", "2027-01-09"), "Dec 20 - Jan 3 holiday camp", ed));
  /* The blind review of 12 Nov, each its own input. */
  const days = (t: string) => [...d.textDates(t).days].sort().join(",");
  ok("a time, an age or a count after a date is not a day",
    days("Dec 13, 10 am") === "12-13" && days("Dec 13, 10 a.m.") === "12-13" && days("Dec 13, 4 - 6 pm") === "12-13" && days("Dec 13, 3-5 years") === "12-13",
    [days("Dec 13, 10 am"), days("Dec 13, 4 - 6 pm"), days("Dec 13, 3-5 years")].join(" | "));
  ok("day-first dates are read", days("13 December, 20 December") === "12-13,12-20" && days("Saturday 13 December, Saturday 20 December") === "12-13,12-20" &&
    days("Sat 13th Dec and Sat 20th Dec") === "12-13,12-20" && d.datesOnPage(at("Dec 13 and Dec 20", "2026-12-13"), "13 December, 20 December, Dec 3", ed));
  ok("lists joined by \"or\", weekdays or brackets keep their month",
    d.datesOnPage(at("Dec 13", "2026-12-13"), "Dec 12 or 13", ed) && d.datesOnPage(at("Dec 13", "2026-12-13"), "Dec 12 (Sat) and 13 (Sun)", ed) &&
      d.datesOnPage(at("Dec 13", "2026-12-13"), "Sat Dec 12 and Sun 13", ed));
  ok("a weekly date stands beside other dates of its month and a break after it",
    d.datesOnPage(at("Thursdays 10am (next: Dec 17)", "2026-12-17", null), "Thursdays 10am. Posted Dec 3.", ed) &&
      d.datesOnPage(at("Thursdays 10am (next: Dec 17)", "2026-12-17", null), "Thursdays 10am. Winter break Dec 21 - Jan 3", ed));
  ok("but never on a day the page says is closed",
    !d.datesOnPage(at("Thu Dec 24", "2026-12-24"), "Thursdays 10am. Closed Dec 24 and Dec 31", ed) &&
      !d.datesOnPage(at("Mon Dec 14", "2026-12-14"), "Closed Mondays. Winter Fest Jan 20", ed) &&
      !d.datesOnPage(at("Thu Dec 24", "2026-12-24"), "Thursdays. No classes Dec 21 - Jan 3", ed));
  ok("a page whose only dates are closures vetoes those days only",
    d.datesOnPage(at("Sat Nov 21", "2026-11-21"), "Open daily. Closed Nov 26.", ed) && !d.datesOnPage(at("Thu Nov 26", "2026-11-26"), "Open daily. Closed Nov 26.", ed));
  ok("a camp named for a break is not a closure", d.datesOnPage(at("Nov 23-25", "2026-11-23", "2026-11-25"), "Thanksgiving Break Camp: Nov 23-25, 9am-2pm", ed));
  ok("a registration's start is not the event's",
    !d.datesOnPage(at("Dec 13", "2026-12-13"), "Registration begins Dec 1. Event Dec 20", ed) &&
      !d.datesOnPage(at("Dec 13", "2026-12-13"), "Registration: begins Dec 1. Event Dec 20", ed));
  ok("a date in another year does not stand", !d.datesOnPage(at("Dec 13", "2026-12-13"), "Dec 13, 2025", ed) &&
    d.datesOnPage(at("Dec 13", "2026-12-13"), "Dec 13, 2026", ed) && !d.datesOnPage(at("Dec 13", "2026-12-13"), "Women's Day, Dec 13, 2027", ed));
  ok("one day, one place, named two ways, is one thing (the lab, 14 Nov: Barks & Books twice)",
    d.sameThing(item({ title: "Barks & Books: read aloud to a therapy dog", place: "South Pasadena Public Library", starts_on: "2026-11-18" }),
      item({ title: "Barks & Books with Sawyer the therapy dog", place: "South Pasadena Public Library", starts_on: "2026-11-18" })) &&
      !d.sameThing(item({ title: "Toddler Storytime", place: "Altadena Library", starts_on: "2026-11-18" }), item({ title: "Preschool Storytime", place: "Altadena Library", starts_on: "2026-11-18" })) &&
      !d.sameThing(item({ title: "Barks & Books: read aloud to a therapy dog", place: "South Pasadena Public Library", starts_on: "2026-11-18" }),
        item({ title: "Barks & Books with Sawyer the therapy dog", place: "Arcadia Public Library", starts_on: "2026-11-18" })));
  ok("one place written two ways is one place (the real-graph run: Baby Rhyme Time twice)",
    d.sameThing(item({ title: "Baby Rhyme Time at Sierra Madre Library", place: "Sierra Madre Library", starts_on: "2026-11-16" }),
      item({ title: "Baby Rhyme Time at Sierra Madre Library", place: "Sierra Madre Public Library", starts_on: "2026-11-16" })) &&
      d.poolForFamily([item({ title: "Baby Rhyme Time at Sierra Madre Library", place: "Sierra Madre Public Library", starts_on: "2026-11-16", age_min: 0, age_max: 2 })],
        [[item({ title: "Baby Rhyme Time at Sierra Madre Library", place: "Sierra Madre Library", starts_on: "2026-11-16", age_min: 0, age_max: 2 })]], [0]).length === 1);
  ok("one title at two places is two things, at one place one",
    !d.sameThing(item({ title: "Storytime", place: "Altadena Library", starts_on: "2026-12-12" }), item({ title: "Storytime", place: "Pasadena Central Library", starts_on: "2026-12-12" })) &&
      d.sameThing(item({ title: "Storytime", place: "Altadena Library", starts_on: "2026-12-12" }), item({ title: "Storytime", place: "Altadena Library", starts_on: "2026-12-19" })) &&
      !d.sameThing(item({ title: "日本語", starts_on: "2026-12-12" }), item({ title: "中文", starts_on: "2026-12-13" })));
  ok("numeric and ISO dates count", d.datesOnPage(at("Sat Dec 19", "2026-12-19"), "Saturday 12/19/2026 at the park", ed) &&
    d.datesOnPage(at("Sat Dec 19", "2026-12-19"), "date: 2026-12-19", ed));
  ok("a page with no dates at all cannot be checked", d.datesOnPage(at("Sat Dec 19", "2026-12-19"), "Our camps are fun for everyone.", ed));
  ok("with no date in its words, its first or last date stands for it",
    d.datesOnPage(at("Daily", "2026-11-06", "2027-01-10"), "Open November 6 - January 10", ed) &&
      !d.datesOnPage(at("Daily", "2026-12-13", "2026-12-20"), "Open November 6 - November 30", ed));
  const key = d.urlKey(good.url)!;
  const why: Record<string, number> = {};
  const kept = d.readAgentItems([{ ...good, title: "A Christmas Carol at A Noise Within", when_text: "Dec 13, 16-20, 22-24", starts_on: "2026-12-13", ends_on: "2026-12-24" }],
    { editionDate: ed, seenUrls: seen, pages: new Map([[key, { url: good.url, text: carol }]]) }, why);
  ok("readAgentItems drops it, counted as date_not_on_page", kept.length === 0 && why.date_not_on_page === 1, JSON.stringify(why));
}

console.log("\n=== the page itself: another state, stale, empty (the real-graph run, 14 Nov) ===");
{
  const pi = (await import(`../lib/public-info.ts?v=${Date.now()}`)) as typeof import("../lib/public-info.ts");
  const state = { code: "CA", name: "California", elsewhere: (t: string) => pi.inAnotherState({ name: t, area: null }, "California") };
  const ed = "2026-11-14";
  const key = d.urlKey(good.url)!;
  const on = (text: string) => ({ editionDate: ed, seenUrls: seen, pages: new Map([[key, { text, url: good.url }]]), state });
  const teen = { ...good, title: "Teen Takeover at Central Library", when_text: "Tue Nov 17, 6pm", starts_on: "2026-11-17", ends_on: "2026-11-17" };
  const why: Record<string, number> = {};
  ok("an event on a page in Texas is dropped (Teen Takeover was Pasadena, TX)",
    d.readAgentItems([teen], on("Teen Takeover at Central Library, Tuesdays 6pm, Nov 17. Pasadena Public Library, 1201 Jeff Ginn Memorial Dr, Pasadena, TX 77506, a place for teens to meet friends and make things every week of the year."), why).length === 0 &&
      why.another_state === 1, JSON.stringify(why));
  ok("a California page that mentions Texas in passing is not", !d.placedElsewhere("Story time | Pasadena | x", "Pasadena, CA 91101. Our sister library in Austin, TX says hello.", state));
  ok("nor is a page that names no state", !d.placedElsewhere("Story time | Pasadena | x", "Story time every Tuesday in the children's room.", state));
  ok("an item that names another state itself is dropped", d.placedElsewhere("Aqua-Tots Pasadena, TX swim | Pasadena | x", null, state));
  ok("an event on a page whose every year is past is stale; a copyright year does not count",
    d.pageIsStale("Teen Drop-in DIY, last Wednesday, Nov 29, 2023. © 2026 Monrovia Public Library", ed) &&
      !d.pageIsStale("Storytime Nov 18, 2026. © 2019", ed) && !d.pageIsStale("Storytime on Wednesdays", ed));
  const longCamp = "Winter break camp for ages 5-12, Dec 21-31, registration open now, see our 2024 photos from last year and sign up today for the coming season of fun activities, crafts, sports and games with our caring counselors";
  ok("a camp's old page is not judged stale, an event's is",
    d.readAgentItems([{ ...good, kind: "camp", title: "Winter break camp", when_text: "Dec 21-31", starts_on: "2026-12-21", ends_on: "2026-12-31" }], on(longCamp)).length === 1);
  ok("a page with next to nothing on it is no evidence (a \"storytime-test\" page came back blank)",
    d.pageIsEmpty("Baby Storytime | ") && !d.pageIsEmpty(longCamp));
  ok("the agent passes the market's state and the web answer's inAnotherState",
    /elsewhere: \(text: string\) => inAnotherState\(\{ name: text, area: null \}, m\.stateName\)/.test(read("lib/server/digest-agent.ts")));
}

console.log("\n=== a link it never opened takes the page it read (11 Nov) ===");
{
  const cal = "https://kidspacemuseum.org/calendar/";
  const pages = new Map<string, import("../lib/digest.ts").PageEvidence>([
    [d.urlKey(cal)!, { url: cal, text: "Calendar. Toddler Tuesday, Nov 17. Winter Frolic, through Jan 10. Kidspace open Monday, Nov 23. Plan your visit: open daily from ten to five, free parking on site, members free, tickets at the door, strollers welcome, cafe and garden open, accessible entrance by the main gate." }],
    [d.urlKey("https://pasadenanow.com/weekendr/week")!, { url: "https://pasadenanow.com/weekendr/week", text: "This week: Winter Frolic at Kidspace and more." }],
  ]);
  const seenHere = new Set([...pages.keys()]);
  const frolic = { ...good, title: "Winter Frolic at Kidspace", when_text: "Daily through Jan 10", starts_on: "2026-11-06", ends_on: "2027-01-10", url: "https://kidspacemuseum.org/event/winter-frolic-5/" };
  const n = { n: 0 };
  const kept = d.readAgentItems([frolic], { editionDate: ctx.editionDate, seenUrls: seenHere, pages }, {}, n);
  ok("an event's own address seen only inside a calendar it read takes the calendar's address (the lab: 5 of 5 lost)",
    kept.length === 1 && kept[0].url === cal && n.n === 1, JSON.stringify(kept[0]?.url));
  ok("of two pages that name it, the item's own host first", d.pageNaming("Winter Frolic at Kidspace", frolic.url, pages) === cal);
  ok("a page that does not name it is no home for it",
    d.readAgentItems([{ ...frolic, title: "Gingerbread Workshop" }], { editionDate: ctx.editionDate, seenUrls: seenHere, pages }).length === 0);
  const fair = new Map<string, import("../lib/digest.ts").PageEvidence>([
    ["sglib.org/event/fair", { url: "https://sglib.org/event/fair", text: "Renaissance Fair. Craft workshop for ages 5-12. Sat Jun 27." }],
  ]);
  ok("one shared word never moves a made-up item to a page (review, 11 Nov: \"Teen Pottery Workshop\" on a fair's \"craft workshop\")",
    d.pageNaming("Teen Pottery Workshop", "https://sglib.org/event/pottery", fair) === null &&
      d.readAgentItems([{ ...good, title: "Teen Pottery Workshop", url: "https://sglib.org/event/pottery" }],
        { editionDate: ctx.editionDate, seenUrls: new Set(fair.keys()), pages: fair }).length === 0);
  ok("nor does a one-word title", d.pageNaming("Pottery", "https://sglib.org/event/pottery",
    new Map([["sglib.org/x", { url: "https://sglib.org/x", text: "Pottery for adults" }]])) === null);
  ok("an item's own page needs most of its words, not half",
    !d.onPage("Teen Pottery Workshop", { url: "https://x.org/", text: "Craft workshop" }) &&
      d.onPage("Beginning Ukulele Class", { url: "https://x.org/", text: "Beginning Ukulele, Fridays" }));
  ok("never to another event's own page that lists it among others (the lab, 14 Nov: Bob Lucas storytime moved to Loma Alta's)",
    d.pageNaming("Preschool Storytime at Bob Lucas Library", "https://altadenalibrary.libnet.info/event/999",
      new Map([["altadenalibrary.libnet.info/event/16342908", { url: "https://altadenalibrary.libnet.info/event/16342908", text: "Toddler Storytime at Loma Alta Park. Other events: Preschool Storytime at Bob Lucas Library, Nov 16." }]])) === null &&
      d.isOneEventPage("https://www.visitpasadena.com/events/enchanted-forest-of-light/") &&
      !d.isOneEventPage("https://kidspacemuseum.org/calendar/") && !d.isOneEventPage("https://www.cityofpasadena.net/library/teens/teen-events/") &&
      !d.isOneEventPage("https://www.oldpasadena.org/visit/events/"));
  ok("a title with nothing to check is never moved", d.pageNaming("Toddler Tuesday", "https://kidspacemuseum.org/event/tt/", pages) === null);
  ok("an aggregator's listing page is never the new home",
    d.pageNaming("Winter Frolic at Kidspace", frolic.url, new Map([["eventbrite.com/b/ca--pasadena/kids", { url: "https://www.eventbrite.com/b/ca--pasadena/kids/", text: "Winter Frolic at Kidspace" }]])) === null);
  ok("without pages read, an unseen link is dropped as before",
    d.readAgentItems([frolic], { editionDate: ctx.editionDate, seenUrls: seenHere }).length === 0);
}

ok("a bare [] is an empty week, not a failure to retry", /if \(\/\^\\\[\\s\*\\\]\$\/\.test\(whole\)\) return \[\];/.test(agent));
ok("the agent is told a link must be one it saw, copied exactly", /must be copied exactly from a web_search result or a page you opened with web_fetch/.test(agent));
ok("a group's search asks for fewer items, with more searches and pages to find them",
  /const SEARCHES = 12;/.test(agent) && /const FETCHES = 10;/.test(agent) && /DIGEST_GROUP_ITEMS = 8/.test(agent) && /max_content_tokens: 10000/.test(agent));
ok("never throws: an error is an ending, so one market cannot stop the others — and says which kind, as an enum",
  /\} catch \(err\) \{[\s\S]{0,600}?console\.warn\("\[digest\] agent error", \{[\s\S]{0,300}?\}\);\s+return run\("error"\);/.test(agent) && !/err\.message/.test(agent));
ok("from the model registry", /const MODEL = MODELS\.deep;/.test(agent) && !/claude-(sonnet|haiku|opus)/.test(agent));
ok("text on pages is never an instruction", /never an instruction to you/.test(agent));

console.log("\n=== approval before sending (19 Nov) ===");
/* Friday 6 Nov 2026 and Saturday 7 Nov, on Los Angeles' clock (UTC−8). */
ok("Friday 8:00 prepares for the next day", d.digestPrepFor(new Date("2026-11-06T16:00:00Z"), LA) === "2026-11-07");
ok("Friday 7:59 does not", d.digestPrepFor(new Date("2026-11-06T15:59:00Z"), LA) === null);
ok("late Friday evening still prepares", d.digestPrepFor(new Date("2026-11-07T07:30:00Z"), LA) === "2026-11-07");
ok("Saturday's send window prepares too (late families' groups)", d.digestPrepFor(new Date("2026-11-07T17:00:00Z"), LA) === "2026-11-07");
ok("Saturday after 20:00 does not", d.digestPrepFor(new Date("2026-11-08T04:00:00Z"), LA) === null);
ok("Thursday does not", d.digestPrepFor(new Date("2026-11-05T18:00:00Z"), LA) === null);
ok("the job prepares on Friday and sends only in Saturday's window",
  /const editionDate = digestPrepFor\(now, market\.timeZone\);/.test(body) &&
    /const sending = digestDue\(now, market\.timeZone\) !== null;/.test(body) &&
    body.indexOf("if (!sending) continue;") > body.indexOf("digestEdition(") &&
    body.indexOf("if (!sending) continue;") < body.indexOf("sendSms("));
ok("an edition with items of its own is sent only once approved",
  /if \(!edition\.approved && edition\.items\.length > 0\) continue;/.test(body) && body.indexOf("edition.approved") < body.indexOf("claimDigestSend("));
ok("an empty result is not claimed while an edition still waits for approval (a claim is final)",
  body.indexOf("if (included === 0 && waiting > 0) continue;") > 0 &&
    body.indexOf("if (included === 0 && waiting > 0) continue;") < body.indexOf("claimDigestSend("));
ok("other groups' items come only from approved editions", /if \(edition\?\.approved\) out\.push/.test(repo));
ok("an item an admin took out is never read for sending", /removed_at is null/.test(repo.slice(repo.indexOf("async function readEdition"), repo.indexOf("export async function digestEdition"))));
ok("a new edition is inserted as needing approval", /approval \? sql`, approval_required` : sql``/.test(repo) && /approval \? sql`, true` : sql``/.test(repo));
ok("approved is 'not required, or approved_at set'", /\(not approval_required or approved_at is not null\)/.test(repo));
ok("before drizzle/0069 nothing changes: the columns are read only once they exist",
  /column_name = 'approval_required'/.test(repo) && /\$\{approval \? sql`\(not approval_required or approved_at is not null\)` : sql`true`\}/.test(repo));
const mig = read("drizzle/0069_digest_approval.sql");
ok("the migration is additive: no existing row rewritten, old editions need no approval",
  /approval_required boolean NOT NULL DEFAULT false/.test(mig) && !/\bUPDATE\b|\bDELETE\b|\bDROP\b/i.test(mig.replace(/^--.*$/gm, "")));
const journal = JSON.parse(read("drizzle/meta/_journal.json")) as { entries: Array<{ tag: string; when: number }> };
const last = journal.entries[journal.entries.length - 1];
ok("its journal entry is the newest", last.tag === "0069_digest_approval" && journal.entries.every((e) => e === last || e.when < last.when));
const write = read("lib/server/repo/admin-write.ts");
const approve = write.slice(write.indexOf('case "digest.approve"'), write.indexOf('case "digest.unapprove"'));
ok("approve: only a prepared, unapproved, found edition; the actor is recorded",
  /where id = \$\{target\}::uuid and approval_required and approved_at is null and status = 'ready'/.test(approve) && /approved_by = \$\{ctx\.actor\}/.test(approve));
const unapprove = write.slice(write.indexOf('case "digest.unapprove"'), write.indexOf('case "digest_item.remove"'));
ok("an approval is not taken back once anything from it went out, its own families or another group's",
  /s\.edition_id = \$\{target\}::uuid\s+or s\.item_ids && /.test(unapprove) && /reason: "digest_already_sent"/.test(unapprove));
const items = write.slice(write.indexOf('case "digest_item.remove"'), write.indexOf("default: {", write.indexOf('case "digest_item.remove"')));
ok("an item is changed only while its edition waits; never once approved", /if \(edition\[0\]\.approved_at\) return \{ applied: false, reason: "digest_approved" \};/.test(items));
ok("taken out is kept on the record, not deleted", /set removed_at = /.test(items) && !/delete from digest_items/.test(items));
console.log("\n=== one number, while the jobs are paused (19 Nov) ===");
ok("the Saturday is today's on a Saturday", d.nextDigestDate(new Date("2026-11-21T18:00:00Z"), LA) === "2026-11-21");
ok("and the next one otherwise", d.nextDigestDate(new Date("2026-11-19T18:00:00Z"), LA) === "2026-11-21" && d.nextDigestDate(new Date("2026-11-22T18:00:00Z"), LA) === "2026-11-28");
ok("a Saturday morning in UTC that is Friday in Los Angeles is Saturday's", d.nextDigestDate(new Date("2026-11-21T06:00:00Z"), LA) === "2026-11-21");
const one = jobs.slice(jobs.indexOf("export async function prepareDigestFor"), jobs.indexOf("/**\n * 13.4") > 0 ? jobs.indexOf("/**\n * 13.4") : jobs.indexOf("13.4 — the retry sweep"));
ok("found by phone with no digest consent asked, the market the person's own", /export async function digestFamilyByPhone/.test(repo) &&
  !/scope = 'digest'/.test(repo.slice(repo.indexOf("export async function digestFamilyByPhone"), repo.indexOf("async function familyRows"))));
ok("the real audience still needs the yes", /p\.is_test = \$\{isTest\}[\s\S]{0,200}k\.scope = 'digest'[\s\S]{0,80}= 'opted_in'/.test(repo.slice(repo.indexOf("export async function digestAudience"))));
ok("stored as test editions, so a real Saturday never sends from them",
  /digestEdition\(one\.market\.id, one\.editionDate, profile, true\)/.test(one) && /digestEdition\(one\.market\.id, one\.editionDate, one\.existing, true\)/.test(one));
ok("grouped as the job groups a family alone", /groupFamilies\(\[one\.facts\]\)/.test(one));
/* Since Preview (19 Nov) Send's checks live in `composeOne`, which both use. */
ok("Send never starts a search: only a group Prepare drew", /if \(!one\.existing\) return \{ refused: \{ ok: false, reason: "not_prepared"/.test(one) &&
  one.indexOf('reason: "not_prepared"') < one.lastIndexOf("digestEdition("));
ok("and only once approved", /if \(!edition\.approved && edition\.items\.length > 0\) return \{ refused: \{ ok: false, reason: "not_approved"/.test(one));
ok("to that number only, through the send layer (STOP, quiet hours)", /to: one\.family\.phone,/.test(one) && /sendSms\(\{/.test(one) && !/for \(const /.test(one.slice(one.indexOf("export async function sendDigestTo"))));
ok("a test can be sent again: the earlier claim is replaced, and a refused send gives it back",
  one.indexOf("await releaseDigestSend(edition.id, one.family.person_id);") < one.indexOf("claimDigestSend(") &&
    /if \(!result\.sent\) \{\s+await releaseDigestSend/.test(one));
const route = read("app/api/admin/digest-one/route.ts");
ok("the route: an admin session, this site only, JSON", /refuseForeignAdminWrite\(request, "digest-one"\)/.test(route) && /if \(!session\) return NextResponse\.json\(\{ error: "Not signed in" \}, \{ status: 401 \}\)/.test(route));
ok("the search runs after the response", /after\(async \(\) => \{[\s\S]{0,80}prepareDigestFor\(phone\)/.test(route) && /status: 202/.test(route));
ok("every press is an audit row with the person, never the phone (invariant 7)",
  /auditDigestOne\(session\.user, "digest\.prepare_for", family\.person_id/.test(route) && /auditDigestOne\(session\.user, "digest\.send_to", personId/.test(route) &&
    !/phone/.test(repo.slice(repo.indexOf("export async function auditDigestOne"), repo.indexOf("async function familyRows")).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\*.*$/gm, "")));
/* 19 Nov: Preview — the exact text Send would send, nothing written. */
const previewFn = one.slice(one.indexOf("export async function previewDigestFor"), one.indexOf("export async function sendDigestTo"));
const composeFn = one.slice(one.indexOf("async function composeOne"), one.indexOf("export async function previewDigestFor"));
ok("Preview and Send compose through the same function, so the two cannot differ",
  /const c = await composeOne\(phone, now\);/.test(previewFn) && /const c = await composeOne\(phone, now\);/.test(one.slice(one.indexOf("export async function sendDigestTo"))));
ok("Preview writes nothing: no claim, no text, no release", !/claimDigestSend|releaseDigestSend|sendSms/.test(previewFn + composeFn));
ok("and composing never starts a search: only a group Prepare drew", /if \(!one\.existing\) return \{ refused/.test(composeFn) && composeFn.indexOf("!one.existing") < composeFn.indexOf("digestEdition("));
ok("the route's preview step answers before any audit row or send",
  (() => {
    const at = route.indexOf('if (step === "preview")');
    const block = route.slice(at, route.indexOf("try {", at));
    return at > 0 && /previewDigestFor\(phone\)/.test(block) && !/auditDigestOne|sendDigestTo/.test(block);
  })());
/* 19 Nov: the one named exception to invariant 6's quiet hours. */
ok("the one-number test is not held by quiet hours", !policy.quietHoursBlocks({ category: "digest", inReplyTo: false, quiet: true, transport: "sms", adminTest: true }));
ok("every other digest still is", policy.quietHoursBlocks({ category: "digest", inReplyTo: false, quiet: true, transport: "sms" }) &&
  policy.quietHoursBlocks({ category: "digest", inReplyTo: false, quiet: true, transport: "sms", adminTest: false }));
ok("only sendDigestTo sets it, and the send layer says so every time",
  /adminTest: "digest_one",/.test(one) &&
    /quiet hours ignored — the admin's one-number digest test/.test(sms) &&
    (() => {
      const all = [...new Set(["lib/server/repo/jobs.ts", "lib/server/inbound.ts", "lib/server/repo/outreach.ts", "lib/server/repo/admin-write.ts", "lib/server/repo/digest-followup.ts"].filter((f) => /adminTest: "digest_one"/.test(read(f))))];
      return all.length === 1 && all[0] === "lib/server/repo/jobs.ts" && (read("lib/server/repo/jobs.ts").match(/adminTest: "digest_one"/g) ?? []).length === 1;
    })());
ok("opt-out is still read before it", sms.indexOf('reason: "opted_out"') < sms.indexOf("adminTest: input.adminTest"));
ok("the log lines carry counts and enums only", !/console\.\w+\([^)]*phone/.test(one) && !/console\.\w+\([^)]*phone/.test(route));
const names = read("lib/admin/action-names.ts");
ok("the four actions are named, so each press is audited", ["digest.approve", "digest.unapprove", "digest_item.remove", "digest_item.restore"].every((a) => names.includes(`"${a}"`)));

console.log(`\n  ${pass} checks passed${fail ? `, ${fail} FAILED` : ""}.`);
if (fail) process.exit(1);

/**
 * The weekly digest, answered (11 Nov): a reply of numbers is a pick only after
 * the digest, a pick gets the details and "remind you on the day?", the
 * reminder goes on the event's morning and "how was it?" the day after, by
 * buttons, in category `digest`.
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

const f = (await import(`../lib/digest-followup.ts?v=${Date.now()}`)) as typeof import("../lib/digest-followup.ts");
const seg = (await import(`../lib/sms-segments.ts?v=${Date.now()}`)) as typeof import("../lib/sms-segments.ts");
type Item = import("../lib/digest-followup.ts").FollowupItem;

console.log("\n=== four items, four buttons (11 Nov) ===");
{
  const dg = (await import(`../lib/digest.ts?v=${Date.now()}`)) as typeof import("../lib/digest.ts");
  const rich = (await import(`../lib/sms-rich.ts?v=${Date.now()}`)) as typeof import("../lib/sms-rich.ts");
  ok("the digest's items, the numbers a reply may pick and the card's buttons agree: four",
    dg.DIGEST_MAX_ITEMS === 4 && f.PICK_MAX === dg.DIGEST_MAX_ITEMS && rich.RICH_BUTTONS.digest_pick.length === f.PICK_MAX);
}

console.log("\n=== reading a reply of numbers ===");
const picks = (t: string, n = 5) => JSON.stringify(f.readPicks(t, n));
ok("one number, several, with commas, \"and\", \"&\" or \"#\"",
  picks("2") === "[2]" && picks("1 3") === "[1,3]" && picks("1, 3") === "[1,3]" && picks("1 and 3") === "[1,3]" && picks("2 & 5") === "[2,5]" && picks("#2") === "[2]");
ok("in words, and \"all\"", picks("the first and third") === "[1,3]" && picks("all") === "[1,2,3,4,5]" && picks("all", 3) === "[1,2,3]");
ok("a question with numbers in it is not a pick", picks("2 kids under 5?") === "null" && picks("any swim for my 4 year old") === "null");
ok("a number past the digest's own is nothing; repeats count once, in order", picks("7") === "null" && picks("4", 3) === "null" && picks("3 1 3") === "[1,3]");
ok("not numbers at all is nothing", picks("hi") === "null" && picks("") === "null" && picks("yes") === "null");
ok("ordinals and \"option\" (review, 11 Nov); \"all 3\" is not \"all\"", picks("1st and 3rd") === "[1,3]" && picks("option 2") === "[2]" && picks("all 3") === "null");
ok("only numbers, none on the digest: answered with the range, not passed on (review, 11 Nov)",
  f.picksOutOfRange("5", 3) && f.picksOutOfRange("0", 3) && f.picksOutOfRange("4 and 6", 3) && !f.picksOutOfRange("2", 3) && !f.picksOutOfRange("2 kids under 5?", 3) && !f.picksOutOfRange("hi", 3) &&
    f.outOfRangeSms(3) === "That digest had 3 items - reply with a number from 1 to 3, or several (e.g. 1 3)." && /just one/.test(f.outOfRangeSms(1)));

console.log("\n=== when to remind, when to ask ===");
ok("an event after the digest: its own day", f.remindOn({ starts_on: "2026-11-17", ends_on: "2026-11-17" }, "2026-11-14") === "2026-11-17");
ok("one already running: the next Saturday while it runs, else its last day",
  f.remindOn({ starts_on: "2026-11-06", ends_on: "2027-01-10" }, "2026-11-14") === "2026-11-21" &&
    f.remindOn({ starts_on: "2026-11-06", ends_on: "2026-11-18" }, "2026-11-14") === "2026-11-18");
ok("no day at all: no reminder", f.remindOn({ starts_on: null, ends_on: null }, "2026-11-14") === null);
/* 19 Nov, the developer on a test digest: "Through Jan 10" answered "I'll text you Sat Nov 28" read as a fault. */
{
  const LA = "America/Los_Angeles";
  const frolic = { starts_on: "2026-11-06", ends_on: "2027-01-10" };
  const remind = f.remindOn(frolic, "2026-11-21")!;
  const at = f.remindAt({ starts_on: frolic.starts_on, when_text: "Through Jan 10" }, remind, LA);
  const running = f.runningUntil(frolic, remind);
  ok("an event already on is marked running, through its last day", remind === "2026-11-28" && running?.until === "2027-01-10" && running.lastDay === false);
  ok("and the answer says it is on now, through when, and that the reminder is next week",
    f.pickReplySms([{ n: 1, title: "Kidspace Winter Frolic", state: "set", at, running }], LA) ===
      "Got it - Kidspace Winter Frolic is on now through Jan 10. I'll remind you next week, Sat Nov 28 at 8am, and ask how it went after. Pick 1 again to undo.");
  const fair = { starts_on: "2026-11-06", ends_on: "2026-11-25" };
  const r2 = f.remindOn(fair, "2026-11-21")!;
  ok("ending within the week: on its last day, said so",
    /is on now through Nov 25\. I'll remind you on its last day, Wed Nov 25 at 8am/.test(
      f.pickReplySms([{ n: 2, title: "Fall Fair", state: "set", at: f.remindAt({ starts_on: fair.starts_on, when_text: "Through Nov 25" }, r2, LA), running: f.runningUntil(fair, r2) }], LA)));
  ok("an event still to come is not running", f.runningUntil({ starts_on: "2026-11-26", ends_on: "2026-11-26" }, "2026-11-26") === undefined &&
    f.runningUntil({ starts_on: "2026-11-26", ends_on: null }, "2026-11-26") === undefined);
  ok("an already-set reminder says it too", /Kidspace Winter Frolic \(on now through Jan 10\) is already set for Sat Nov 28 at 8am/.test(
    f.pickReplySms([{ n: 1, title: "Kidspace Winter Frolic", state: "already_set", at, running }], LA)));
}
ok("the feedback question the day after", f.feedbackOn("2026-11-17") === "2026-11-18" && f.feedbackOn("2026-11-30") === "2026-12-01");
ok("a pick made later counts from that day: not today, not past (review, 11 Nov)",
  f.remindOn({ starts_on: "2026-11-15", ends_on: null }, "2026-11-14", "2026-11-15") === null &&
    f.remindOn({ starts_on: "2026-11-15", ends_on: null }, "2026-11-14", "2026-11-16") === null &&
    f.remindOn({ starts_on: "2026-11-18", ends_on: null }, "2026-11-14", "2026-11-16") === "2026-11-18" &&
    f.remindOn({ starts_on: "2026-11-06", ends_on: "2027-01-10" }, "2026-11-14", "2026-11-21") === "2026-11-22");
ok("a week of camp is asked about after its last day, at most a week on; a running fair the day after its visit (review, 11 Nov)",
  f.feedbackOn("2026-11-16", { kind: "camp", starts_on: "2026-11-16", ends_on: "2026-11-20" }) === "2026-11-21" &&
    f.feedbackOn("2026-11-16", { kind: "camp", starts_on: "2026-11-16", ends_on: "2026-12-20" }) === "2026-11-23" &&
    /* lab, 11 Nov: "Mondays 9am (Nov 16 and Nov 23)" is a class, asked the day after its first session */
    f.feedbackOn("2026-11-16", { kind: "class", starts_on: "2026-11-16", ends_on: "2026-11-23" }) === "2026-11-17" &&
    f.feedbackOn("2026-11-16", { kind: "event", starts_on: "2026-11-16", ends_on: "2026-11-23" }) === "2026-11-17" &&
    f.feedbackOn("2026-11-21", { starts_on: "2026-11-06", ends_on: "2027-01-10" }) === "2026-11-22");

console.log("\n=== what they are sent ===");
const item = (over: Partial<Item> = {}): Item => ({
  title: "Toddler Tuesday at Kidspace",
  when_text: "Tue Nov 17, 10am-12pm",
  starts_on: "2026-11-17",
  ends_on: "2026-11-17",
  place: "Kidspace Children's Museum, Pasadena",
  summary: "A morning for the littlest guests.",
  url: "https://kidspacemuseum.org/calendar/",
  ...over,
});
/* 11 Nov (evening): a pick IS the reminder — no copy of the line, no Yes/No; the same pick again undoes it. */
const LA = "America/Los_Angeles";
const at830 = new Date("2026-12-03T16:30:00Z");
ok("a moment as a parent reads it, on the market's clock", f.sayMoment(at830, LA) === "Thu Dec 3 at 8:30am" && f.sayMoment(new Date("2026-11-22T23:00:00Z"), LA) === "Sun Nov 22 at 3pm");
const one = f.pickReplySms([{ n: 1, title: "Children's Storytime", state: "set", at: at830 }], LA);
ok("one pick: when the reminder comes, the question after, and how to undo — no copy of the line, no Yes/No",
  one === "Got it - I'll text you Thu Dec 3 at 8:30am about Children's Storytime, and ask how it went after. Pick 1 again to undo." && !/YES|NO\b/.test(one));
ok("the same pick again: taken off", f.pickReplySms([{ n: 1, title: "Children's Storytime", state: "unset" }], LA) === "OK - no reminder for Children's Storytime.");
ok("several typed at once only set: one already set is said to be (11 Nov, \"so that 1 and 3 both get reminders\")",
  f.pickReplySms([{ n: 1, title: "Storytime", state: "already_set", at: at830 }, { n: 3, title: "Rhyme Time", state: "set", at: at830 }], LA) ===
    "Got it:\n1. Storytime - reminder already set for Thu Dec 3 at 8:30am.\n3. Rhyme Time - reminder Thu Dec 3 at 8:30am.\nI'll ask how each one went after. Pick a number again to undo." &&
    /is already set for Thu Dec 3 at 8:30am\. Pick 1 again to take it off\./.test(f.pickReplySms([{ n: 1, title: "Storytime", state: "already_set", at: at830 }], LA)) &&
    /const mode = picks\.length > 1 \? "set" : "toggle";/.test(read("lib/server/inbound.ts")) &&
    /if \(was\?\.status === "going" && mode === "set" && was\.remind_at\)/.test(read("lib/server/repo/digest-followup.ts")));
ok("a tapped number picks from its own edition, whatever was said since; a typed one from the newest (11 Nov)",
  /const tappedEdition = editionOfTap\(tapPayload\);\s+if \(tappedEdition \|\| DIGEST_PICKABLE\.has\(conversation \?\? ""\)\) \{\s+const sent = await lastDigestSent\(person\.person_id, tappedEdition\);/.test(read("lib/server/inbound.ts")) &&
    /e\.edition_date = \$\{editionDate\}::date/.test(read("lib/server/repo/digest-followup.ts")) &&
    /tapPayload: params\.ButtonPayload \|\| undefined/.test(read("app/api/sms/inbound/route.ts")) &&
    /rich: \{ kind: "digest_pick", card: input\.ask\.card, edition: editionVariable\(input\.editionDate\) \}/.test(read("lib/server/repo/jobs.ts")));
ok("no date at all, or today / under way: each said, not a reminder (review, 11 Nov)",
  /has no fixed day, so there's no reminder to set/.test(f.pickReplySms([{ n: 4, title: "artWORKS", state: "no_day" }], LA)) &&
    /is today or already under way, so it's too late for a reminder/.test(f.pickReplySms([{ n: 2, title: "Santa Letters", state: "too_late" }], LA)));
const two = f.pickReplySms([{ n: 1, title: "Storytime", state: "set", at: at830 }, { n: 4, title: "artWORKS", state: "no_day" }, { n: 2, title: "Rhyme Time", state: "unset" }], LA);
ok("several typed at once: one line each, then the question and the undo",
  two === "Got it:\n1. Storytime - reminder Thu Dec 3 at 8:30am.\nartWORKS has no fixed day, so there's no reminder to set - the link in the digest has the details.\nOK - no reminder for Rhyme Time.\nI'll ask how it went after. Pick a number again to undo.");
const many = f.pickReplySms(Array.from({ length: 4 }, (_, i) => ({ n: i + 1, title: "T".repeat(500), state: "set" as const, at: at830 })), LA);
ok("never over Twilio's 1,600 characters; GSM-7 throughout", many.length <= 1600 && [one, two, many].every((t) => seg.planSegments(t).encoding === "gsm7"));
ok("an accented title keeps its letters", f.pickReplySms([{ n: 1, title: "Feria en La Cañada", state: "unset" }], LA).includes("La Canada"));
ok("the reminder: today, when, where, the link, and how to stop",
  /^Pando: today - Toddler Tuesday at Kidspace, Tue Nov 17, 10am-12pm, Kidspace Children's Museum, Pasadena\. https:\/\/kidspacemuseum\.org\/calendar\//.test(f.reminderSms(item())) &&
    /DIGEST OFF stops these, STOP stops all texts\.$/.test(f.reminderSms(item())));
ok("the feedback question names the three answers by SMS; the card leaves them to its buttons",
  f.feedbackAskSms(item()) === "Pando: how was Toddler Tuesday at Kidspace? Reply LOVED IT, IT WAS OK or DIDN'T GO. STOP to opt out." && f.feedbackAskCard(item()) === "Pando: how was Toddler Tuesday at Kidspace?");
ok("a weekly item's reminder says it is for the first date only (13 Nov)",
  /\(the first date only\)/.test(f.pickReplySms([{ n: 1, title: "Teen Games Club", state: "set", at: new Date("2026-12-31T22:00:00Z"), weekly: true }], "America/Los_Angeles")) &&
    !/first date/.test(f.pickReplySms([{ n: 1, title: "Teen Games Club", state: "set", at: new Date("2026-12-31T22:00:00Z") }], "America/Los_Angeles")));

console.log("\n=== reading the feedback ===");
ok("the three buttons and how people type them",
  f.readFeedback("Loved it") === "loved" && f.readFeedback("LOVED IT!") === "loved" && f.readFeedback("It was OK") === "ok" && f.readFeedback("okay") === "ok" &&
    f.readFeedback("Didn't go") === "didnt_go" && f.readFeedback("we didn’t go") === "didnt_go");
ok("after another digest text only words that can be nothing but feedback count (21 Nov run)",
  f.readFeedbackPhrase("didn't go") === "didnt_go" && f.readFeedbackPhrase("We loved it!") === "loved" && f.readFeedbackPhrase("it was okay") === "ok" &&
    f.readFeedbackPhrase("ok") === null && f.readFeedbackPhrase("no") === null && f.readFeedbackPhrase("great") === null && f.readFeedbackPhrase("fine") === null &&
    /if \(last !== "digest_feedback_ask" && DIGEST_CONVERSATION\.has\(last\)\) \{\s+const value = readFeedbackPhrase\(body\);\s+if \(value && \(await recordFeedback\(person\.person_id, value\)\)\)/.test(read("lib/server/inbound.ts")));
ok("anything else is not feedback (it goes on as a message)", f.readFeedback("it was great but too crowded") === null && f.readFeedback("swim lessons?") === null);

console.log("\n=== the wiring ===");
const inbound = read("lib/server/inbound.ts");
ok("read right after DIGEST / DIGEST OFF, before anything else answers",
  /if \(\(await digestStep\(\{ from, body, person \}\)\) === HANDLED\) return;\s+if \(\(await digestReplyStep\(\{ from, body, person, tapPayload: input\.tapPayload \}\)\) === HANDLED\) return;/.test(inbound));
ok("a pick only after the digest or another pick; no Yes/No step any more; feedback only after its question",
  /const DIGEST_PICKABLE: ReadonlySet<string> = new Set\(\[\s+"weekly_digest", "weekly_digest_ask", "digest_pick_set", "digest_pick_range", "digest_feedback_thanks", "digest_details", "digest_reminder_set",\s+"digest_pick_off", "digest_on",/.test(inbound) &&
    /if \(tappedEdition \|\| DIGEST_PICKABLE\.has\(conversation \?\? ""\)\)/.test(inbound) && !/yesOrNo\(body\);\s+if \(yes !== null\) \{\s+const days = await answerReminder/.test(inbound) &&
    /await togglePick\(person\.person_id, sent\.editionDate, today, timeZone, sent\.items\[n - 1\], n, mode\)/.test(inbound) &&
    /if \(last === "digest_feedback_ask"\) \{\s+const value = readFeedback\(body\);/.test(inbound));
ok("its log carries counts and enums only (invariant 7)",
  /console\.info\("\[sms:inbound\] digest pick", \{ picks: picks\.length, set: count\("set"\), already: count\("already_set"\), unset: count\("unset"\), no_day: count\("no_day"\), too_late: count\("too_late"\), reminded: count\("reminded"\) \}\);/.test(inbound) &&
    /console\.info\("\[sms:inbound\] digest feedback", \{ value, saved \}\);/.test(inbound));
const jobs = read("lib/server/repo/jobs.ts");
ok("the digest goes out with its number buttons and keeps what it sent",
  /rich: \{ kind: "digest_pick", card: input\.ask\.card, edition: editionVariable\(input\.editionDate\) \}/.test(jobs) && /claimDigestSend\(edition\.id, recipient\.person_id, included, sentIds\)/.test(jobs) &&
    /* 19 Nov: the list first, as plain text (its links open), and the buttons only after it went. */
    /template: "weekly_digest",\s+templateVersion: SMS_TEMPLATE_VERSION,\s+\.\.\.exempt,\s+\}\);\s+if \(!list\.sent\) return list;/.test(jobs) && /template: "weekly_digest_ask"/.test(jobs));
ok("swept by each row's own moment, claimed before sending, in category digest",
  /const due = kind === "remind" \? await dueReminders\(now\) : await dueFeedback\(now\);/.test(jobs) && /if \(!\(await claimFollowup\(kind, item\.interestId, now\)\)\) continue;/.test(jobs) &&
    /category: "digest",\s+personId: item\.personId,/.test(jobs) && /rich: kind === "feedback" \? \{ kind: "digest_feedback"/.test(jobs));
const registry = read("lib/jobs.ts");
ok("both jobs are registered as five-minute sweeps that send", /digest_reminders: \{\s+name: "digest_reminders",\s+min_interval_minutes: 4,\s+take_over_after_minutes: 15,\s+sends: true,/.test(registry) &&
  /digest_feedback: \{\s+name: "digest_feedback",\s+min_interval_minutes: 4,\s+take_over_after_minutes: 15,\s+sends: true,/.test(registry));
const migration = read("drizzle/0067_digest_interests.sql");
ok("the table: one row per family and item, buttons-only feedback, deleted with the person, locked away from the browser",
  /person_id\s+uuid NOT NULL REFERENCES people\(id\) ON DELETE CASCADE/.test(migration) && /UNIQUE \(person_id, item_id\)/.test(migration) &&
    /feedback IN \('loved', 'ok', 'didnt_go'\)/.test(migration) && /REVOKE ALL ON digest_interests FROM anon, authenticated/.test(migration) &&
    /ADD COLUMN IF NOT EXISTS item_ids uuid\[\]/.test(migration));
ok("and it is in the journal", /"tag": "0067_digest_interests"/.test(read("drizzle/meta/_journal.json")));
ok("and in schema.ts, with 0066's table", /export const digestInterests = pgTable\(\s+"digest_interests"/.test(read("lib/db/schema.ts")) &&
  /itemIds: uuid\("item_ids"\)\.array\(\)/.test(read("lib/db/schema.ts")) && /export const conversationSummaries = pgTable/.test(read("lib/db/schema.ts")));

console.log("\n=== the review of 11 Nov ===");
const followRepo = read("lib/server/repo/digest-followup.ts");
ok("a pick sets going with its moments, the same pick again declines it, one already reminded stays, none past is set — in one transaction holding the row (review, 11 Nov)",
  /db\.transaction\(async \(tx\)/.test(followRepo) && /for update/.test(followRepo) &&
    /if \(was\?\.reminded === true\) return \{ n, title: item\.title, state: "reminded" \};/.test(followRepo) &&
    /if \(was\?\.status === "going"\) \{[\s\S]{0,200}set status = 'declined'[\s\S]{0,200}state: "unset"/.test(followRepo) &&
    /if \(!remind \|\| !at \|\| at\.getTime\(\) <= Date\.now\(\)\)/.test(followRepo) &&
    /set status = 'going', remind_on = \$\{remind\}::date, remind_at/.test(followRepo));
ok("a reminder or question is claimed only while still going: one taken off after the sweep listed it is not sent",
  (followRepo.match(/is null and status = 'going' returning id/g) ?? []).length === 2);
ok("DIGEST OFF stops the reminders and the questions: both read the digest's latest consent",
  /const DIGEST_ON = sql`\(select k\.status from consents k[\s\S]{0,160}= 'opted_in'`/.test(followRepo) && (followRepo.match(/and \$\{DIGEST_ON\}/g) ?? []).length === 2);
ok("a pick taken off and picked again is set again (the row is held, then set going)",
  /on conflict \(person_id, item_id\) do nothing[\s\S]{0,400}for update[\s\S]*set status = 'going'/.test(followRepo));
ok("one feedback question a day per family; a tap answers it within three days",
  /not exists \(select 1 from digest_interests o[\s\S]{0,200}interval '24 hours'\)/.test(followRepo) && /asked\.has\(item\.personId\)/.test(jobs) &&
    /feedback_asked_at > now\(\) - interval '3 days'/.test(followRepo));
ok("an item gone since, or an id missing, makes the digest unpickable rather than renumbered",
  /if \(items\.length !== ids\.length\) return null;/.test(followRepo) && /ids\.every\(\(id\): id is string => typeof id === "string"\) \? ids : \[\]/.test(jobs));
ok("an out-of-range number is answered before any later step reads it",
  /picksOutOfRange\(body, sent\.items\.length\)[\s\S]{0,400}template: "digest_pick_range"[\s\S]{0,120}return HANDLED;/.test(inbound));

console.log("\n=== each pick its own moment (11 Nov: two hours before, never before 8:00; feedback 10:00) ===");
const st = (w: string) => JSON.stringify(f.startTime(w));
ok("the start a when_text states", st("Tue Nov 17, 10am-12pm") === '{"h":10,"m":0}' && st("Mon Nov 16, 4-4:30pm") === '{"h":16,"m":0}' &&
  st("Wed Nov 18, 4:30-5:30pm") === '{"h":16,"m":30}' && st("Mondays 9am (Nov 16, 23)") === '{"h":9,"m":0}' && st("11-1pm") === '{"h":11,"m":0}' &&
  st("Saturday noon") === '{"h":12,"m":0}' && st("7pm") === '{"h":19,"m":0}');
ok("no time is no time: dates, ages, bare numbers, words, links", st("Nov 16-23") === "null" && st("ages 2-5") === "null" && st("Ongoing") === "null" &&
  st("Sat 10-12") === "null" && st("Daily through Jan 10, 2027") === "null" && st("https://x.com/e/2024-10-5pm") === "null");
ok("the first time by position, noon as a start, 24-hour and a.m. spellings (review, 11 Nov)",
  st("Sat noon-2pm") === '{"h":12,"m":0}' && st("Doors 9am, show 10am-12pm") === '{"h":9,"m":0}' && st("10:30am-noon") === '{"h":10,"m":30}' &&
    st("9:30-11am") === '{"h":9,"m":30}' && st("Sat 10am & 2pm") === '{"h":10,"m":0}' && st("1-3 pm") === '{"h":13,"m":0}' &&
    st("Sat 10:30") === '{"h":10,"m":30}' && st("Sat 13:00") === '{"h":13,"m":0}' && st("Saturday 10 a.m.") === '{"h":10,"m":0}' &&
    st("Sun 2:00") === '{"h":14,"m":0}' && st("Fri Nov 20, 6:30 PM") === '{"h":18,"m":30}' && st("4pm-1am") === '{"h":16,"m":0}');
const iso = (d: Date) => d.toISOString();
ok("two hours before a stated start, on the market's clock",
  iso(f.remindAt({ starts_on: "2026-11-16", when_text: "Mon Nov 16, 4-4:30pm" }, "2026-11-16", LA)) === "2026-11-16T22:00:00.000Z");
ok("never before 8:00; no time, or a day other than its start: 8:00",
  iso(f.remindAt({ starts_on: "2026-11-17", when_text: "Tue Nov 17, 9am" }, "2026-11-17", LA)) === "2026-11-17T16:00:00.000Z" &&
    iso(f.remindAt({ starts_on: "2026-11-17", when_text: "Tuesday morning" }, "2026-11-17", LA)) === "2026-11-17T16:00:00.000Z" &&
    iso(f.remindAt({ starts_on: "2026-11-06", when_text: "Daily 1pm-6pm" }, "2026-11-21", LA)) === "2026-11-21T16:00:00.000Z");
ok("summer time and its changes are kept (7pm PDT; 10:00 on 1 Nov and 8 Mar)",
  iso(f.remindAt({ starts_on: "2026-07-04", when_text: "9pm" }, "2026-07-04", LA)) === "2026-07-05T02:00:00.000Z" &&
    iso(f.askAt("2026-11-01", LA)) === "2026-11-01T18:00:00.000Z" && iso(f.askAt("2026-03-08", LA)) === "2026-03-08T17:00:00.000Z");
ok("the confirmation says when, to the minute", /Thu Dec 3 at 8:30am/.test(one));
ok("the row is the job: its moments stored when picked, swept by time, late ones dropped",
  /set status = 'going', remind_on = \$\{remind\}::date, remind_at = \$\{at\.toISOString\(\)\}::timestamptz,\s+ask_at = \$\{ask\.toISOString\(\)\}::timestamptz/.test(followRepo) &&
    /i\.remind_at <= \$\{at\}::timestamptz and i\.remind_at > \$\{at\}::timestamptz - \$\{REMIND_LATE\}::interval/.test(followRepo) &&
    /i\.ask_at <= \$\{at\}::timestamptz and i\.ask_at > \$\{at\}::timestamptz - \$\{ASK_LATE\}::interval/.test(followRepo) &&
    /remind_at\s+timestamptz/.test(migration) && /ask_at\s+timestamptz/.test(migration) && !/feedback_on/.test(migration));

console.log("\n=== Supabase Cron (drizzle/0068) ===");
const cron = read("drizzle/0068_supabase_cron.sql");
const jobNames = [...registry.matchAll(/\n  ([a-z_]+): \{\s+name: "\1"/g)].map((m) => m[1]);
const scheduled = [...cron.matchAll(/cron\.schedule\('pando-([a-z_]+)',\s*'([^']+)',\s*\$c\$select pando_private\.run_job\('([a-z_]+)'\)\$c\$\)/g)];
ok("every registered job has exactly one schedule, under its own name", jobNames.length === 11 &&
  jobNames.every((j) => scheduled.filter((m) => m[1] === j && m[3] === j).length === 1) && scheduled.length === jobNames.length,
  `${jobNames.length} jobs, ${scheduled.length} schedules`);
ok("no address or token in the file: both from Vault by name",
  /vault\.decrypted_secrets WHERE name = 'pando_jobs_url'/.test(cron) && /vault\.decrypted_secrets WHERE name = 'pando_jobs_secret'/.test(cron) &&
    !/https?:\/\/(?!pando\.is\b)[a-z]/i.test(cron.replace(/^--.*$/gm, "")) && !/Bearer [A-Za-z0-9]{8,}/.test(cron));
ok("the caller is out of the REST API's reach: its own schema, definer, empty search_path, revoked",
  /CREATE OR REPLACE FUNCTION pando_private\.run_job/.test(cron) && /SECURITY DEFINER\s+SET search_path = ''/.test(cron) &&
    /REVOKE ALL ON FUNCTION pando_private\.run_job\(text\) FROM PUBLIC/.test(cron) && /REVOKE ALL ON SCHEMA pando_private FROM PUBLIC/.test(cron));
ok("where pg_cron or pg_net is missing (the lab) it makes no schedule and does not fail",
  /IF NOT EXISTS \(SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron'\)[\s\S]{0,200}RETURN;/.test(cron));
ok("the daily texting jobs are called only through the Pacific day (16-03 UTC)",
  ["freshness_ping", "thanks_prompt", "thanks_delivery"].every((j) => scheduled.some((m) => m[1] === j && / 16-23,0-3 \* \* \*$/.test(m[2]))));
ok("the follow-up sweeps every five minutes, failed sends every ten",
  scheduled.some((m) => m[1] === "digest_reminders" && m[2] === "*/5 * * * *") && scheduled.some((m) => m[1] === "digest_feedback" && m[2] === "1-59/5 * * * *") &&
    scheduled.some((m) => m[1] === "retry_failed" && m[2] === "*/10 * * * *"));
ok("a failure to set it up is undone on its own and said loudly, never taking 0066 and 0067 with it",
  /EXCEPTION WHEN OTHERS THEN\s+--[^\n]*\n\s+RAISE WARNING 'pando: Supabase Cron NOT set up/.test(cron));
ok("Vault values trimmed; the function revoked from anon and authenticated too",
  (cron.match(/btrim\(decrypted_secret, E' \\t\\r\\n'\)/g) ?? []).length === 2 &&
    /REVOKE ALL ON FUNCTION pando_private\.run_job\(text\) FROM PUBLIC, anon, authenticated/.test(cron));
ok("retry_failed leaves room under its ten-minute call; the digest sweeps take over a run left open 15 minutes",
  /retry_failed: \{\s+name: "retry_failed",\s+min_interval_minutes: 8,/.test(registry) &&
    /digest_reminders: \{\s+name: "digest_reminders",\s+min_interval_minutes: 4,\s+take_over_after_minutes: 15,/.test(registry) &&
    /if \(inFlight && spec\.take_over_after_minutes && history\[0\]\?\.stale === true\)[\s\S]{0,200}outcome = 'error', note = 'taken_over'/.test(jobs));
ok("a pick or YES answers the conversation under a reminder or question the sweeps sent; a feedback tap is read first",
  /const SWEEP_TEMPLATES = new Set\(\["digest_reminder", "digest_feedback_ask"\]\)/.test(followRepo) &&
    /if \(last === "digest_feedback_ask"\)[\s\S]*if \(tappedEdition \|\| DIGEST_PICKABLE\.has\(conversation/.test(inbound));
console.log("\n=== /admin/digests (12 Nov) ===");
{
  const readSrc = read("lib/server/repo/admin-read.ts");
  const page = read("app/(admin)/admin/digests/page.tsx");
  const kit0 = read("components/admin/kit.tsx");
  ok("the digests resource is read, typed and never faked",
    /digests: \(db, params\) => digestRows\(db, params\),/.test(readSrc) && /digests: DigestsResult;/.test(read("lib/admin/types.ts")) &&
      (read("app/api/admin/query/route.ts").match(/digests: \{ configured: false, picks_configured: false, weeks: \[\], index: \[\] \}/g) ?? []).length === 2);
  ok("each family's text is rebuilt from the items stored for that send, in their numbers' order, by the sending code",
    /s\.item_ids::text\[\] as item_ids/.test(readSrc) && /const composed = found\.length === ids\.length \? composeDigest\(found\) : null;/.test(readSrc));
  ok("weeks newest first; real and test kept apart (real unless asked, or unless there are only test weeks); the week in the URL",
    /order by edition_date desc, is_test/.test(readSrc) && /const set: Which = which \?\? \(real\.length > 0 \|\| test\.length === 0 \? "real" : "test"\);/.test(page) &&
      /q\.set\("week", entry\.edition_date\)/.test(page) && /window\.history\.replaceState/.test(page));
  ok("the week bar: our own Select, earlier and later Saturdays, Latest, real/test as a filter — no checkbox, no native list",
    /<Select\s[^>]*label="Which Saturday"/.test(page) && /label="An earlier Saturday"/.test(page) && /label="A later Saturday"/.test(page) &&
      /label="Which weeks"/.test(page) && !/type="checkbox"/.test(page) && !/<select/.test(page));
  ok("before 0067 the page says once what it cannot know, in words, never a migration name",
    /picks_configured/.test(readSrc) && /Picks are not recorded for this week\./.test(page) && /Texts are not recorded for this week\./.test(page) && !/migration 0067/.test(page));
  /* 19 Nov: waiting for approval first, then failed, then the largest. */
  ok("groups are rows that open, awaiting approval first, then failed, then the largest; what needs a look opens the row it names",
    /aria-expanded=\{open\}/.test(page) && /aria-controls=\{panel\}/.test(page) &&
      /Number\(awaitsApproval\(b\)\) - Number\(awaitsApproval\(a\)\) \|\|\s+Number\(b\.status === "failed"\) - Number\(a\.status === "failed"\) \|\|\s+b\.families_sent - a\.families_sent/.test(page) &&
      /Needs a look/.test(page) && /onClick=\{\(\) => reveal\(g\)\}/.test(page));
  ok("what families received is a comparison: shared items muted, differences bold, another group's item named, one text open at a time",
    /const differs = k > 0 && !mainIds\.has\(it\.id\);/.test(page) && /from \{it\.from_group\}/.test(page) && /setOpenKey\(isOpen \? null : key\)/.test(page) &&
      /from_group: from && from !== String\(e\.id\)/.test(readSrc) && !/version/i.test(page.replace(/\/\*[\s\S]*?\*\//g, "")));
  ok("sent first, what went to nobody folded; an item's reach split between this group and others",
    /Not sent to anyone/.test(page) && /\{elsewhere\} other \{elsewhere === 1 \? "group" : "groups"\}/.test(page) && /sent_here: sentHere\.get/.test(readSrc));
  /* 12 Nov, the developer: "it looks wooden — improve it the way the leading sites do". */
  ok("the digests page reads as a dense list, not boxes in boxes: no capitals-and-tracking labels, numbers in tabular figures, a week whose sends were not stored shows what was found, not 0 sent",
    !/uppercase/.test(page) && /tabular-nums/.test(page) && /const sendsKnown = /.test(page) && /<Stat label="Items found"/.test(page) &&
      /bare\?: boolean/.test(kit0) && /track\?: boolean/.test(kit0));
  ok("in the admin nav", /href: "\/admin\/digests"/.test(read("components/admin/Shell.tsx")));
  /* 12 Nov, the developer: "we were meant to have our own selectors for everything". */
  const kit = read("components/admin/kit.tsx");
  const fs2 = await import("node:fs");
  const path = await import("node:path");
  const walk = (dir: string): string[] => fs2.readdirSync(new URL(`../${dir}`, import.meta.url), { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? walk(path.join(dir, d.name)) : /\.tsx$/.test(d.name) ? [path.join(dir, d.name)] : []);
  const nativeSelects = [...walk("app/(admin)"), ...walk("components/admin")].filter((f) => /<select[\s>]/.test(read(f).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "")));
  ok("no native <select> anywhere on the admin", nativeSelects.length === 0, nativeSelects.join(", "));
  /* 12 Nov, again: "everything must be custom, not default" — the kit draws its own on the real input; nobody else uses one. */
  const defaults = [...walk("app/(admin)"), ...walk("components/admin")]
    /* `path.join` gives "\" on Windows (16 Nov): compare with forward slashes. */
    .filter((f) => !f.replace(/\\/g, "/").endsWith("components/admin/kit.tsx"))
    .filter((f) => /type="(checkbox|radio|number|date|time|datetime-local|file|range)"/.test(read(f)));
  ok("no default checkbox, radio, number, date, file or range input on the admin outside the kit", defaults.length === 0, defaults.join(", "));
  ok("the kit draws them: Checkbox and Radio on the real input with appearance-none, NumberField with its own − +, a Calendar in a popover",
    /export function Checkbox\(/.test(kit) && /export function Radio\(/.test(kit) && /export function NumberField\(/.test(kit) && /export function Calendar\(/.test(kit) &&
      (kit.match(/appearance-none/g) ?? []).length >= 2 && /role="spinbutton"/.test(kit) && /role="grid"/.test(kit) && /PageUp/.test(kit));
  ok("the digests week bar finds any Saturday on the calendar, and a week older than the latest is read on its own",
    /<Calendar\s[^>]*label="Find a week on the calendar"/.test(page) && /useAdminRows\("digests", asked \? \{ week: asked \} : undefined\)/.test(page) &&
      /const asked = typeof params\.week === "string" && \/\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$\/\.test\(params\.week\)/.test(readSrc) && /index: DigestWeekIndex\[\];/.test(read("lib/admin/types.ts")));
  /* 12 Nov, the developer: "it looks wooden" and then "why are the buttons different sizes" — the whole admin. */
  const adminFiles = [...walk("app/(admin)"), ...walk("components/admin")];
  const capitals = adminFiles.filter((f) => /"[^"\n]*\buppercase\b[^"\n]*"/.test(read(f).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "")));
  ok("no capitals-and-tracking labels anywhere on the admin: headings and labels in sentence case", capitals.length === 0, capitals.join(", "));
  const ui = read("components/admin/ui.tsx");
  const tones = /const BUTTON_TONES = \{([\s\S]*?)\};/.exec(ui)?.[1] ?? "";
  ok("every button tone has a 1px border, so one label makes one size whatever the tone",
    tones.split("\n").filter((l) => /^\s+\w+: "/.test(l)).every((l) => /\bborder\b/.test(l)) && /primary: "border border-transparent/.test(tones));
  ok("buttons in a row share actionsClass: stacked, they are one width",
    /export const actionsClass = "flex w-fit max-w-full flex-wrap gap-2 \[&>\*\]:grow"/.test(ui) &&
      ["app/(admin)/admin/options/page.tsx", "app/(admin)/admin/founding/page.tsx", "components/admin/Record.tsx", "components/admin/caregivers/SignupsPanel.tsx"].every((f) => /actionsClass/.test(read(f))));
  ok("no table scrolls sideways: below 46rem of its own container every admin table row is a block, each cell beside its column's name",
    /<table className=\{STACKED_TABLE\}>/.test(ui) && /useCellLabels\(ref\);/.test(ui) && /@max-\[46rem\]:\[&_tbody_tr>\*\]:before:content-\[attr\(data-label\)\]/.test(ui) &&
      /className="@container overflow-x-auto/.test(ui) && !/\$\{STACK\}/.test(ui) && /<span data-th>\{children\}<\/span>/.test(ui));
  /* Borrowed 12 Nov from the property-workflows design system (the developer: "maybe borrow some good practices, but not the colours"). */
  ok("a row with a row link opens as a whole; a pressed button gives; loading shows the shape of a list; the bare select keeps a focus ring",
    /export const rowLinkClass =\s*"row-link after:absolute after:inset-0/.test(ui) && /className=\{rowLinkClass\}/.test(read("app/(admin)/admin/contributors/page.tsx")) &&
      /active:scale-\[0\.97\] motion-reduce:active:scale-100/.test(ui) && /animate-pulse rounded bg-bark-soft motion-reduce:animate-none/.test(ui) &&
      !/text-ink outline-none transition-colors disabled:cursor-default/.test(kit0));
  const shell = read("components/admin/Shell.tsx");
  ok("the account is one button — name, Change password and Sign out in its popover — at the sidebar's foot and in the phone's header",
    /export function AccountMenu\(/.test(kit0) && /role="dialog"\s+aria-label="Account"/.test(kit0) && /href="\/admin\/account"/.test(kit0) && /onSignOut\(\);/.test(kit0) &&
      (shell.match(/<AccountMenu\b/g) ?? []).length === 2 && /<AccountMenu compact/.test(shell) && !/Signed in as/.test(shell));
  ok("a pick while the digest is off stores nothing and says so: DIGEST, then the number again (13 Nov, the lab)",
    /if \(sent && picks && !\(await digestIsOn\(person\.person_id\)\)\) \{[\s\S]{0,400}body: PICK_WHILE_OFF_SMS,[\s\S]{0,200}template: "digest_pick_off"[\s\S]{0,120}return HANDLED;\s+\}\s+if \(sent && picks\) \{/.test(inbound) &&
      /scope = 'digest'\s+order by captured_at desc limit 1/.test(read("lib/server/repo/digest-followup.ts")) && /Reply DIGEST to turn it back on/.test(read("lib/digest-followup.ts")) &&
      /digest_pick_off: "/.test(read("lib/admin/labels.ts")));
  ok("a NumberField's column leaves its number room beside − and + (13 Nov: the matching weights were 4.5rem and showed no number)",
    /grid-cols-\[minmax\(0,1fr\)_8\.5rem\]/.test(read("app/(admin)/admin/matching/page.tsx")) && !/_4\.5rem/.test(read("app/(admin)/admin/matching/page.tsx")));
  const rawColours = adminFiles.filter((f) => /(?:bg|text|border|ring|fill|stroke|outline)-\[#|#[0-9a-fA-F]{6}\b|\brgba?\(/.test(read(f).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "")));
  ok("no colour outside the tokens anywhere on the admin (no hex, no rgb)", rawColours.length === 0, rawColours.join(", "));
  ok("figures are cells of one strip, never bordered tiles in a card",
    /export function StatStrip/.test(ui) && !/"rounded-xl border p-4"/.test(ui) &&
      ["app/(admin)/admin/page.tsx", "components/admin/conversations/DeliveryHealth.tsx", "app/(admin)/admin/digests/page.tsx"].every((f) => /<StatStrip/.test(read(f))));
  ok("the admin Select is a listbox of its own: popover, keyboard, typeahead, the value announced",
    /role="listbox"/.test(kit) && /aria-haspopup="listbox"/.test(kit) && /aria-activedescendant=/.test(kit) && /const seek = \(key: string\)/.test(kit) &&
      /aria-label=\{selected \? `\$\{label\}: \$\{selected\.label\}` : label\}/.test(kit) && /e\.key === "Escape"/.test(kit) && /e\.key === "Home"/.test(kit));
}
ok("in the journal after 0067", /"tag": "0067_digest_interests",[\s\S]*"tag": "0068_supabase_cron"/.test(read("drizzle/meta/_journal.json")));

console.log(`\n  ${pass} checks passed${fail ? `, ${fail} FAILED` : ""}.`)
if (fail) process.exit(1);

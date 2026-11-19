/**
 * The weekly digest (3 Nov) — the pure half: when it is due, what the agent's
 * findings must be to be sent, what each parent gets, and what it says.
 *
 * Every document asks for it under one name or another: the consent on /join
 * names "a weekly digest" (registered A2P copy, 2 Nov); the Founder Bible's
 * Radar Lite *Discover* is "an excellent, modest weekly personalised digest";
 * the Agent Playbook's Member Experience "sends a short weekly opt-in tailored
 * digest"; the brief calls it "the weekly Radar message".
 *
 * The developer's decisions, 3 Nov:
 *  - its **own yes** (scope `digest`), never implied by the /join consent;
 *  - **every Saturday** for now — tying it to holidays and school dates later;
 *  - the agent finds the items and it is **sent without an approval step**
 *    (⚠ the brief's J7 says "sent only from content Janet has approved"; this
 *    is the developer's call, recorded in decisions.md);
 *  - **events and opportunities only** — events, camps, classes;
 *  - it **does not count** toward the contributor-protection limits, so it has
 *    its own send category (`digest`, `lib/server/sms.ts`);
 *  - it may run to several segments.
 *
 * What it must never be is a pretend recommendation: everything in it is a
 * public listing the agent found, said so in the message (invariant 3), and
 * every item carries the organizer's own link.
 *
 * Pure and import-free, so `npm run test:digest` loads it in plain node.
 */

/** Saturday, on the market's clock (`Date#getDay` numbering). */
export const DIGEST_WEEKDAY = 6;
/** From this hour on the market's clock — well inside quiet hours' 8:00. */
export const DIGEST_FROM_HOUR = 9;
/** No later than this, so a run that starts late never reaches quiet hours (21:00). */
export const DIGEST_UNTIL_HOUR = 20;
/**
 * Items per parent. Four since 11 Nov (was five): the digest's RCS buttons sit
 * inside its card, where they stay tappable after the next message — a chip
 * list under it vanishes, so a second pick was impossible on Android — and a
 * card holds at most four (Google RBM, Twilio). The developer: *"let's just
 * make the digest four options for now"*.
 */
export const DIGEST_MAX_ITEMS = 4;
/** Items kept per edition, from which each parent's are picked. */
export const DIGEST_EDITION_MAX = 12;
/** An event is "this week" if it starts within this many days of the Saturday. */
export const DIGEST_EVENT_DAYS = 14;
/** A camp, class or opportunity may be further out — summer camps open their books in winter. */
export const DIGEST_LONG_DAYS = 180;

export type DigestKind = "event" | "camp" | "class" | "opportunity";
const KINDS: readonly DigestKind[] = ["event", "camp", "class", "opportunity"];

export interface DigestItem {
  /** `digest_items.id` once stored; what a family's numbered reply points at (11 Nov). */
  id?: string;
  kind: DigestKind;
  title: string;
  /** As a parent reads it: "Sat Nov 7, 10am-2pm". */
  when_text: string;
  /** YYYY-MM-DD, or null when the listing gives none (an ongoing class). */
  starts_on: string | null;
  ends_on: string | null;
  place: string | null;
  age_min: number | null;
  age_max: number | null;
  summary: string;
  url: string;
}

/** The date, weekday and hour on a market's clock. */
export function localParts(now: Date, timeZone: string): { date: string; weekday: number; hour: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      weekday: "short",
      hour: "numeric",
      hourCycle: "h23",
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday);
  return { date: `${parts.year}-${parts.month}-${parts.day}`, weekday, hour: Number(parts.hour) };
}

/**
 * From this hour on the Friday before, the job prepares each group's edition
 * for an admin to approve (19 Nov). The agent's three tries an edition then
 * have the whole day, and the admin the evening and Saturday morning.
 */
export const DIGEST_PREP_FROM_HOUR = 8;

/**
 * The Saturday whose editions the job should be preparing, or null (19 Nov):
 * the Friday before from `DIGEST_PREP_FROM_HOUR`, and the Saturday's own send
 * window — when a family that fits no group drawn on Friday still gets one,
 * which then waits for approval like the rest.
 */
export function digestPrepFor(now: Date, timeZone: string): string | null {
  const due = digestDue(now, timeZone);
  if (due) return due;
  const local = localParts(now, timeZone);
  if (local.weekday !== (DIGEST_WEEKDAY + 6) % 7 || local.hour < DIGEST_PREP_FROM_HOUR) return null;
  return addDays(local.date, 1);
}

/**
 * The Saturday a digest sent now is for: today when it is Saturday on the
 * market's clock, else the next one (19 Nov — the admin's one-number test,
 * which ignores the hourly window).
 */
export function nextDigestDate(now: Date, timeZone: string): string {
  const local = localParts(now, timeZone);
  return addDays(local.date, (DIGEST_WEEKDAY - local.weekday + 7) % 7);
}

/** The Saturday a digest is due for, on the market's clock — or null when it is not the time. */
export function digestDue(now: Date, timeZone: string): string | null {
  const local = localParts(now, timeZone);
  if (local.weekday !== DIGEST_WEEKDAY) return null;
  if (local.hour < DIGEST_FROM_HOUR || local.hour >= DIGEST_UNTIL_HOUR) return null;
  return local.date;
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const isoOrNull = (v: unknown): string | null =>
  typeof v === "string" && ISO_DATE.test(v) && !Number.isNaN(new Date(`${v}T12:00:00Z`).getTime()) ? v : null;
const ageOrNull = (v: unknown): number | null =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 99 ? v : null;
const clip = (v: unknown, max: number): string =>
  typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "";

/** A summary without the agent's first-person asides — whole sentences that start "I " or "I'". */
export function withoutAsides(summary: string): string {
  return summary
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => !/^I(?:\s|')/.test(sentence.trim()))
    .join(" ")
    .trim();
}

/**
 * A page that lists many things rather than being one (6 Nov, the lab walk: an
 * Arcadia flea market was linked to Eventbrite's "community events in Arcadia"
 * browse page). Only the shapes that are never an item's own page: Eventbrite's
 * browse and discover paths, allevents.in, Meetup's find pages. A venue's own
 * calendar stays - it is often where the item is listed.
 */
export function isListingUrl(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  if (/(^|\.)eventbrite\.[a-z.]+$/.test(host)) return /^\/(b|d)\//.test(u.pathname);
  if (host === "allevents.in" || host.endsWith(".allevents.in")) return true;
  if (host === "meetup.com") return /^\/find\b/.test(u.pathname);
  /* A test or draft page left on a live site (the real-graph run, 14 Nov: a
     library's "/kids/storytime-test/" went out as the baby storytimes' link). */
  if (u.pathname.split("/").some((seg) => /(^|[-_])(test|draft|staging)$/i.test(seg))) return true;
  return false;
}

/**
 * A link as it is stored and sent: parsed, the scheme lower-case, no fragment.
 * Null for anything that is not an http(s) URL. Storing this rather than the
 * model's string is what keeps an `HTTPS://` from failing the table's CHECK
 * and the whole edition with it (review, 3 Nov).
 */
export function cleanUrl(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    u.hash = "";
    return u.href;
  } catch {
    return null;
  }
}

/**
 * The same page, however it was written: host without "www.", path without a
 * trailing slash, no tracking parameters, no fragment. What an item's link and
 * the pages the agent actually saw are compared on.
 */
export function urlKey(url: string): string | null {
  const clean = cleanUrl(url);
  if (!clean) return null;
  const u = new URL(clean);
  for (const key of [...u.searchParams.keys()]) if (/^utm_|^fbclid$|^gclid$/i.test(key)) u.searchParams.delete(key);
  const path = u.pathname.replace(/\/+$/, "") || "/";
  return `${u.hostname.toLowerCase().replace(/^www\./, "")}${path}${u.search}`;
}

/** A word as it is compared: no accents, lower case, a plural's "s" off. */
function stem(word: string): string {
  const w = word.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  if (w.length <= 4) return w;
  if (w.endsWith("ies")) return `${w.slice(0, -3)}y`;
  if (w.endsWith("sses")) return w.slice(0, -2);
  return w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w;
}

/* Words that do not say which thing a title is: who it is for, what kind it
   is, when. A calendar page carries every one of them whatever it lists. */
const GENERIC = new Set(
  [
    "with", "from", "this", "that", "your", "for", "and", "the", "at", "in", "on", "of",
    "kids", "children", "childrens", "family", "families", "parent", "parents", "teens", "tweens", "toddlers",
    "babies", "preschool", "youth", "adults", "ages", "grade", "grades", "months", "years",
    "event", "events", "class", "classes", "camp", "camps", "program", "programs", "session", "sessions",
    "free", "open", "weekly", "every", "week", "weekend", "days", "night", "nights", "time", "times",
    "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday", "mondays", "tuesdays",
    "wednesdays", "thursdays", "fridays", "saturdays", "sundays",
    "january", "february", "march", "april", "june", "july", "august", "september", "october", "november", "december",
  ].map(stem),
);

/** A text's words, stemmed. Combining marks stay inside a word until `stem` drops them. */
function words(text: string): string[] {
  return text.split(/[^\p{L}\p{M}\p{N}]+/u).map(stem).filter((w) => w.length >= 4);
}

/** The words of a title that say which thing it is, stemmed, each once. */
export function titleWords(title: string): string[] {
  return [...new Set(words(title).filter((w) => !GENERIC.has(w)))];
}

/**
 * What the agent read at an address (10 Nov): the page's text, or null when
 * it read the page but there is no text to compare (a PDF) — then nothing is
 * checked. An address it only saw in a search has no entry and is not
 * checked either: the model reads a search result's content, which comes back
 * encrypted to us, and the result's title is usually the site's name.
 */
export type PageEvidence = { text: string; url: string } | null;

/**
 * Is the item on the page it links to? More than half of the words that say
 * which thing it is (`titleWords`) must be in the text of the page the agent
 * read — both of two, two of three (review, 11 Nov: at half, "Teen Pottery
 * Workshop" passed on any page saying "workshop"). `every` asks for all of
 * them, which is what moving an item to another page needs (`pageNaming`). A title with no such words ("Toddler Tuesday") cannot be checked and
 * passes. A page cut at the fetch's length limit counts as what the agent saw.
 *
 * Why (the lab test, 10 Nov): an address proved only that the page exists. Two
 * teen items, a ukulele class and a fingerboard workshop, shared one library
 * event page — a Renaissance Fair in June — and the second may not exist.
 */
export function onPage(title: string, page: PageEvidence, every = false): boolean {
  if (page === null) return true;
  const wanted = titleWords(title);
  if (wanted.length === 0) return true;
  const there = new Set(words(page.text));
  const found = wanted.filter((w) => there.has(w)).length;
  return every ? found === wanted.length : found > wanted.length / 2;
}

/** What an agent run saw, gathered from its response blocks by `notePageBlocks`. */
export interface SeenPages {
  /** Every address it saw (`urlKey`): a search result, or a page it read. */
  urls: Set<string>;
  /** What it read at each address. */
  pages: Map<string, PageEvidence>;
  /** Each `web_fetch` call's address, by the call's id, until its result arrives. */
  asked: Map<string, string | undefined>;
  searches: number;
}

export const seenPages = (): SeenPages => ({ urls: new Set(), pages: new Map(), asked: new Map(), searches: 0 });

/**
 * One response's blocks into `seen`. A page it read counts at the address it
 * came back from and the address it was asked for, which a redirect or a
 * canonical address can differ from (review, 4 Nov) — but only when the read
 * worked: a failed fetch is `web_fetch_tool_result_error` (the SDK's
 * `BetaWebFetchToolResultErrorBlock`) and proves nothing (review, 10 Nov: the
 * check tested "web_fetch_tool_error", which never occurs, so a failed fetch
 * of a made-up address made it "seen").
 */
export function notePageBlocks(blocks: readonly unknown[], seen: SeenPages): void {
  const note = (url: unknown): string | null => {
    const key = typeof url === "string" ? urlKey(url) : null;
    if (key) seen.urls.add(key);
    return key;
  };
  for (const raw of blocks) {
    const block = raw as { type?: string; name?: string; id?: string; input?: { url?: unknown }; tool_use_id?: string; content?: unknown };
    if (block.type === "server_tool_use" && block.name === "web_search") seen.searches++;
    if (block.type === "server_tool_use" && block.name === "web_fetch" && block.id) {
      seen.asked.set(block.id, typeof block.input?.url === "string" ? block.input.url : undefined);
    }
    if (block.type === "web_fetch_tool_result") {
      const content = block.content as
        | { type?: string; url?: string; content?: { title?: string | null; source?: { type?: string; data?: unknown } } }
        | undefined;
      if (content?.type !== "web_fetch_result") continue;
      const source = content.content?.source;
      /* A PDF comes back as base64: read, but nothing to compare. */
      const read = typeof content.url === "string" ? cleanUrl(content.url) : null;
      const evidence: PageEvidence =
        source?.type === "text" && typeof source.data === "string" && read
          ? { text: `${content.content?.title ?? ""} ${source.data}`, url: read }
          : null;
      for (const key of [note(content.url), note(block.tool_use_id ? seen.asked.get(block.tool_use_id) : undefined)]) {
        if (key) seen.pages.set(key, evidence);
      }
    }
    if (block.type === "web_search_tool_result" && Array.isArray(block.content)) {
      for (const result of block.content as Array<{ url?: unknown }>) note(result?.url);
    }
  }
}

/**
 * An address that is one event's own page rather than a calendar or listing:
 * a path with an `event` or `events` segment followed by another
 * ("/event/16342908", "/events/enchanted-forest-of-light/"). A calendar
 * ("/calendar/", "/events/", "/teens/teen-events/") is not one.
 */
export function isOneEventPage(url: string): boolean {
  try {
    const parts = new URL(url).pathname.split("/").filter(Boolean).map((p) => p.toLowerCase());
    const i = parts.findIndex((p) => p === "event" || p === "events");
    return i >= 0 && i < parts.length - 1;
  } catch {
    return false;
  }
}

/**
 * The page the agent read that names an item best, for an item whose own
 * link it never opened (11 Nov). Its prompt already says "if you read the
 * event on a calendar or listing page, give that page's address"; in three
 * lab Saturdays the toddler group's agent gave the event's own address,
 * seen only inside a calendar page it read, and lost one item of five, five
 * of five and eight of eight. Only a title with two words or more to check,
 * only a page whose text has every one of them (review, 11 Nov: on any one
 * word, a made-up "Teen Pottery Workshop" found a home on a fair's page that
 * said "craft workshop"); of those, the item's own host first. **Only a
 * calendar or listing page**, never another event's own page (`isOneEventPage`;
 * the lab, 14 Nov: a Bob Lucas preschool storytime and a mobile library were
 * moved to a Loma Alta toddler storytime's page, which named them only in its
 * list of other events).
 */
export function pageNaming(title: string, itemUrl: string, pages: ReadonlyMap<string, PageEvidence>): string | null {
  const wanted = titleWords(title);
  if (wanted.length < 2) return null;
  let host = "";
  try {
    host = new URL(itemUrl).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    /* no host to prefer */
  }
  let best: { url: string; score: number } | null = null;
  for (const page of pages.values()) {
    if (!page || isListingUrl(page.url) || isOneEventPage(page.url) || !onPage(title, page, true)) continue;
    const there = new Set(words(page.text));
    const sameHost = new URL(page.url).hostname.toLowerCase().replace(/^www\./, "") === host ? 0.5 : 0;
    const score = wanted.filter((w) => there.has(w)).length + sameHost;
    if (!best || score > best.score) best = { url: page.url, score };
  }
  return best?.url ?? null;
}

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};
const md = (m: number, d: number) => `${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/** The dates a text names, month and day: single days, ranges inside a month spelled out, ranges across months kept as ranges. */
export interface TextDates {
  /** Days given with no year. */
  days: Set<string>;
  /** Days given with a year ("Dec 13, 2025"), as yyyy-mm-dd. */
  dated: Set<string>;
  ranges: Array<[string, string]>;
  /** Dates it gives as an open start — "Starting November 6", "begins Jan 6" — with no end. Not a registration's. */
  opens: string[];
  /** Days and ranges it says are closed or have no session ("Closed Dec 24 and Dec 31", "no classes Dec 21 - Jan 3"). A "break" is not one: "Thanksgiving Break Camp" is the event. */
  closed: Set<string>;
  closedRanges: Array<[string, string]>;
  /** Weekdays it names as recurring ("Thursdays", "every Thursday"), 0 = Sunday — and those it says are closed ("Closed Mondays"). */
  weekly: Set<number>;
  closedWeekly: Set<number>;
}

/**
 * Every date a text states has passed (13 Nov, a parent-eyes review: a swim class "Sunday 9:30-10:00 AM, May 3-31,
 * 2026" was offered in November). Only when it gives a year — "Dec 13" alone could be next month — and never with an
 * open start ("starts Jan 11") or a weekly day ("Thursdays"), which keep running. A day or range given without a
 * year takes the year the text did give; a range that ends before it starts runs into the next year.
 */
export function datesAllPast(text: string, today: string): boolean {
  const d = textDates(text);
  if (d.dated.size === 0 || d.opens.length > 0 || d.weekly.size > 0) return false;
  const year = Math.max(...[...d.dated].map((x) => Number(x.slice(0, 4))));
  const ends: string[] = [...d.dated];
  for (const day of d.days) ends.push(`${year}-${day}`);
  for (const [from, to] of d.ranges) ends.push(`${to < from ? year + 1 : year}-${to}`);
  return ends.every((x) => x < today);
}

const DAY_NAMES = ["sun", "mon", "tues", "wednes", "thurs", "fri", "satur"];
const TOKEN = new RegExp(
  [
    /* 1: an open start */
    "(\\b(?:starting|starts|beginning|begins)\\b)",
    /* 2: what follows is closed */
    "(\\b(?:closed|closures?|except|cancell?ed|no\\s+(?:class|classes|storytime|program|programs|session|sessions))\\b)",
    /* 3: a month, not inside a word */
    "(?<![a-z])(january|february|march|april|june|july|august|september|october|november|december|jan|feb|mar|apr|may|jun|jul|aug|sept|sep|oct|nov|dec)\\.?(?![a-z])",
    /* 4: a weekday, which neither starts nor ends a list */
    "\\b((?:mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)(?:day)?s?)\\.?(?![a-z])",
    /* 5: a year */
    "\\b(\\d{4})\\b",
    /* 6: a day — not a time, an age or a count */
    "\\b(\\d{1,2})(?:st|nd|rd|th)?(?![\\d:])(?!\\s*(?:am|pm|a\\.m|p\\.m|years?|yrs?|months?|mos?|y\\/o|yo)\\b)(?!\\s*[-–]\\s*\\d{1,2}\\s*(?:am|pm|a\\.m|p\\.m|years?|yrs?|months?|mos?)\\b)",
    /* 7: a range */
    "([-–—]|\\b(?:through|thru|to|until|till)\\b)",
    /* 8: a list goes on */
    "(,|&|[()]|\\b(?:and|or)\\b)",
    "\\S+",
  ].join("|"),
  "g",
);
const NOT_THE_EVENT = /^(registration|registrations|enrollment|enrolment|sign-?ups?|tickets?|sales|applications?|presale|pre-sale)$/;

/**
 * Month-and-day dates in a page's or an item's text (12 Nov; rebuilt after a
 * blind review): "Dec 13, 17-20, 22-24", "13 December", "Sat Dec 12 and Sun
 * 13", "December 13, 2026 - January 10, 2027" (a range across months is kept
 * as a range), "12/16", "2026-12-16"; "Starting November 6" is an open start
 * unless it is a registration's; "Closed Dec 24" and "Closed Mondays" are
 * closures. A number read as a time ("10 am", "4-6pm"), an age ("3-5 years")
 * or a clock ("10:30") is not a day, and a word that is not part of a date
 * ends the list it was in.
 */
export function textDates(text: string): TextDates {
  const out: TextDates = { days: new Set(), dated: new Set(), ranges: [], opens: [], closed: new Set(), closedRanges: [], weekly: new Set(), closedWeekly: new Set() };
  const lower = text.toLowerCase();
  let month: number | null = null;
  let prev: [number, number] | null = null;
  let pendingDay: number | null = null;
  let ranging = false;
  let opening = false;
  let closing = false;
  let listDays: string[] = [];
  const before: string[] = [];
  const reset = () => {
    month = null;
    prev = null;
    pendingDay = null;
    ranging = false;
    opening = false;
    closing = false;
    listDays = [];
  };
  const single = (m: number, d: number) => {
    const key = md(m, d);
    if (closing) out.closed.add(key);
    else if (opening) out.opens.push(key);
    else {
      out.days.add(key);
      listDays.push(key);
    }
  };
  const range = (from: [number, number], to: [number, number]) => {
    const pair: [string, string] = [md(...from), md(...to)];
    const open = out.opens.indexOf(pair[0]);
    if (open >= 0) out.opens.splice(open, 1);
    if (from[0] === to[0] && from[1] <= to[1]) {
      for (let d = from[1]; d <= to[1]; d++) {
        if (closing) out.closed.add(md(from[0], d));
        else out.days.add(md(from[0], d));
      }
    } else if (closing) out.closedRanges.push(pair);
    else out.ranges.push(pair);
  };
  const day = (m: number, d: number) => {
    if (ranging && prev) range(prev, [m, d]);
    else single(m, d);
    prev = [m, d];
    ranging = false;
  };
  for (const g of lower.matchAll(TOKEN)) {
    const [tok, opener, closer, monthName, weekday, year, dayNum, rangeSep, listSep] = g;
    const prior = before.slice(-3);
    before.push(tok);
    if (opener) {
      const registration = prior.some((w) => NOT_THE_EVENT.test(w.replace(/[^a-z-]/g, "")));
      reset();
      opening = !registration;
      continue;
    }
    if (closer) {
      reset();
      closing = true;
      continue;
    }
    if (monthName) {
      month = MONTHS[monthName];
      if (pendingDay !== null) {
        day(month, pendingDay);
        pendingDay = null;
      }
      continue;
    }
    if (weekday || listSep) {
      if (listSep && listSep !== "(" && listSep !== ")") ranging = false;
      continue;
    }
    if (year) {
      for (const key of listDays) {
        out.days.delete(key);
        out.dated.add(`${year}-${key}`);
      }
      listDays = [];
      continue;
    }
    if (dayNum) {
      const d = Number(dayNum);
      if (d < 1 || d > 31) {
        reset();
        continue;
      }
      if (month === null) {
        pendingDay = d;
        continue;
      }
      day(month, d);
      continue;
    }
    if (rangeSep) {
      ranging = prev !== null;
      continue;
    }
    reset();
  }
  for (const m of lower.matchAll(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?\b/g)) {
    const [mo, d] = [Number(m[1]), Number(m[2])];
    if (mo < 1 || mo > 12 || d < 1 || d > 31) continue;
    if (m[3]) out.dated.add(`${m[3]}-${md(mo, d)}`);
    else out.days.add(md(mo, d));
  }
  for (const m of lower.matchAll(/\b(20\d\d)-(\d\d)-(\d\d)\b/g)) out.dated.add(`${m[1]}-${m[2]}-${m[3]}`);
  DAY_NAMES.forEach((w, i) => {
    const closedRe = new RegExp(`\\bclosed\\s+(?:on\\s+)?(?:every\\s+|all\\s+)?${w}days?\\b`, "g");
    if (closedRe.test(lower)) out.closedWeekly.add(i);
    const open = lower.replace(closedRe, " ");
    if (new RegExp(`\\b${w}days\\b|\\b(?:every|each)\\s+${w}day\\b`).test(open)) out.weekly.add(i);
  });
  return out;
}

/**
 * Do the dates the item states stand on the page the agent read (12 Nov)?
 * Every date in its "when" ("Dec 13, 16-20, 22-24") must be on the page: the
 * day itself (in this year when the page gives one), inside a range the page
 * gives, on or after a start it gives with no end ("Starting November 6" —
 * the lab, 19 Dec: Kidspace's own page for a winter event gives no end), or,
 * for something weekly, the page names that weekday as recurring and the date
 * does not fall in a gap between the seasons it gives. Never a day the page
 * says is closed. With no date in the "when" ("Thursdays, 10am"), its first
 * or last date must stand the same way. A page with no date at all cannot be
 * checked and passes.
 *
 * Why (the lab test, 12 Dec): reviewers who opened every sent link found "A
 * Christmas Carol" sent for Dec 16, a night the page has no performance, and
 * a library storytime for Dec 15, after its fall session ended (Nov 21) and
 * before winter's began (Jan 6).
 */
export function datesOnPage(
  item: Pick<DigestItem, "when_text" | "starts_on" | "ends_on">,
  pageText: string,
  editionDate: string,
): boolean {
  const page = textDates(pageText);
  const anyDate = page.days.size + page.dated.size + page.ranges.length + page.opens.length;
  const anyClosure = page.closed.size + page.closedRanges.length + page.closedWeekly.size;
  if (anyDate === 0 && anyClosure === 0) return true;
  /* A month and day as a date: the year that puts it nearest the edition. */
  const edition = new Date(`${editionDate}T12:00:00Z`).getTime();
  const DAY = 86_400_000;
  const y = Number(editionDate.slice(0, 4));
  const dated = (mmdd: string) =>
    [y - 1, y, y + 1].map((yy) => new Date(`${yy}-${mmdd}T12:00:00Z`).getTime()).reduce((a, b) => (Math.abs(b - edition) < Math.abs(a - edition) ? b : a));
  const yearOf = (mmdd: string) => new Date(dated(mmdd)).getUTCFullYear();
  const span = ([from, to]: [string, string]): [number, number] => {
    const [a, b] = [dated(from), dated(to)];
    return [a, b >= a ? b : b + 365 * DAY];
  };
  const within = (x: string, r: [string, string]) => {
    const [a, b] = span(r);
    const t = dated(x);
    return t >= a && t <= b;
  };
  const weekdayOf = (mmdd: string) => new Date(dated(mmdd)).getUTCDay();
  /* Between the end of one season and the start of the next, held by none — or before every announced start. */
  const inGap = (mmdd: string) => {
    const t = dated(mmdd);
    const seasons = [...page.ranges.map(span), ...page.opens.map((o) => [dated(o), Infinity] as [number, number])];
    if (seasons.some(([a, b]) => t >= a && t <= b)) return false;
    /* Before a start the page announces ("Winter session begins January 6"). */
    if (page.opens.length > 0 && page.opens.every((o) => dated(o) > t)) return true;
    return seasons.some(([, b]) => b < t) && seasons.some(([a]) => a > t);
  };
  const closedOn = (mmdd: string) => page.closed.has(mmdd) || page.closedRanges.some((r) => within(mmdd, r)) || page.closedWeekly.has(weekdayOf(mmdd));
  const stands = (mmdd: string) => {
    if (closedOn(mmdd)) return false;
    /* A page whose only dates are closures vetoes those days and proves no others. */
    if (anyDate === 0) return true;
    return (
      page.days.has(mmdd) ||
      page.dated.has(`${yearOf(mmdd)}-${mmdd}`) ||
      page.ranges.some((r) => within(mmdd, r)) ||
      page.opens.some((o) => dated(mmdd) >= dated(o)) ||
      (page.weekly.has(weekdayOf(mmdd)) && !inGap(mmdd))
    );
  };
  const stated = textDates(item.when_text);
  const claimed = [...stated.days, ...[...stated.dated].map((d) => d.slice(5)), ...stated.ranges.flat()];
  if (claimed.length > 0) return claimed.every(stands);
  const ends = [item.starts_on, item.ends_on].filter((d): d is string => !!d).map((d) => d.slice(5));
  return ends.length === 0 || ends.some(stands);
}

/**
 * A page with next to nothing on it (the real-graph run, 14 Nov: a library's
 * "storytime-test" address and several pages that came back blank) cannot
 * stand behind an item: under 25 words of text, title included.
 */
export function pageIsEmpty(text: string): boolean {
  return text.split(/\s+/).filter((w) => /[\p{L}\p{N}]{2,}/u.test(w)).length < 25;
}

/**
 * Is the item in another state than the market's (the real-graph run, 14 Nov:
 * "Teen Takeover at Central Library" was Pasadena, Texas, and went to the
 * Arcadia teens)? Its own words naming another state (`elsewhere`, the web
 * answer's `inAnotherState`) — or the page it links naming another state and
 * never its own, since a California page can mention Texas in passing.
 */
export function placedElsewhere(
  itemText: string,
  pageText: string | null,
  state: { code: string; name: string; elsewhere: (text: string) => boolean },
): boolean {
  if (state.elsewhere(itemText)) return true;
  if (!pageText || !state.elsewhere(pageText)) return false;
  const own = new RegExp(`,\\s*${state.code}\\b|\\b${state.name}\\b`, "i");
  return !own.test(pageText);
}

/**
 * A page about the past (the real-graph run, 14 Nov: a teen DIY night linked to
 * its 2023 page, a teen club to a 2025 article): every year it names is before
 * the edition's. Years after "©", "copyright", "since", "est." and "founded"
 * are not about the event and are skipped; a page naming no year is not
 * judged. Events only — a camp's or a class's page is often years old and
 * still right.
 */
export function pageIsStale(pageText: string, editionDate: string): boolean {
  const year = Number(editionDate.slice(0, 4));
  const years = [...pageText.matchAll(/(©|copyright|since|est\.?|established|founded)?\s*\b(20[1-3]\d)\b/gi)]
    .filter((m) => !m[1])
    .map((m) => Number(m[2]));
  return years.length > 0 && Math.max(...years) < year;
}

/**
 * The agent's findings, kept only where they can be sent as they are.
 *
 * **The link must be a page the agent's search returned or it read**
 * (`seenUrls`, compared by `urlKey`) — not only a site it saw: a made-up path
 * on a real host, or a link a page asked to have listed, is dropped (review,
 * 3 Nov; the first version compared hosts and let both through). **And when
 * the agent read that page, the item must be on it** (`pages`, `onPage`,
 * 10 Nov): the words of its title in the text it read there — a page's
 * existence alone let an item through on another event's page — **and the
 * dates it states must be on that page too** (`datesOnPage`, 12 Nov). A link it
 * never opened takes the address of a page it read that names the item
 * (`pageNaming`, 11 Nov), counted in `relinked`; with none, it is dropped. The
 * dates and summary are still the model's reading. Then: a kind of thing this
 * digest carries, a title, a when, a summary; no date already gone; an event
 * within `DIGEST_EVENT_DAYS` of the edition, anything else within
 * `DIGEST_LONG_DAYS`; ages that make sense. One per thing, at most
 * `DIGEST_EDITION_MAX`.
 */
export function readAgentItems(
  raw: unknown,
  ctx: {
    editionDate: string;
    seenUrls: ReadonlySet<string>;
    pages?: ReadonlyMap<string, PageEvidence>;
    /** The market's state, and a test for text plainly about another one (`inAnotherState`, passed in so this module stays import-free). */
    state?: { code: string; name: string; elsewhere: (text: string) => boolean };
  },
  /** Why each dropped item was dropped, by count — enums only, for the log. */
  dropped: Record<string, number> = {},
  /** How many items took the address of a page the agent read (`pageNaming`). */
  relinked: { n: number } = { n: 0 },
): DigestItem[] {
  const drop = (why: string) => {
    dropped[why] = (dropped[why] ?? 0) + 1;
  };
  const list = Array.isArray(raw) ? raw : [];
  const out: DigestItem[] = [];
  for (const entry of list) {
    if (typeof entry !== "object" || entry === null) {
      drop("not_an_object");
      continue;
    }
    const r = entry as Record<string, unknown>;
    const kind = KINDS.includes(r.kind as DigestKind) ? (r.kind as DigestKind) : null;
    const title = clip(r.title, 100);
    const when_text = clip(r.when_text, 60);
    /* What the parent reads, never the agent's notes to us: a sentence in the
       first person ("I read the Nov 5 listing and took Nov 12…", the lab walk,
       3 Nov) is cut out. */
    const summary = withoutAsides(clip(r.summary, 180));
    let url = cleanUrl(clip(r.url, 400));
    let key = url ? urlKey(url) : null;
    if (!kind) {
      drop("kind");
      continue;
    }
    if (title.length < 3 || when_text.length < 2 || summary.length < 10) {
      drop("thin");
      continue;
    }
    if (!url || !key) {
      drop("no_link");
      continue;
    }
    if (!ctx.seenUrls.has(key)) {
      const read = ctx.pages ? pageNaming(title, url, ctx.pages) : null;
      if (!read) {
        drop("unseen_url");
        continue;
      }
      url = read;
      key = urlKey(read)!;
      relinked.n++;
    }
    if (isListingUrl(url)) {
      drop("listing_page");
      continue;
    }
    if (ctx.pages?.has(key) && !onPage(title, ctx.pages.get(key)!)) {
      drop("not_on_page");
      continue;
    }

    const starts_on = isoOrNull(r.starts_on);
    const ends_on = isoOrNull(r.ends_on);
    const last = ends_on ?? starts_on;
    if (last && last < ctx.editionDate) {
      drop("past");
      continue;
    }
    if (kind === "event") {
      if (!starts_on && !ends_on) {
        drop("undated_event");
        continue;
      }
      /* Read on the day it is sent (6 Nov, the lab walk): a ceremony at 10am went
         out in a digest sent at 10am. An event that is only today is gone by the
         time most read it; one running for days through today stays. */
      if (last === ctx.editionDate) {
        drop("today_only");
        continue;
      }
      if ((starts_on ?? ends_on)! > addDays(ctx.editionDate, DIGEST_EVENT_DAYS)) {
        drop("too_far");
        continue;
      }
    } else if (starts_on && starts_on > addDays(ctx.editionDate, DIGEST_LONG_DAYS)) {
      drop("too_far");
      continue;
    }
    /* The dates it states, on the page it links, when the agent read that page (12 Nov, `datesOnPage`). */
    const read = ctx.pages?.get(key);
    if (read && !datesOnPage({ when_text, starts_on, ends_on }, read.text, ctx.editionDate)) {
      drop("date_not_on_page");
      continue;
    }
    /* Three checks of the page itself (the real-graph run, 14 Nov). */
    if (read && pageIsEmpty(read.text)) {
      drop("empty_page");
      continue;
    }
    if (ctx.state && placedElsewhere(`${title} | ${clip(r.place, 60)} | ${summary}`, read?.text ?? null, ctx.state)) {
      drop("another_state");
      continue;
    }
    if (kind === "event" && read && pageIsStale(read.text, ctx.editionDate)) {
      drop("stale_page");
      continue;
    }

    let age_min = ageOrNull(r.age_min);
    let age_max = ageOrNull(r.age_max);
    if (age_min !== null && age_max !== null && age_min > age_max) [age_min, age_max] = [age_max, age_min];

    /* One per thing (`sameThing`, 11 Nov — one per title before). Not one per
       link: a week's roundup page lists several events, and the lab walk
       (3 Nov) lost five of seven to that rule. */
    if (out.some((o) => sameThing(o, { title, starts_on, ends_on, place: clip(r.place, 60) || null }))) {
      drop("duplicate");
      continue;
    }
    out.push({ kind, title, when_text, starts_on, ends_on, place: clip(r.place, 60) || null, age_min, age_max, summary, url });
    if (out.length >= DIGEST_EDITION_MAX) break;
  }
  return out;
}

/**
 * Does an item suit this household? An item with no ages suits everyone. A
 * parent's children must have one inside its range (a baby on the way counts
 * as 0). Somebody with no children (open signup, 3 Nov) gets only what is for
 * everyone or for adults — a toddler class is not news to them.
 */
export function ageFits(item: Pick<DigestItem, "age_min" | "age_max">, childAges: readonly number[]): boolean {
  if (item.age_min === null && item.age_max === null) return true;
  if (childAges.length === 0) return item.age_max === null || item.age_max >= 18;
  return childAges.some((a) => {
    const age = Math.max(0, a);
    return (item.age_min === null || age >= item.age_min) && (item.age_max === null || age <= item.age_max);
  });
}

/**
 * A child's age on a date, from the birth year and — when it was given — the
 * month (review, 3 Nov: a December 2020 child is 5 in November 2026, not 6). A
 * baby on the way (a due year ahead) comes out negative, which `ageFits` reads
 * as 0.
 */
export function ageOn(birthYear: number, birthMonth: number | null, today: string): number {
  const [year, month] = today.split("-").map(Number);
  const age = year - birthYear;
  return birthMonth !== null && birthMonth > month ? age - 1 : age;
}

/* Words too common to tell two titles apart. */
const FILLER = new Set(["with", "from", "this", "that", "your", "the", "and", "for", "at", "in", "on", "of"].map(stem));

const placeWordsOf = (place: string | null | undefined) => new Set(words(place ?? "").filter((w) => !FILLER.has(w)));

/**
 * One place, written two ways (the real-graph run, 14 Nov: "Sierra Madre
 * Library" and "Sierra Madre Public Library"): every word of the shorter name
 * is in the longer. A missing name matches anything — callers that need a
 * real place check that themselves.
 */
function samePlace(x: string | null | undefined, y: string | null | undefined): boolean {
  const [px, py] = [placeWordsOf(x), placeWordsOf(y)];
  if (px.size === 0 || py.size === 0) return true;
  const [small, large] = px.size <= py.size ? [px, py] : [py, px];
  return [...small].every((w) => large.has(w));
}

/* Words a venue's name may carry or drop and still be the one venue ("Sierra Madre (Public) Library"). */
const VENUE_OPTIONAL = new Set(["public", "main"].map(stem));
/* A place that is no venue at all. */
const NOT_A_VENUE = new Set(["various", "location", "online", "virtual", "zoom", "multiple", "citywide", "venue"].map(stem));

const venueSegments = (place: string | null | undefined) =>
  (place ?? "").split(",").map((part) => new Set(words(part).filter((w) => !FILLER.has(w))));

/**
 * Both items are at one venue — not merely one town, one chain or one library
 * system (review, 11 Nov). The name before the first comma, two words at least,
 * the same words but for "public" or "main" ("Sierra Madre Library" / "Sierra
 * Madre Public Library"); and what follows the comma — a town, a branch, the
 * building of a room — not in conflict ("…, Pasadena" and nothing; not
 * "…, Hastings Branch" and "…, Allendale Branch", not "Barnes & Noble,
 * Pasadena" and "…, Arcadia", not "Community Room, Hastings Library" and
 * "…, Allendale Library"). "Central Library" is not "Glendale Central
 * Library"; a town, one word or "Various locations" is never a venue.
 */
export function atSameVenue(a: { place?: string | null }, b: { place?: string | null }): boolean {
  const [sa, sb] = [venueSegments(a.place), venueSegments(b.place)];
  const [ca, cb] = [sa[0] ?? new Set<string>(), sb[0] ?? new Set<string>()];
  if (ca.size < 2 || cb.size < 2) return false;
  if ([...ca, ...cb].some((w) => NOT_A_VENUE.has(w))) return false;
  const core = (x: Set<string>) => [...x].filter((w) => !VENUE_OPTIONAL.has(w));
  const [ka, kb] = [new Set(core(ca)), new Set(core(cb))];
  if (ka.size !== kb.size || ![...ka].every((w) => kb.has(w))) return false;
  const rest = (segs: Set<string>[]) => new Set(segs.slice(1).flatMap((s) => [...s]));
  const [ra, rb] = [rest(sa), rest(sb)];
  if (ra.size === 0 || rb.size === 0) return true;
  const [small, large] = ra.size <= rb.size ? [ra, rb] : [rb, ra];
  return [...small].every((w) => large.has(w));
}

/* A title's every word, short ones and numbers too ("Jr", "K-2", "Level 1", "Mon"), plurals as singular. */
const allTitleWords = (title: string) =>
  new Set(
    title
      .normalize("NFKD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter(Boolean)
      .map((w) => (w.length >= 4 ? stem(w) : w))
      .filter((w) => !FILLER.has(w)),
  );

/**
 * The same thing under two titles (11 Nov, the lab: "Old Pasadena Santa
 * Letters" and "Santa Letters at Old Pasadena" from two groups' editions went
 * to one family). The same dates — the same start, or for something running
 * for days the same end (review, 11 Nov: "Winter Frolic" dated from two
 * different days by two agents) — and every word of the shorter title in the
 * longer, which has at most two more ("Toddler Tuesday at Kidspace" and "…
 * Kidspace Children's Museum"). Counted over all its words, generic ones too:
 * on distinctive words alone "Kidspace Free Night" was inside "Kidspace
 * Halloween Party" (review, 11 Nov), and "Pasadena Farmers Market" stays
 * apart from "Pasadena Farmers Market Cooking Demo for Kids".
 */
export function sameThing(
  a: Pick<DigestItem, "title" | "starts_on"> & { ends_on?: string | null; place?: string | null; age_min?: number | null; age_max?: number | null },
  b: Pick<DigestItem, "title" | "starts_on"> & { ends_on?: string | null; place?: string | null; age_min?: number | null; age_max?: number | null },
): boolean {
  /* The same title at the same place is one thing whatever the dates (the lab,
     14 Nov: a weekly storytime given for Nov 17 and Nov 24 went out twice in
     one text). Not at two places: "Storytime" at two libraries is two
     (review, 12 Nov). A title with no letters at all is never "the same". */
  /* Two things for ages that do not meet are two, whatever else they share
     (review, 11 Nov: "Lego Club" 7-12 and "Lego Club Jr" 4-6 on one day were one,
     and the pool kept the older one — a 5-year-old's family lost the only item
     that suited them). Ages that overlap may be one thing read two ways (the
     lab, 5 Dec: "Toddler Tuesday" 0-5 and 0-4 from two agents). */
  const aged = (x: typeof a) => x.age_min != null || x.age_max != null;
  if (aged(a) && aged(b) && ((a.age_max ?? 99) < (b.age_min ?? 0) || (b.age_max ?? 99) < (a.age_min ?? 0))) return false;
  const letters = (t: string | null | undefined) =>
    (t ?? "").normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  const ta = letters(a.title);
  if (ta !== "" && ta === letters(b.title)) return samePlace(a.place, b.place);
  /* The same words, spelt a little differently, at one venue (the 21 Nov run:
     "Video Games Club for teens" and "Video Game Club (teens)" at one library,
     two dates, five teen families sent it twice): one thing whatever the
     dates, as an identical title is. Every word counts — short ones and
     numbers too, so "Lego Club" is not "Lego Club Jr", nor "Math Club K-2"
     "Math Club 3-5", nor "Mon Chess Club" "Wed Chess Club" (review, 11 Nov);
     ages that do not meet were set apart above. */
  {
    const [sa, sb] = [allTitleWords(a.title), allTitleWords(b.title)];
    if (sa.size >= 2 && sa.size === sb.size && [...sa].every((w) => sb.has(w)) && atSameVenue(a, b)) return true;
  }
  const sameStart = (a.starts_on ?? "") === (b.starts_on ?? "");
  const sameEnd = !!a.ends_on && a.ends_on === b.ends_on && a.ends_on !== a.starts_on;
  if (!sameStart && !sameEnd) return false;
  /* The same day at the same place, named two ways (the lab, 14 Nov: "Barks &
     Books: read aloud to a therapy dog" and "Barks & Books with Sawyer the
     therapy dog"): with the place's own words set aside, more than half the
     longer title's distinctive words in common, and two at least. Not
     "Toddler Storytime" and "Preschool Storytime" (one word), nor "Farmers
     Market" and "Farmers Market Cooking Demo" (two of four). */
  if (sameStart && placeWordsOf(a.place).size > 0 && placeWordsOf(b.place).size > 0 && samePlace(a.place, b.place)) {
    const placeWords = new Set(words(a.place ?? ""));
    const [ta2, tb2] = [titleWords(a.title), titleWords(b.title)].map((ws) => ws.filter((w) => !placeWords.has(w)));
    const shared = tb2.filter((w) => ta2.includes(w)).length;
    if (shared >= 2 && shared > Math.max(ta2.length, tb2.length) / 2) return true;
  }
  const wa = [...new Set(words(a.title).filter((w) => !FILLER.has(w)))];
  const wb = [...new Set(words(b.title).filter((w) => !FILLER.has(w)))];
  if (wa.length === 0 || wb.length === 0) return false;
  const [small, large] = wa.length <= wb.length ? [wa, new Set(wb)] : [wb, new Set(wa)];
  if (small.length < 2 && small.length !== large.size) return false;
  return large.size - small.length <= 2 && small.every((w) => large.has(w));
}

/**
 * What a family may be sent (11 Nov): its own group's items, and from the
 * other groups' editions this Saturday the items made for an age one of its
 * children is — never another group's all-ages items, which are that group's
 * choice. A family is in one group (the lab test, 10 Nov: a toddler and a
 * 14 year old in Altadena were grouped with the toddlers, and nothing was
 * ever for the teen). One per thing (`sameThing`).
 */
export function poolForFamily(own: readonly DigestItem[], others: readonly (readonly DigestItem[])[], childAges: readonly number[]): DigestItem[] {
  /* Its own edition is deduplicated too: an edition stored before a reader
     change can hold one thing twice (the lab, 14 Nov). */
  const pool: DigestItem[] = [];
  for (const item of own) if (!pool.some((p) => sameThing(p, item))) pool.push(item);
  if (childAges.length === 0) return pool;
  for (const items of others) {
    for (const item of items) {
      if (item.age_min === null && item.age_max === null) continue;
      if (!ageFits(item, childAges)) continue;
      if (pool.some((p) => sameThing(p, item))) continue;
      pool.push(item);
    }
  }
  return pool;
}

/**
 * What one parent gets: what suits their household, events first by date, at
 * most `DIGEST_MAX_ITEMS`, and **one item per place** (the 21 Nov run: the baby
 * groups' four were two or three at Kidspace — its winter season, a mobile
 * library visit, "open Monday for Thanksgiving break"). The next item at
 * another venue takes the spot; with nothing else, a digest is shorter rather
 * than one venue's. A place that is only a town is not a venue (`atSameVenue`).
 */
export function pickForPerson(items: readonly DigestItem[], childAges: readonly number[]): DigestItem[] {
  const fits = items.filter((item) => ageFits(item, childAges));
  /* Made for their children first (6 Nov, the lab walk: a teen group was sent a
     flea market and an e-bike hub opening ahead of anything for teens): an item
     whose ages hold one of theirs, then one with no ages; events before the rest
     within each. */
  const forThem = (item: DigestItem) => (childAges.length > 0 && (item.age_min !== null || item.age_max !== null) ? 0 : 1);
  const order = (item: DigestItem) => (item.kind === "event" ? 0 : 1);
  const sorted = [...fits].sort((a, b) => forThem(a) - forThem(b) || order(a) - order(b) || (a.starts_on ?? "9999").localeCompare(b.starts_on ?? "9999"));
  const picked: DigestItem[] = [];
  for (const item of sorted) {
    if (picked.length >= DIGEST_MAX_ITEMS) break;
    if (picked.some((p) => atSameVenue(p, item))) continue;
    picked.push(item);
  }
  return picked;
}

/**
 * GSM-7: a curly quote or a long dash turns the whole digest into UCS-2 and
 * triples its cost. An accented letter loses its accent, not itself (the lab
 * test, 10 Nov: "La Cañada Flintridge" went out as "La Caada Flintridge") —
 * the way `pingSubject` in sms-templates.ts does it.
 */
export function plain(text: string): string {
  return text
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\x20-\x7E\n]/g, "");
}

/**
 * The most one message may hold: Twilio refuses a body over 1,600 characters
 * (error 21617), and the review measured five ordinary items at 1,969 — so
 * nobody with five matches would ever have been sent one.
 */
export const DIGEST_MAX_CHARS = 1600;

/* 13 Nov, a parent-eyes review: "Pando weekly" said neither what it is nor that it is the list they asked for, and
   only DIGEST OFF was offered as a way out of a recurring text. */
const DIGEST_HEAD = "Pando: your Saturday list of local events, camps and classes.";
/* 11 Nov (evening): a pick is the reminder itself — the same pick again takes it off (`lib/digest-followup.ts`). */
const DIGEST_FOOT =
  "Reply with the numbers you'd like a reminder for (e.g. 1 3). Public listings - check with the organizer. DIGEST OFF stops these, STOP stops all texts.";
/** The card's own line: the buttons ask the question, so the card only says what they are for. */
const DIGEST_CARD_FOOT = "Tap the ones you'd like a reminder for - tap again to undo. Public listings - check with the organizer. DIGEST OFF stops these, STOP stops all texts.";
/* A digest of one item (the 21 Nov run: a teen family got one, under "tap more than one if you like"). */
const DIGEST_FOOT_ONE = "Reply 1 for a reminder. Public listings - check with the organizer. DIGEST OFF stops these, STOP stops all texts.";
const DIGEST_CARD_FOOT_ONE = "Tap 1 for a reminder. Public listings - check with the organizer. DIGEST OFF stops these, STOP stops all texts.";

/**
 * The text, and how many items it carries. Public listings, said so
 * (invariant 3: never present public information as human trust), each with
 * the organizer's own link, and how to stop it — the digest's own off switch
 * before STOP, which ends everything.
 *
 * Items go in whole while the message stays within `DIGEST_MAX_CHARS`; one
 * that would not fit is left out rather than cut, because a cut link is a
 * broken one. **Numbered since 11 Nov** (the developer: a parent picks what
 * interests them, several if they like, `lib/digest-followup.ts`) — reversing
 * the 3 Nov dashes, whose reason was that nothing should read a reply of "2"
 * as an item; now a reply is read as a pick only when the digest is the last
 * thing Pando sent that person. `items` is what went in, in its numbers' order,
 * kept so "2" can be found again; `card` is the RCS card's text, whose buttons
 * are the numbers.
 */
export function composeDigest(items: readonly DigestItem[]): { body: string; card: string; included: number; items: DigestItem[] } {
  const kept: DigestItem[] = [];
  const lines: string[] = [];
  /* The SMS lines leave out the summary (13 Nov, a parent-eyes review: four items made 1,325 characters, nine
     segments, a wall on a phone without RCS); the card, which costs no segments, keeps it. Each item is kept or
     left by its card line, the longer of the two, so both carry the same items under the same numbers. */
  const sms: string[] = [];
  let length = DIGEST_HEAD.length + 2 + Math.max(DIGEST_FOOT.length, DIGEST_CARD_FOOT.length);
  for (const item of items) {
    const where = item.place ? `, ${item.place}` : "";
    const line = plain(`${kept.length + 1}. ${item.title} - ${item.when_text}${where}. ${item.summary} ${item.url}`);
    if (length + line.length + 2 > DIGEST_MAX_CHARS) continue;
    kept.push(item);
    lines.push(line);
    sms.push(plain(`${kept.length}. ${item.title} - ${item.when_text}${where}. ${item.url}`));
    length += line.length + 2;
  }
  const one = lines.length === 1;
  return {
    body: plain([DIGEST_HEAD, ...sms, one ? DIGEST_FOOT_ONE : DIGEST_FOOT].join("\n\n")),
    card: plain([DIGEST_HEAD, ...lines, one ? DIGEST_CARD_FOOT_ONE : DIGEST_CARD_FOOT].join("\n\n")),
    included: lines.length,
    items: kept,
  };
}

/**
 * What to do with an edition after an agent run (review, 3 Nov). Only a run
 * that finished with an empty list (`[]`, `returned` 0) is a real "nothing
 * this week"; a deadline, a cut-off reply, a refusal or no key is a failure,
 * and the next hourly run tries again — up to `DIGEST_AGENT_ATTEMPTS` a
 * Saturday.
 *
 * **A list whose every item was dropped is a failure too** (the lab test,
 * 10 Nov): the toddler group's agent returned eight items whose links it had
 * only seen inside pages, all eight were dropped, and as `empty` the five
 * families were claimed with nothing for the week. Run again, the same group
 * kept eight of eight.
 */
export const DIGEST_AGENT_ATTEMPTS = 3;

export function editionOutcome(run: { end: string; parsed: boolean; returned: number; kept: number }): "ready" | "empty" | "failed" {
  if (run.kept > 0) return "ready";
  if (run.end !== "end_turn" || !run.parsed) return "failed";
  return run.returned > 0 ? "failed" : "empty";
}

/**
 * DIGEST and DIGEST OFF over SMS — the separate yes, and its undo. Whole
 * message only, like every command here: "is there a digest of camps?" is a
 * question. Never STOP on its own, which is the carrier's and ends everything.
 */
export function digestCommand(text: string): "on" | "off" | null {
  const word = text.trim().toUpperCase().replace(/[.!]+$/, "").replace(/[\s-]+/g, " ");
  if (["DIGEST", "DIGEST ON", "START DIGEST", "WEEKLY DIGEST", "SUBSCRIBE DIGEST"].includes(word)) return "on";
  if (["DIGEST OFF", "STOP DIGEST", "NO DIGEST", "UNSUBSCRIBE DIGEST", "DIGEST STOP"].includes(word)) return "off";
  return null;
}

export const DIGEST_ON_REPLY =
  "You're in: every Saturday morning I'll text you a few local events, camps and classes. Reply DIGEST OFF any time to stop them.";
export const DIGEST_OFF_REPLY =
  "Done, no more weekly digest. You can still text me any question, and DIGEST turns it back on.";

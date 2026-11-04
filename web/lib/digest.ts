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
/** Items per parent. */
export const DIGEST_MAX_ITEMS = 5;
/** Items kept per edition, from which each parent's are picked. */
export const DIGEST_EDITION_MAX = 12;
/** An event is "this week" if it starts within this many days of the Saturday. */
export const DIGEST_EVENT_DAYS = 14;
/** A camp, class or opportunity may be further out — summer camps open their books in winter. */
export const DIGEST_LONG_DAYS = 180;

export type DigestKind = "event" | "camp" | "class" | "opportunity";
const KINDS: readonly DigestKind[] = ["event", "camp", "class", "opportunity"];

export interface DigestItem {
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

/**
 * The agent's findings, kept only where they can be sent as they are.
 *
 * **The link must be a page the agent's search returned or it read**
 * (`seenUrls`, compared by `urlKey`) — not only a site it saw: a made-up path
 * on a real host, or a link a page asked to have listed, is dropped (review,
 * 3 Nov; the first version compared hosts and let both through). That the
 * page exists is all it proves — the title, dates and summary are still the
 * model's reading of it. Then: a kind of thing this digest carries, a
 * title, a when, a summary; no date already gone; an event within
 * `DIGEST_EVENT_DAYS` of the edition, anything else within `DIGEST_LONG_DAYS`;
 * ages that make sense. One per title, at most `DIGEST_EDITION_MAX`.
 */
export function readAgentItems(
  raw: unknown,
  ctx: { editionDate: string; seenUrls: ReadonlySet<string> },
  /** Why each dropped item was dropped, by count — enums only, for the log. */
  dropped: Record<string, number> = {},
): DigestItem[] {
  const drop = (why: string) => {
    dropped[why] = (dropped[why] ?? 0) + 1;
  };
  const list = Array.isArray(raw) ? raw : [];
  const out: DigestItem[] = [];
  const titles = new Set<string>();
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
    const url = cleanUrl(clip(r.url, 400));
    const key = url ? urlKey(url) : null;
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
      drop("unseen_url");
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
      if ((starts_on ?? ends_on)! > addDays(ctx.editionDate, DIGEST_EVENT_DAYS)) {
        drop("too_far");
        continue;
      }
    } else if (starts_on && starts_on > addDays(ctx.editionDate, DIGEST_LONG_DAYS)) {
      drop("too_far");
      continue;
    }

    let age_min = ageOrNull(r.age_min);
    let age_max = ageOrNull(r.age_max);
    if (age_min !== null && age_max !== null && age_min > age_max) [age_min, age_max] = [age_max, age_min];

    const titleKey = title.toLowerCase().replace(/[^a-z0-9]/g, "");
    /* One per title. Not one per link: a week's roundup page lists several
       events, and the lab walk (3 Nov) lost five of seven to that rule. */
    if (titles.has(titleKey)) {
      drop("duplicate");
      continue;
    }
    titles.add(titleKey);
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

/** What one parent gets: what suits their household, events first by date, at most `DIGEST_MAX_ITEMS`. */
export function pickForPerson(items: readonly DigestItem[], childAges: readonly number[]): DigestItem[] {
  const fits = items.filter((item) => ageFits(item, childAges));
  const order = (item: DigestItem) => (item.kind === "event" ? 0 : 1);
  return [...fits]
    .sort((a, b) => order(a) - order(b) || (a.starts_on ?? "9999").localeCompare(b.starts_on ?? "9999"))
    .slice(0, DIGEST_MAX_ITEMS);
}

/** GSM-7: a curly quote or a long dash turns the whole digest into UCS-2 and triples its cost. */
function plain(text: string): string {
  return text
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/[^\x20-\x7E\n]/g, "");
}

/**
 * The most one message may hold: Twilio refuses a body over 1,600 characters
 * (error 21617), and the review measured five ordinary items at 1,969 — so
 * nobody with five matches would ever have been sent one.
 */
export const DIGEST_MAX_CHARS = 1600;

const DIGEST_HEAD = "Pando weekly: what's on near you.";
const DIGEST_FOOT =
  "Public listings found this week - check details with the organizer. Reply DIGEST OFF to stop these, or ask me anything.";

/**
 * The text, and how many items it carries. Public listings, said so
 * (invariant 3: never present public information as human trust), each with
 * the organizer's own link, and how to stop it — the digest's own off switch
 * before STOP, which ends everything.
 *
 * Items go in whole while the message stays within `DIGEST_MAX_CHARS`; one
 * that would not fit is left out rather than cut, because a cut link is a
 * broken one. Dashes, not numbers: nothing reads a reply of "2" as an item,
 * and an open question could take it as an answer (review, 3 Nov).
 */
export function composeDigest(items: readonly DigestItem[]): { body: string; included: number } {
  const lines: string[] = [];
  let length = DIGEST_HEAD.length + 2 + DIGEST_FOOT.length;
  for (const item of items) {
    const where = item.place ? `, ${item.place}` : "";
    const line = plain(`- ${item.title} - ${item.when_text}${where}. ${item.summary} ${item.url}`);
    if (length + line.length + 2 > DIGEST_MAX_CHARS) continue;
    lines.push(line);
    length += line.length + 2;
  }
  return { body: plain([DIGEST_HEAD, ...lines, DIGEST_FOOT].join("\n\n")), included: lines.length };
}

/**
 * What to do with an edition after an agent run (review, 3 Nov). Only a run
 * that finished and gave a list that turned out empty is a real "nothing this
 * week"; a deadline, a cut-off reply, a refusal or no key is a failure, and
 * the next hourly run tries again — up to `DIGEST_AGENT_ATTEMPTS` a Saturday.
 */
export const DIGEST_AGENT_ATTEMPTS = 3;

export function editionOutcome(run: { end: string; parsed: boolean; kept: number }): "ready" | "empty" | "failed" {
  if (run.kept > 0) return "ready";
  return run.end === "end_turn" && run.parsed ? "empty" : "failed";
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

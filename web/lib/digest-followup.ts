/**
 * The weekly digest, answered (11 Nov) — the pure half: reading a reply of
 * numbers, the texts that follow it, when the reminder and the feedback
 * question are due, and reading the feedback buttons.
 *
 * The developer: the digest should not be a message that ends; a parent picks
 * what interests them — several, ideally — is reminded before it, and is asked
 * afterwards how it was. Since 11 Nov (evening) a pick **is** the reminder: a
 * tap sets it, the same tap again takes it off (`PickOutcome`); the earlier
 * copy of the line with "remind you? Yes/No" is gone. The developer's choices:
 *  - **numbers and buttons**: the digest's items are numbered 1-4; on RCS the
 *    card carries buttons "1" to "4" inside it (several taps, several picks —
 *    they stay after the next message, a chip list would not), and a typed
 *    "1 3" works anywhere. This reverses the 3 Nov rule that items carry dashes
 *    so a reply of "2" is nobody's item — a reply is read as a pick only when
 *    the last thing Pando sent that person was the digest;
 *  - **outside the contributor limits**: the reminder and the feedback question
 *    follow from the parent's own yes, sent in category `digest` (quiet hours
 *    and STOP apply, the monthly cap does not);
 *  - **feedback by buttons** — "Loved it", "It was OK", "Didn't go", or the
 *    same words typed (`readFeedback`, `readFeedbackPhrase`) — stored as one of
 *    three values, so nothing a parent writes is kept;
 *  - **no second search**: what the digest holds is all there is; the link is
 *    in the digest.
 *
 * Import-free, so `npm run test:digest-followup` loads it in plain node.
 */

/** The most items a digest carries, and so the numbers a reply may pick (`DIGEST_MAX_ITEMS`). */
export const PICK_MAX = 4;

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5,
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5,
  "1st": 1, "2nd": 2, "3rd": 3, "4th": 4, "5th": 5,
};

/**
 * The item numbers in a reply, or null when the reply is not a pick: "2",
 * "1 3", "1, 3", "1 and 3", "#2", "2 & 5", "the first and third", "all".
 * Only numbers and joining words — "2 kids under 5?" is a question, not a
 * pick. Numbers past `count` are dropped; none left is null.
 */
export function readPicks(text: string, count: number): number[] | null {
  const t = text.toLowerCase().replace(/[#.!]/g, " ").trim();
  if (!t) return null;
  if (/^(all|all of them|everything|all four)$/.test(t)) return Array.from({ length: count }, (_, i) => i + 1);
  const JOINING = new Set(["and", "the", "please", "number", "numbers", "item", "items", "option", "options", "pls", "plz"]);
  const tokens = t.split(/[\s,;&+/]+/).filter((w) => w && !JOINING.has(w));
  if (tokens.length === 0) return null;
  const picks: number[] = [];
  for (const tok of tokens) {
    const n = /^\d{1,2}$/.test(tok) ? Number(tok) : NUMBER_WORDS[tok];
    if (n === undefined) return null;
    if (n >= 1 && n <= count && !picks.includes(n)) picks.push(n);
  }
  return picks.length ? picks.sort((a, b) => a - b) : null;
}

/**
 * A reply that is only numbers, none of them on the digest ("5" on a digest of
 * three, "0"): answered with the range, never passed on to be read as an age
 * or a monthly limit (review, 11 Nov).
 */
export function picksOutOfRange(text: string, count: number): boolean {
  return readPicks(text, count) === null && readPicks(text.replace(/\b0\b/g, "99"), 99) !== null;
}

/**
 * A pick while the weekly digest is off (13 Nov, the lab): its reminders and questions are not sent while it is
 * off, so "Got it - I'll text you…" was a promise nothing would keep. Nothing is stored; DIGEST, then the pick.
 */
export const PICK_WHILE_OFF_SMS =
  "Your weekly digest is off, so I won't send reminders for it. Reply DIGEST to turn it back on, then tap or reply with the number again.";

/** The answer to a number the digest did not have. */
export function outOfRangeSms(count: number): string {
  return count === 1
    ? "That digest had just one item - reply 1 for a reminder."
    : `That digest had ${count} items - reply with a number from 1 to ${count}, or several (e.g. 1 3).`;
}

export type Feedback = "loved" | "ok" | "didnt_go";

/** The feedback buttons, by title or as typed; null for anything else. */
export function readFeedback(text: string): Feedback | null {
  const t = text.toLowerCase().replace(/[’']/g, "'").replace(/[.!]+$/, "").trim();
  if (/^(loved it|loved|love it|great|amazing|awesome|we loved it)$/.test(t)) return "loved";
  if (/^(it was ok|it was okay|ok|okay|fine|so so|so-so|meh)$/.test(t)) return "ok";
  if (/^(didn't go|did not go|didnt go|we didn't go|we did not go|didn't make it|couldn't go|missed it|no)$/.test(t)) return "didnt_go";
  return null;
}

/**
 * The feedback words that can only be feedback — not "ok", "no", "fine" or
 * "great", which answer other things — read when "how was it?" is still open
 * but another digest text has gone since (the 21 Nov run: a parent picked
 * another event, then wrote "didn't go", and got the help text).
 */
export function readFeedbackPhrase(text: string): Feedback | null {
  const t = text.toLowerCase().replace(/[’']/g, "'").replace(/[.!]+$/, "").trim();
  if (/^(loved it|love it|we loved it)$/.test(t)) return "loved";
  if (/^(it was ok|it was okay)$/.test(t)) return "ok";
  if (/^(didn't go|did not go|didnt go|we didn't go|we did not go|didn't make it|couldn't go|missed it)$/.test(t)) return "didnt_go";
  return null;
}

export interface FollowupItem {
  /** `digest_items.kind`: event, camp, class or opportunity. */
  kind?: string;
  title: string;
  when_text: string;
  starts_on: string | null;
  ends_on: string | null;
  place: string | null;
  summary: string;
  url: string;
}

const addDays = (date: string, days: number) => {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/**
 * The day to remind on, or null when the item gives none. `today` is the
 * market's date when the parent picks (the edition's date by default): the
 * reminder goes on a morning still to come, never today or before — a pick
 * made after the event, or on its afternoon, gets no reminder (review, 11 Nov).
 * An event or a camp that starts later: its first day. One already running
 * (a winter fair through January): the Saturday after the digest, if it still
 * runs then and that is still to come, else its last day. With no date at all
 * (an ongoing class): no reminder.
 */
export function remindOn(item: Pick<FollowupItem, "starts_on" | "ends_on">, editionDate: string, today: string = editionDate): string | null {
  const from = today > editionDate ? today : editionDate;
  const start = item.starts_on;
  const end = item.ends_on;
  if (start && start > from) return start;
  if (end && end > from) {
    let next = addDays(editionDate, 7);
    if (next <= from) next = addDays(from, 1);
    return end >= next ? next : end;
  }
  return null;
}

/**
 * The day the feedback question is due: the day after the reminder's — and,
 * for a camp that began that day (a week of camp), the day after its last, at
 * most a week on (review, 11 Nov: not "how was camp?" on its Tuesday). Only a
 * camp: a weekly class's "Nov 16 and Nov 23" is two sessions, not one long
 * one, and is asked about the day after the first (lab, 11 Nov). A running
 * fair reminded on a Saturday is asked on the Sunday.
 */
export function feedbackOn(remind: string, item?: Pick<FollowupItem, "kind" | "starts_on" | "ends_on">): string {
  if (item?.kind === "camp" && item.starts_on === remind && item.ends_on && item.ends_on > remind) {
    const after = addDays(item.ends_on, 1);
    const cap = addDays(remind, 7);
    return after < cap ? after : cap;
  }
  return addDays(remind, 1);
}

/** The earliest a reminder goes (the market's clock); quiet hours end at 8:00. */
export const REMIND_EARLIEST = { h: 8, m: 0 };
/** How long before an event's stated start its reminder goes (the developer, 11 Nov: two hours). */
export const REMIND_BEFORE_MINUTES = 120;
/** When the feedback question goes, on its day (the developer, 11 Nov: 10:00). */
export const ASK_AT = { h: 10, m: 0 };

/**
 * The first clock time an item's `when_text` states, by position, or null:
 * "Tue Nov 17, 10am-12pm" → 10:00, "4:30-5:30pm" → 16:30, "4-4:30pm" →
 * 16:00, "11-1pm" → 11:00, "noon-2pm" → 12:00, "Doors 9am, show 10am" → 9:00,
 * "Sat 10:30" → 10:30, "13:00" → 13:00, "10 a.m." → 10:00. A range's start
 * without am/pm takes the end's, unless that would put it after the end. A bare
 * number is not a time ("Nov 16-23", "ages 2-5", "Sat 10-12" — too easily an
 * age), and nothing inside a link is read (review, 11 Nov).
 */
export function startTime(whenText: string): { h: number; m: number } | null {
  const t = whenText
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/\b([ap])\.\s?m\.?/g, "$1m")
    .replace(/\bnoon\b/g, "12pm")
    .replace(/\bmidnight\b/g, "12am");
  const to24 = (h: number, ap: string) => (ap === "pm" ? (h % 12) + 12 : h % 12);
  const TIME = /(?<![\d:\/.-])(\d{1,2})(?::(\d{2}))?\s*(am|pm)?(?:\s*(?:-|–|—|to)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?)?(?![\d:\/])/g;
  for (const [, h1s, m1s, ap1, h2s, m2s, ap2] of t.matchAll(TIME)) {
    const h1 = Number(h1s);
    const m1 = Number(m1s ?? 0);
    if (m1 > 59) continue;
    if (ap1) {
      if (h1 < 1 || h1 > 12) continue;
      return { h: to24(h1, ap1), m: m1 };
    }
    if (h2s && ap2 && h1 >= 1 && h1 <= 12 && Number(h2s) >= 1 && Number(h2s) <= 12) {
      const end = to24(Number(h2s), ap2) * 60 + Number(m2s ?? 0);
      let start = to24(h1, ap2) * 60 + m1;
      if (start > end) start = to24(h1, ap2 === "pm" ? "am" : "pm") * 60 + m1;
      return { h: Math.floor(start / 60), m: start % 60 };
    }
    if (m1s !== undefined && h1 <= 23) {
      /* "10:30" with no am/pm: a 24-hour time from 13, else a family's day — 7-11 morning, 12 noon, 1-6 afternoon. */
      const h = h1 >= 13 || h1 === 12 ? h1 : h1 >= 7 ? h1 : h1 === 0 ? 0 : h1 + 12;
      return { h, m: m1 };
    }
  }
  return null;
}

/** A wall-clock time on a date in a time zone, as a UTC instant (daylight saving included). */
export function zonedTime(date: string, h: number, m: number, timeZone: string): Date {
  const [y, mo, d] = date.split("-").map(Number);
  const wanted = Date.UTC(y, mo - 1, d, h, m);
  const offset = (at: number) => {
    const p = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
        .formatToParts(new Date(at))
        .map((x) => [x.type, x.value]),
    );
    return Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute)) - at;
  };
  let at = wanted - offset(wanted);
  at = wanted - offset(at);
  return new Date(at);
}

/**
 * The moment a reminder goes (the developer, 11 Nov): two hours before the
 * time the item states, when it states one and starts that day, never before
 * 8:00 on the market's clock; otherwise 8:00 that morning.
 */
export function remindAt(item: Pick<FollowupItem, "starts_on" | "when_text">, remind: string, timeZone: string): Date {
  const start = item.starts_on === remind ? startTime(item.when_text) : null;
  const earliest = REMIND_EARLIEST.h * 60 + REMIND_EARLIEST.m;
  const minutes = start ? Math.max(earliest, start.h * 60 + start.m - REMIND_BEFORE_MINUTES) : earliest;
  return zonedTime(remind, Math.floor(minutes / 60), minutes % 60, timeZone);
}

/** The moment the feedback question goes: 10:00 on its day, on the market's clock. */
export function askAt(day: string, timeZone: string): Date {
  return zonedTime(day, ASK_AT.h, ASK_AT.m, timeZone);
}

/* GSM-7, as the digest's own text is (`plain` in lib/digest.ts, kept separate so this module imports nothing). */
const plain = (text: string) =>
  text
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\x20-\x7E\n]/g, "");

/** A moment as a parent reads it, on the market's clock: "Thu Dec 3 at 8:30am", "Sun Nov 22 at 3pm". */
export function sayMoment(at: Date, timeZone: string): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true })
      .formatToParts(at)
      .map((x) => [x.type, x.value]),
  );
  const minutes = p.minute === "00" ? "" : `:${p.minute}`;
  return `${p.weekday} ${p.month} ${p.day} at ${p.hour}${minutes}${String(p.dayPeriod).toLowerCase()}`;
}

/**
 * What one pick did (11 Nov, the developer: *"either the parent picks right
 * away which events to be reminded of, or the details are real details, not a
 * copy"* — then: a tap sets the reminder, the same tap again takes it off, and
 * whoever does not want one ignores it). No Yes/No step, no copy of the line.
 */
export type PickOutcome =
  /* `weekly`: it runs every week and the reminder is for its first date only, which the answer says (13 Nov). */
  /* `running`: already on, through `until` — said, with when the reminder is and why then (19 Nov, `runningUntil`). */
  | { n: number; title: string; state: "set" | "already_set"; at: Date; weekly?: boolean; running?: Running }
  | { n: number; title: string; state: "unset" | "no_day" | "too_late" | "reminded" };

/** An event already on when it was picked: its last day, and whether the reminder is on that day rather than next week. */
export interface Running {
  /** YYYY-MM-DD, the last day it runs. */
  until: string;
  lastDay: boolean;
}

/**
 * Whether an item is already on at its reminder, and through when (19 Nov). A
 * test digest's "Kidspace Winter Frolic — through Jan 10" was answered "I'll
 * text you Sat Nov 28" with no word of why, and the developer read the date as
 * a fault (*"чомусь підтягує 28 November … не дуже зрозуміло"*). `remindOn`
 * reminds a running event the Saturday after the digest, or on its last day if
 * that comes first; the answer now says which, and that it is on now.
 */
export function runningUntil(item: Pick<FollowupItem, "starts_on" | "ends_on">, remind: string): Running | undefined {
  if (!item.ends_on || item.starts_on === remind || (item.starts_on && item.starts_on > remind)) return undefined;
  return { until: item.ends_on, lastDay: item.ends_on === remind };
}

/** "2027-01-10" → "Jan 10": a day as a parent reads it. */
export function sayDay(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/** The answer to a pick (or several typed at once): each outcome in one line, GSM-7, under 1,600 characters. */
export function pickReplySms(outcomes: readonly PickOutcome[], timeZone: string): string {
  const one = (o: PickOutcome): string => {
    switch (o.state) {
      case "set":
        if (o.running) {
          const when = `${o.running.lastDay ? "on its last day" : "next week"}, ${sayMoment(o.at, timeZone)}`;
          return outcomes.length === 1
            ? `Got it - ${o.title} is on now through ${sayDay(o.running.until)}. I'll remind you ${when}, and ask how it went after. Pick ${o.n} again to undo.`
            : `${o.n}. ${o.title} - on now through ${sayDay(o.running.until)}; reminder ${when}.`;
        }
        return outcomes.length === 1
          ? `Got it - I'll text you ${sayMoment(o.at, timeZone)} about ${o.title}${o.weekly ? " (the first date only)" : ""}, and ask how it went after. Pick ${o.n} again to undo.`
          : `${o.n}. ${o.title} - reminder ${sayMoment(o.at, timeZone)}${o.weekly ? " (the first date only)" : ""}.`;
      case "already_set": {
        const on = o.running ? ` (on now through ${sayDay(o.running.until)})` : "";
        return outcomes.length === 1
          ? `Your reminder for ${o.title}${on} is already set for ${sayMoment(o.at, timeZone)}. Pick ${o.n} again to take it off.`
          : `${o.n}. ${o.title}${on} - reminder already set for ${sayMoment(o.at, timeZone)}.`;
      }
      case "unset":
        return `OK - no reminder for ${o.title}.`;
      case "no_day":
        return `${o.title} has no fixed day, so there's no reminder to set - the link in the digest has the details.`;
      case "too_late":
        return `${o.title} is today or already under way, so it's too late for a reminder - the link in the digest has the details.`;
      case "reminded":
        return `I've already reminded you about ${o.title}.`;
    }
  };
  const lines = outcomes.map(one);
  const set = outcomes.filter((o) => o.state === "set" || o.state === "already_set").length;
  if (outcomes.length > 1 && set > 0) lines.push(`I'll ask how ${set > 1 ? "each one" : "it"} went after. Pick a number again to undo.`);
  if (outcomes.length > 1 && set > 0) lines.unshift("Got it:");
  let text = plain(lines.join(outcomes.length > 1 ? "\n" : " "));
  if (text.length > 1600) text = text.slice(0, 1597) + "...";
  return text;
}

/**
 * The morning of the event. Who it is from and how to stop, as every text Pando sends unasked (13 Nov, a
 * parent-eyes review: a reminder weeks after the pick came from "Today: …" with DIGEST OFF as the only way out).
 */
export function reminderSms(item: FollowupItem): string {
  return plain(`Pando: today - ${item.title}, ${item.when_text}${item.place ? `, ${item.place}` : ""}. ${item.url}\n\nHave a great time! DIGEST OFF stops these, STOP stops all texts.`);
}

/** The day after: how was it — three buttons on RCS, the same three words by SMS, and how to stop (13 Nov). */
export function feedbackAskSms(item: Pick<FollowupItem, "title">): string {
  return plain(`Pando: how was ${item.title}? Reply LOVED IT, IT WAS OK or DIDN'T GO. STOP to opt out.`);
}

/** The card version: the buttons say the answers. */
export function feedbackAskCard(item: Pick<FollowupItem, "title">): string {
  return plain(`Pando: how was ${item.title}?`);
}

export const FEEDBACK_THANKS: Record<Feedback, string> = {
  loved: "So glad to hear it - thanks for telling me!",
  ok: "Thanks for telling me - it helps me pick better next time.",
  didnt_go: "No problem - thanks for letting me know.",
};

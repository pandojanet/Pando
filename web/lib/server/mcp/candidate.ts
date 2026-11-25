import "server-only";

import { hasContactDetail } from "@/lib/contact-details";
import { cleanUrl, isListingUrl, withoutAsides, type DigestItem } from "@/lib/digest";

/**
 * What an agent's event must be before it can become a digest candidate (20 Nov, the security review):
 * a candidate goes into parents' texts, so it gets the link and text rules the digest agent's own finds
 * get, plus the ones a hand-typed link needs. Checked when it is proposed and again when it is approved.
 *
 * - The link: http(s), parsed and cleaned as the digest stores links (`cleanUrl`), typed in plain ASCII
 *   (a look-alike letter would be stripped from the SMS line and send the parent to another host), no
 *   punycode host, no `user@host` trick, no query string longer than a page needs, at most 400
 *   characters like the agent's, and never a listing page (`isListingUrl`).
 * - The words: no phone number or email (`hasContactDetail`), no other link, no first-person aside in
 *   the summary (`withoutAsides`).
 */

export interface CandidateInput {
  kind: string;
  title: string;
  when_text: string;
  starts_on?: string | null;
  ends_on?: string | null;
  place?: string | null;
  age_min?: number | null;
  age_max?: number | null;
  summary: string;
  url: string;
  /** 25 Nov (drizzle/0081): the price, free tiers and discounts as the event's page states them, or "free". */
  price?: string | null;
  /** One sentence on what the place is, for a parent who has never heard of it. */
  about?: string | null;
  /** In high demand by its page — sells out, book early, draws crowds, a well-known annual event. */
  popular?: boolean | null;
  /** Why, in a few words from the page. */
  popular_why?: string | null;
}

const KINDS =["event", "camp", "class", "opportunity"] as const;
/** A calendar date that exists (review, 20 Nov: "2026-02-31" passed a shape check and failed the insert). */
export const realDay = (v: unknown): v is string =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
const LINK_IN_TEXT = /https?:\/\/|www\.|\b[a-z0-9-]+\.(com|org|net|gov|edu|io|us|info|co|ly|app|me|ai|la|ca|link|site|page|gl|biz|tv|fm|to|cc|xyz|club|events)\b/i;
/** Tracking parameters dropped before the link is judged and stored, as `urlKey` drops them. */
const TRACKING = /^(utm_[a-z]+|fbclid|gclid|mc_cid|mc_eid|_hs[a-z]+)$/i;
/** An ISO date or a range of them reads as a phone number to `hasContactDetail` (review round 2: "2026-12-05 - 2026-12-06"). */
const ISO_DATES = /\d{4}-\d{2}-\d{2}/g;

const text = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "").slice(0, max);
const age = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 18 ? v : null);

/** The candidate as it will be stored, or why it cannot be one. */
export function checkCandidate(raw: CandidateInput): { item: DigestItem } | { refused: string } {
  const kind = (KINDS as readonly string[]).includes(raw.kind) ? (raw.kind as DigestItem["kind"]) : null;
  if (!kind) return { refused: "kind must be event, camp, class or opportunity." };
  if (typeof raw.url !== "string" || /[^\x21-\x7e]/.test(raw.url)) return { refused: "The link must be typed in plain ASCII, as the page's address bar shows it." };
  const cleaned = cleanUrl(raw.url);
  if (!cleaned) return { refused: "The link must be an http(s) address." };
  const u = new URL(cleaned);
  /* "localhost." is localhost (review round 3): one trailing dot is dropped before the host rules. */
  if (u.hostname.endsWith(".")) u.hostname = u.hostname.slice(0, -1);
  for (const key of [...u.searchParams.keys()]) if (TRACKING.test(key)) u.searchParams.delete(key);
  const url = u.href;
  if (url.length > 400) return { refused: "The link must be at most 400 characters." };
  if (u.username || u.password) return { refused: "The link must not carry a user name (user@host)." };
  if (u.hostname.split(".").some((label) => label.startsWith("xn--"))) return { refused: "The link's host must be plain letters, not an international (punycode) name." };
  /* A public site's name: not an address in numbers, not a machine on a private network (review round 2). */
  if (!u.hostname.includes(".") || /^[\d.]+$/.test(u.hostname) || u.hostname.startsWith("[") || /(^|\.)(localhost|local|internal|lan)$/.test(u.hostname)) {
    return { refused: "The link must be a public site's name, not an address in numbers or a local machine." };
  }
  if (u.search.length > 120) return { refused: "The link carries a long query string; give the page's own address." };
  if (isListingUrl(url)) return { refused: "That is a listing or test page; give the event's own page." };

  const title = text(raw.title, 100);
  const whenText = text(raw.when_text, 60);
  const place = text(raw.place, 60) || null;
  const summary = withoutAsides(text(raw.summary, 180));
  if (title.length < 3 || whenText.length < 2 || summary.length < 10) return { refused: "The title, when and summary are each needed, in a few words." };
  for (const [field, value] of [["title", title], ["when_text", whenText], ["place", place ?? ""], ["summary", summary]] as const) {
    if (hasContactDetail(value.replace(ISO_DATES, ""))) return { refused: `The ${field} carries a phone number or email; parents get the page, not contact details.` };
    if (LINK_IN_TEXT.test(value)) return { refused: `The ${field} carries a link; the link goes in url only.` };
  }

  if ((raw.starts_on != null && !realDay(raw.starts_on)) || (raw.ends_on != null && !realDay(raw.ends_on))) return { refused: "A date is not a real calendar date (YYYY-MM-DD)." };
  const starts_on = realDay(raw.starts_on) ? raw.starts_on : null;
  const ends_on = realDay(raw.ends_on) ? raw.ends_on : null;
  if (kind === "event" && !starts_on && !ends_on) return { refused: "An event needs its date (starts_on or ends_on)." };
  if (starts_on && ends_on && starts_on > ends_on) return { refused: "starts_on is after ends_on." };
  const age_min = age(raw.age_min);
  const age_max = age(raw.age_max);
  if (age_min !== null && age_max !== null && age_min > age_max) return { refused: "age_min is above age_max." };

  /* The details a parent's pick opens (25 Nov): the same word rules as the rest, since they reach parents' texts. */
  const price = text(raw.price, 140) || null;
  const about = withoutAsides(text(raw.about, 160)) || null;
  const popular = raw.popular === true;
  const popularWhy = popular ? text(raw.popular_why, 80) || null : null;
  for (const [field, value] of [["price", price ?? ""], ["about", about ?? ""], ["popular_why", popularWhy ?? ""]] as const) {
    if (hasContactDetail(value.replace(ISO_DATES, ""))) return { refused: `The ${field} carries a phone number or email; parents get the page, not contact details.` };
    if (LINK_IN_TEXT.test(value)) return { refused: `The ${field} carries a link; the link goes in url only.` };
  }
  if (price && !/\$\s?\d|\bfree\b/i.test(price)) return { refused: "The price must be amounts as the page states them ($30, $80) or 'free' - leave it out when the page states none." };
  if (popular && !popularWhy) return { refused: "A popular event needs popular_why: what on its page says it is in high demand (sold out last year, book early)." };

  return {
    item: { kind, title, when_text: whenText, starts_on, ends_on, place, age_min, age_max, summary, url, price, about, popular, popular_why: popularWhy },
  };
}

/**
 * Words an agent proposes for a record a parent may be told about — a name, a venue, a subcategory
 * (review round 3): no phone number, email or link, the same rule as an event's words. Null when they
 * pass, else why not.
 */
export function plainWordsRefusal(fields: Record<string, string | null | undefined>): string | null {
  for (const [field, value] of Object.entries(fields)) {
    if (!value) continue;
    if (hasContactDetail(value.replace(ISO_DATES, ""))) return `The ${field} carries a phone number or email.`;
    if (LINK_IN_TEXT.test(value)) return `The ${field} carries a link; give the page as source_url.`;
  }
  return null;
}

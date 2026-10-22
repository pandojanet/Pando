/**
 * Deep Dive (21 Oct) — a structured report on one question: the options ranked,
 * why each fits this family, what parents near them say, how far each is.
 *
 * ## What the client asked for
 *
 * *"Give me the top 5 preschools in Pasadena tailored to my needs"* → a
 * mini-report: the child's age, location and budget from the profile, then the
 * options with reasoning, parent opinions and commute times, ranked with
 * justification. Any subject, not only schools. Same ask mechanics as a Network
 * Check, more information, a fixed structure. Two triggers, and a clear one so
 * it never feels like a charge nobody agreed to:
 *
 *  - **proactive** — Pando offers it at the end of an answer when the request
 *    has grown into a deep one, and the parent replies DEEP (or yes);
 *  - **explicit** — the parent writes "deep dive".
 *
 * Free during the pilot, and **Pando says upfront that it will be paid later**
 * — the client's goal is to measure how many people say yes, so every offer is
 * a row (`drizzle/0058`).
 *
 * ## What the developer decided (21 Oct)
 *
 * Over SMS, not a web page (RCS may make a richer format possible later); no
 * admin in the loop — the AI's report goes out; travel time **estimated from
 * distance**, never a routing API.
 *
 * ## How it stays honest without a reviewer
 *
 * The facts are code's and the words are the model's, and the two never mix:
 * names, the parents' evidence sentence, their quotes (verbatim), heads-ups,
 * prices, distances and the "Public/general information" heading are rendered
 * here from records, and so is a **templated reason** for every option
 * (`fitLine`) — the client's "~80% from a template". The model may replace that
 * reason with a better one, rank within each group, add one thing worth
 * checking and a bottom line, and every one of those passes `proseVerdict`,
 * which refuses a number, a name or a parent claim the records do not hold. A
 * refused sentence falls back to the template; a report the model cannot write
 * at all still goes out complete.
 *
 * Parent-backed options always come before public ones — the same rule an
 * ordinary answer keeps.
 *
 * ## More from the web, matched to ours (21 Oct, second pass)
 *
 * The developer, on the first version: *pull a lot of public information and
 * match it with ours, not just the top five from our base; maximally
 * structured; friendlier.* So the deep search returns up to ten places in
 * fields (ages, schedule, price, highlights), looks up the places parents
 * already told Pando about, and `withWebFacts` joins each finding to the record
 * of the same name. A block then carries both halves, each under its source:
 * the parents' evidence, words, heads-up and price, then a line opening
 * "Public/general information:" with what the page says. Five options in
 * detail, the rest named; an at-a-glance list; a checked opening and a
 * "My take" in a friend's voice; and INTRO for any option parents are behind.
 *
 * No runtime imports: `test:deep-dive` loads this module directly.
 */

/* ------------------------------------------------------------------ triggers */

/**
 * The explicit trigger: the parent said "deep dive". Only that — "a full
 * breakdown of costs" is not a request for a future-paid feature, so phrases
 * like it make Pando *offer* one instead (`deepDiveWorthOffering`).
 */
export function asksForDeepDive(text: string): boolean {
  return /\bdeep[\s-]?dive\b/i.test(text) && !/^\s*(what|what's|whats)\b.*\?\s*$/i.test(text);
}

/**
 * What the deep dive is about, from the message that asked for one — or null
 * when it names nothing ("I want a deep dive"), and the caller falls back to
 * the parent's last question or asks.
 */
export function deepDiveTopic(text: string): string | null {
  /* "deep dive on camps" names a topic in one word; "I want a deep dive" names none. */
  const named = /\bdeep[\s-]?dive\s*[:,-]?\s*(on|about|into|for|of|re)?\s+\S/i.test(text);
  const rest = text
    .replace(/\b(can|could|would)\s+(i|you)\s+(get|have|do|make)\s+(me\s+)?/gi, " ")
    .replace(/\b(i'?d like|i want|i would like|please|give me|send me|do|make|get)\b/gi, " ")
    .replace(/\b(a|an|the)?\s*deep[\s-]?dive\b/gi, " ")
    .replace(/^[\s,.:;!?-]*(on|about|into|for|of|re)\b/i, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(on|about|into|for|of)\s+/i, "")
    .replace(/[\s,.:;!?-]+$/, "")
    .replace(/^[\s,.:;!?-]+/, "");
  const words = rest.split(/\s+/).filter(Boolean).length;
  return words >= 2 || (named && words === 1 && rest.length >= 4) ? rest : null;
}

/**
 * Has this request grown into a deep one? The proactive trigger.
 *
 * Readable signals only: the parent asked to choose between options — "top 5",
 * "best", "compare", "which one", "help me decide", "a full breakdown" — or
 * already came back for more ("any others?").
 */
export function deepDiveWorthOffering(question: string, opts: { more?: boolean } = {}): boolean {
  if (opts.more) return true;
  return /\b(top\s+(\d+|three|four|five|ten)|best|compare|comparing|comparison|which\s+(one|is better|should)|vs\.?|versus|pros and cons|shortlist|short list|narrow (it |them )?down|help me (choose|decide|pick)|deciding between|choose between|options for|(full|detailed|in[\s-]?depth|proper)\s+(report|breakdown|comparison|rundown|write[\s-]?up))\b/i.test(
    question,
  );
}

/** The reply that accepts an offer: DEEP, "deep dive", "yes deep". */
export function acceptsDeepDive(text: string): boolean {
  return /^\s*(yes[,!.]?\s*)?(deep|deep[\s-]?dive|deep please|dd)\s*(please)?\s*[.!]*\s*$/i.test(text);
}

/** A bare yes, which accepts an open offer when nothing else Pando asked claimed it. */
export function plainYes(text: string): boolean {
  return /^\s*(yes|yeah|yep|yup|sure|ok|okay|please|yes please|sounds good|do it)\s*[.!]*\s*$/i.test(text);
}

/** A bare yes accepts within the offer's window; DEEP, the word it asked for, for a week. */
export const DEEP_DIVE_OFFER_HOURS = 48;
export const DEEP_DIVE_DEEP_WORD_DAYS = 7;
/** At most one proactive offer a week per parent: it is an offer, not a sales line. */
export const DEEP_DIVE_OFFER_GAP_DAYS = 7;
/** A topic asked for with "what should it be about?" is read for a day. */
export const DEEP_DIVE_TOPIC_HOURS = 24;
/** Stored on every offer, so wording can be compared later. */
export const DEEP_DIVE_OFFER_VERSION = "offer-2026-10-21b";

/* ---------------------------------------------------------------------- copy */

/*
 * Conversational copy, not registered A2P samples (`sms-templates.ts`), so it
 * can be reworded as the pilot learns. On the list for the client: the offer
 * and the start both say it is free now and paid later. GSM-7 throughout.
 */
/* One segment (150 chars) on top of an answer that may already use five (review, 21 Oct). */
export const DEEP_DIVE_OFFER =
  "Want a deep dive? I'll rank these for your family with what local parents said, what's online and rough drive times. Free now, paid later. Reply DEEP.";

export function deepDiveStarted(topic: string): string {
  /* The topic is not repeated: a whole question made this two segments and read badly mid-sentence. */
  void topic;
  return "On it! Your deep dive is on its way, give me a few minutes. Deep dives are free in the pilot and will be paid later.";
}

export const DEEP_DIVE_ASK_TOPIC =
  "Happy to. What should it be about? For example: preschools near us, or summer camps for July.";

export const DEEP_DIVE_FAILED =
  "Sorry, I couldn't build the deep dive this time, so here's my usual answer. You can ask for a deep dive again later.";

export const DEEP_DIVE_CANCELLED = "No problem, I've cancelled that deep dive.";

export const DEEP_DIVE_BUSY =
  "Your deep dive is still on its way. Ask for the next one once it lands.";

export const DEEP_DIVE_UNSUPPORTED =
  "Deep dives are for things like classes, camps, schools and outings, so I'll answer this one the usual way.";

/* ------------------------------------------------------------------- distance */

export interface LatLng {
  lat: number;
  lng: number;
}

/** Straight-line distance in km. */
export function haversineKm(a: LatLng, b: LatLng): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/**
 * Drive minutes, **estimated** from a straight line between two town centres.
 *
 * Roads are about a third longer than the crow flies, and suburban driving in
 * the San Gabriel Valley averages roughly 40 km/h door to door — so a minute is
 * about two-thirds of a straight kilometre, rounded up to the next five. A
 * guide for comparing options; the report's last line says these are rough
 * estimates, because a town centre is not an address.
 */
export function driveMinutes(km: number): number {
  const minutes = ((km * 1.35) / 40) * 60;
  return Math.max(5, Math.ceil(minutes / 5) * 5);
}

/** "your area" / "about 15 min" / null when either end is unknown. */
export function distancePhrase(km: number | null, theirs = true): string | null {
  if (km === null || !Number.isFinite(km)) return null;
  /* "Your area" only when Pando knows where they live; a place taken from the
     question is "close by" (review, 21 Oct). */
  if (km < 2) return theirs ? "your area" : "close by";
  return `about ${driveMinutes(km)} min`;
}

/* --------------------------------------------------------------- the profile */

/** What the family told Pando that a report should weigh. Ids from `questions.ts`. */
export interface DeepFamily {
  /** "4 and 7 year olds", "a baby on the way" — or null. */
  children: string | null;
  /** Their own area's name, or null. */
  home: string | null;
  /** False when `home` is the question's place, not where they live. */
  home_is_theirs?: boolean;
  travel_time: string | null;
  budget: string | null;
  logistics: string[];
}

const TRAVEL_MINUTES: Record<string, number | null> = {
  under_10_min: 10,
  under_20_min: 20,
  under_30_min: 30,
  over_30_for_fit: null,
};

const TRAVEL: Record<string, string> = {
  under_10_min: "within 10 min",
  under_20_min: "within 20 min",
  under_30_min: "within 30 min",
  over_30_for_fit: "happy to drive for the right fit",
};

/* Never "best": that word is refused in the model's sentences, and the model
   echoes the family's own phrases back. */
const BUDGET: Record<string, string> = {
  prioritize_low_cost: "free or low cost first",
  prioritize_value: "good value for the money",
  across_price_points: "a range of prices",
  prioritize_fit: "the right fit even if it costs more",
};

const LOGISTICS: Record<string, string> = {
  easy_parking: "easy parking",
  weekday_flexibility: "flexible weekdays",
  weekend_friendly: "weekends",
  working_parent_hours: "early drop-off or late pickup",
  sibling_friendly: "siblings together",
  stroller_friendly: "easy with a stroller",
  flexible_booking: "flexible booking",
  budget_friendly: "budget-friendly",
};

/** The family's preferences as phrases — what the report says it weighed. */
export function familyPreferences(f: DeepFamily): string[] {
  const out: string[] = [];
  if (f.travel_time && TRAVEL[f.travel_time]) out.push(TRAVEL[f.travel_time]);
  if (f.budget && BUDGET[f.budget]) out.push(BUDGET[f.budget]);
  for (const l of f.logistics) if (LOGISTICS[l]) out.push(LOGISTICS[l]);
  return out;
}

/** "4 and 7 year olds" from ages; -1 is a baby on the way. */
export function childrenPhrase(ages: number[]): string | null {
  const known = ages.filter((a) => a >= 0).sort((a, b) => a - b);
  const expecting = ages.some((a) => a < 0);
  const parts: string[] =
    known.length > 1 && !known.includes(0)
      ? [`${known.slice(0, -1).join(", ")} and ${known[known.length - 1]} year olds`]
      : known.map((a) => (a === 0 ? "a baby" : `a ${a} year old`));
  if (expecting) parts.push("a baby on the way");
  if (parts.length === 0) return null;
  return parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/* ------------------------------------------------------------ the fact sheet */

/** One option, as the records state it. Everything here is printed by code. */
export interface DeepOption {
  /** Stable within one report — "p1", "w3". */
  id: string;
  name: string;
  /** "class", "camp", "place", or a public finding's own words. */
  what: string;
  /** The area's display name, or null. */
  area: string | null;
  source: "parents" | "public";
  /** Parents with firsthand experience. 0 on a public finding. */
  firsthand: number;
  /** The contributor's first name where they turned it on (10 Sep). */
  named_by: string | null;
  /** "Sep 2026", or null. */
  last_confirmed: string | null;
  stale: boolean;
  /** A parent's own words, already GSM-7, never edited. */
  quote: string | null;
  caveat: string | null;
  who_for: string | null;
  tip: string | null;
  /** What parents paid: "about $100-200 a term" / "free" — no full stop. */
  price: string | null;
  /** What parents made of the price: "fair", "pricey but worth it". */
  worth: string | null;
  /** A public finding's stated fact (an ordinary search's one line). */
  detail: string | null;
  /**
   * What the open web says about it (21 Oct), in fields — on a public option
   * its whole description, on a parent option **the page's half beside the
   * parents' half**, printed under its own "Public/general information" line so
   * a page's fact can never read as something parents said (invariant 3).
   */
  web: WebFacts | null;
  km: number | null;
  /**
   * The composer's own caution, worded as it words it: a parent's recent
   * withdrawal ("may no longer be worth it"), an old or ageing record. Never
   * dropped from a deep dive, which has no reviewer to notice it missing.
   */
  warning: string | null;
  /** Parents who recently said it may no longer be worth it: ranks it down. */
  withdrawn: number;
  /** An admin marked it ready to answer with: ranks it up among equals. */
  answer_ready: boolean;
}

/** A deep search's fields for one place, already GSM-7. Null where no page said it. */
export interface WebFacts {
  what: string | null;
  ages: string | null;
  schedule: string | null;
  price: string | null;
  highlights: string[];
  /** The page's own description in a sentence or two — the writer's main material. */
  summary?: string | null;
  /** What its pages say on the things the question turns on (22 Oct). */
  answers?: string[];
  site: string | null;
}

/** What the writer returns, before `keepSentences` reads it. */
export interface DeepDraft {
  /** Two or three sentences under the header. */
  opening: string;
  /** The options it details, best first — as many as the question needs. */
  order: string[];
  /** Options worth naming without a block. */
  also: string[];
  /** A paragraph per detailed option, and one thing to check. */
  options: Array<{ id: string; text: string; watch: string }>;
  /** A head-to-head when the question compares; empty otherwise. */
  comparison: string;
  bottom_line: string;
}

/** A deep search's finding, as far as matching needs it (`public-info.ts` `DeepFinding`). */
export interface WebFinding {
  name: string;
  what: string;
  area: string | null;
  ages: string | null;
  schedule: string | null;
  price: string | null;
  highlights: string[];
  summary?: string | null;
  answers?: string[];
  site: string | null;
}

/**
 * The deep search matched to Pando's own records (21 Oct): *"pull a lot of
 * public information and match it with ours"*.
 *
 * A finding with the same name as a parents' record joins that record as its
 * web half — the parents say what it was like, the page says the ages, hours
 * and price — and is **never listed a second time** as a public option, so one
 * place cannot appear under two trust labels in one report. `same` is
 * `public-info.ts` `sameName`, the matcher the ordinary answer's exclusion
 * already uses (passed in: this module has no runtime imports). Every other
 * finding becomes a public option of its own. With no findings (the search
 * failed or is off) the options are returned as they were.
 */
/** A name's words as written: lower case, no marks, no legal suffix or leading "the". */
function nameWords(name: string): string[] {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .replace(/['’´]s\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((w) => w && !["the", "inc", "llc", "ltd", "co", "corp"].includes(w));
}

function areaKey(area: string | null): string | null {
  const k = area
    ? area
        .toLowerCase()
        .replace(/,?\s*(ca|california|usa|us)\.?$/, "")
        .replace(/[^a-z0-9]+/g, " ")
        .trim()
    : "";
  return k || null;
}

/**
 * Is this finding the very place this record is — strictly enough to print the
 * page's ages, hours and price under a parent's record? `sameName` is looser by
 * design ("school" and "academy" are stop words, everything after a dash goes),
 * which is right for suppressing a duplicate and wrong for joining facts:
 * "Pasadena Montessori School" is not "Pasadena Montessori Academy", and
 * "Kumon - Arcadia" is not "Kumon - Pasadena" (review M1).
 *
 * So: the record's words, as written, are a prefix of the finding's or the
 * other way round ("Little Gym" / "The Little Gym of Pasadena"), and where both
 * name a town, it is the same town.
 */
export function samePlace(f: { name: string; area: string | null }, o: { name: string; area: string | null }): boolean {
  const a = nameWords(f.name);
  const b = nameWords(o.name);
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (short.length === 0 || (short.length < 2 && short.length !== long.length)) return false;
  if (!short.every((w, i) => w === long[i])) return false;
  const fa = areaKey(f.area);
  const oa = areaKey(o.area);
  if (fa && oa && fa !== oa) return false;
  /* Extra words are a branch or a town, and a branch is only joined when both
     sides name the same town (review, 21 Oct: "The Little Gym of Arcadia" with
     no area joined the Pasadena record). Extra words that are the record's own
     town ("Sunny Days Preschool of Altadena") are fine. */
  const extra = long.slice(short.length).filter((w) => !["of", "in", "at"].includes(w));
  if (extra.length === 0) return true;
  const town = new Set((oa ?? "").split(" ").filter(Boolean));
  if (extra.every((w) => town.has(w))) return true;
  return Boolean(fa && oa && fa === oa);
}

export function withWebFacts(
  options: DeepOption[],
  findings: WebFinding[],
  opts: { same: (a: string, b: string) => boolean; area: (a: string | null) => string | null; max: number },
): DeepOption[] {
  if (findings.length === 0) return options;
  const facts = (f: WebFinding): WebFacts => ({
    what: f.what,
    ages: f.ages,
    schedule: f.schedule,
    price: f.price,
    highlights: f.highlights,
    summary: f.summary ?? null,
    answers: f.answers ?? [],
    site: f.site,
  });
  const used = new Set<number>();
  const parentOptions = options.filter((o) => o.source === "parents");
  /* What a page says in words, without a number in it: no price, ages or hours. */
  const wordy = (t: string | null | undefined) => (t && !/\d/.test(t) ? t : null);
  const strict = parentOptions.map((o) => {
    const i = findings.findIndex((f, j) => !used.has(j) && samePlace(f, o));
    if (i < 0) return o;
    used.add(i);
    return { ...o, web: facts(findings[i]) };
  });
  /* Every strict join first, so a loose one never takes the finding another record is the very branch of. */
  const parents = strict.map((o) => {
    if (o.web) return o;
    /**
     * The same name, another town (22 Oct run): "Pasadena Waldorf School" was
     * tagged Pasadena on its page and Altadena in the record, so the strict join
     * refused it and the loose one suppressed the finding — the parents' option
     * went out with no page facts at all. The strict rule exists because the
     * wrong branch's **price** under a parent's record is a false claim, so only
     * the words come across: what it is, its summary and its answers, each only
     * without a digit in it. Ages, hours, price, highlights and site stay null.
     * Names with extra words (a branch) never get here: `samePlace` without
     * areas still needs the record's words to be the finding's whole name.
     */
    const k = findings.findIndex((f, j) => !used.has(j) && samePlace({ name: f.name, area: null }, { name: o.name, area: null }));
    if (k < 0) return o;
    used.add(k);
    const f = findings[k];
    return {
      ...o,
      web: {
        what: wordy(f.what),
        ages: null,
        schedule: null,
        price: null,
        highlights: [],
        summary: wordy(f.summary),
        answers: (f.answers ?? []).filter((a) => !/\d/.test(a)),
        site: null,
      },
    };
  });
  /**
   * ⚠ Two thresholds, as in `named-person.ts`: **joining** a page's facts to a
   * parent's record needs the strict match (`samePlace`), because the wrong
   * branch's price under a parent's record is a false claim; **suppressing** a
   * finding needs only the loose one (`same`), because the cost of a miss there
   * is one place under two trust labels. So a finding that loosely matches any
   * parent record is never listed — "Rose Bowl Aquatics Swim Team" beside the
   * record "Rose Bowl Aquatics", or "Kumon - Arcadia" beside "Kumon - Pasadena"
   * (review M1, M2).
   */
  const publicOnes = findings
    .filter((f, j) => !used.has(j) && !parentOptions.some((o) => opts.same(f.name, o.name)))
    .map(
      (f, i): DeepOption => ({
        id: `w${i + 1}`,
        name: f.name,
        what: f.what,
        area: opts.area(f.area),
        source: "public",
        firsthand: 0,
        named_by: null,
        last_confirmed: null,
        stale: false,
        quote: null,
        caveat: null,
        who_for: null,
        tip: null,
        price: null,
        worth: null,
        detail: null,
        km: null,
        web: facts(f),
        warning: null,
        withdrawn: 0,
        answer_ready: false,
      }),
    );
  return [...parents, ...publicOnes].slice(0, opts.max);
}

/* ------------------------------------------------------------------ the shape */

/**
 * ⚠ **What shape the question needs is decided in code now, and it caps the
 * report** (22 Oct, the length review). The 22 Oct row gave the writer the
 * choice, and a live run of seven questions averaged 31 segments: an "X or Y"
 * detailed five places in 30 segments, an open preschool question nine places,
 * eight of them saying the pages were silent. The writer still writes and still
 * orders; code says how many places get a block and how much room there is.
 *
 *  - `top`     — "top 8 …", "give me 5 options": N blocks, short ones;
 *  - `compare` — "X or Y", "X vs Y", "compare X and Y", "which is better": the
 *                places the question names (two or three), and a side-by-side;
 *  - `single`  — "is X good / any good / worth it", "what about X": X first,
 *                at most two alternatives;
 *  - `open`    — everything else: five at most, and only places with something
 *                on what the question turns on, or a parent's record.
 */
export type DeepShapeKind = "top" | "compare" | "single" | "open";

export interface DeepShape {
  kind: DeepShapeKind;
  /** "top 8" → 8; null for the other kinds. */
  n: number | null;
  /** Places that get a block of their own, at most (`shapeOrder` clamps the writer's order). */
  detailed: number;
  /** The parts the writer is asked to fit in (`deepDiveRoom`)… */
  parts: number;
  /** …and the most `fitDeepDive` sends: the target plus one, so a long draft is trimmed, not cut. */
  maxParts: number;
  /** A paragraph's target, told to the writer… */
  paragraph: number;
  /** …and its hard cap in `keepSentences` (trailing sentences go first). */
  paragraphMax: number;
}

const NUMBER_WORDS: Record<string, number> = {
  two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
};
/* A count, never an age: "the best 2 year old classes" asks for no number of places. */
const COUNT = String.raw`(\d{1,2}|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b(?![\s-]*(?:years?|yrs?|y\.?o\b|months?|mos?\b|weeks?|days?|hours?|min))`;
const TOP_N = new RegExp(
  String.raw`\b(?:top|best)\s+${COUNT}|\b${COUNT}\s+(?:best|top)\b|\b${COUNT}\s+(?:options|places|choices|picks|ideas|suggestions)\b`,
  "i",
);
const VERSUS = /\b(vs\.?|versus)(?=\s)/i;
const COMPARING = /\bcompar(e|ing)\b[^?.!]*\b(and|with|to|vs)\b/i;
const WHICH_BETTER = /\bwhich\b[^?.!]*\b(better|should (we|i)|pick|choose|go with)\b/i;
/* "Kidspace camp or Camp Galileo": a capitalised word on each side, two plain words between at most. */
const BARE_OR = /\b([A-Z][\w'&-]*)(?:\s+[a-z][\w'-]*){0,2}\s+or\s+(?:the\s+)?([A-Z][\w'&-]*)/;
const SINGLE = [
  /\b[Ii]s\s+(?!there\b|it\b|this\b|that\b|he\b|she\b|my\b|our\b)(?:the\s+)?[A-Z][\w'&.-]*(?:\s+[\w'&.-]+){0,6}?\s+(any good|good|worth it|worth the|ok|okay|a good|the right|right for|suitable|safe|a fit)\b/,
  /\b[Aa]re\s+(?!there\b|they\b|these\b|those\b|we\b)(?:the\s+)?[A-Z][\w'&.-]*(?:\s+[\w'&.-]+){0,6}?\s+(any good|good|worth it|worth the|ok|okay|the right|right for|suitable|safe)\b/,
  /\b[Ww]hat about\s+(?:the\s+)?[A-Z]/,
  /\b[Tt]houghts on\s+(?:the\s+)?[A-Z]/,
  /\b[Hh]ow (?:good )?is\s+(?:the\s+)?[A-Z][\w'&.-]*\s+for\b/,
];
/* Capitalised words a question opens with, or uses, that name nothing. */
const NOT_A_NAME = new Set(
  "i is are what which who where when how can could should would do does any give show find tell top best my our we the a an hi hey please and or so summer winter spring fall autumn after weekend weekday need looking help good deep dive kids kid also just thanks".split(" "),
);

/** Capitalised words in the question that could be a place's name: not a town, a month or a question word. */
export function properWords(question: string, towns: readonly string[] = []): string[] {
  const townWords = new Set(towns.flatMap((t) => t.toLowerCase().split(/[^a-z]+/).filter(Boolean)));
  return (question.match(/[A-Za-z][A-Za-z'&-]*/g) ?? []).filter((w) => {
    const lower = w.toLowerCase().replace(/'s$/, "");
    return /^[A-Z]/.test(w) && !/^I('|$)/.test(w) && !NOT_A_NAME.has(lower) && !townWords.has(lower) && !CALENDAR.has(lower);
  });
}

export function deepDiveShape(question: string, opts: { towns?: readonly string[] } = {}): DeepShape {
  const q = plainText(question);
  const top = q.match(TOP_N);
  const raw = top ? (top[1] ?? top[2] ?? top[3]) : null;
  const n = raw ? (NUMBER_WORDS[raw.toLowerCase()] ?? Number(raw)) : null;
  if (n !== null && n >= 2) {
    const detailed = Math.min(n, DEEP_DIVE_MAX_DETAILED);
    return {
      kind: "top",
      n,
      detailed,
      /* ~350 for each place's own words, plus its name, watch and Pando's lines. */
      parts: Math.max(2, Math.min(DEEP_DIVE_MAX_PARTS, Math.ceil((detailed * 520 + 1000) / (DEEP_DIVE_PART_MAX - 8)))),
      maxParts: DEEP_DIVE_MAX_PARTS,
      paragraph: 330,
      paragraphMax: 420,
    };
  }
  const proper = properWords(q, opts.towns);
  const bare = q.match(BARE_OR);
  const bareOr = Boolean(bare && proper.includes(bare[1]) && proper.includes(bare[2]));
  if (proper.length > 0 && (VERSUS.test(q) || COMPARING.test(q) || (WHICH_BETTER.test(q) && /\bor\b/i.test(q)) || bareOr)) {
    return { kind: "compare", n: null, detailed: 3, parts: 2, maxParts: 3, paragraph: 380, paragraphMax: 520 };
  }
  if (SINGLE.some((re) => re.test(q)) && proper.length > 0) {
    return { kind: "single", n: null, detailed: 3, parts: 2, maxParts: 3, paragraph: 260, paragraphMax: 380 };
  }
  return { kind: "open", n: null, detailed: 5, parts: 3, maxParts: 4, paragraph: 260, paragraphMax: 380 };
}

/* Words in a place's name that say what it is, not which one it is. */
const GENERIC_NAME_WORDS = new Set(
  "school schools preschool preschools academy center centre centers camp camps museum children childrens child kids kid family families club clubs program programs programme class classes studio studios learning early development swim swimming pediatric paediatric dentistry dental dentist dentists aquatic aquatics after care daycare nursery montessori cooperative coop community city park parks recreation the and for with".split(" "),
);

/**
 * The words that pick one place out — "Kidspace" in "Kidspace Children's
 * Museum", "Galileo" in "Camp Galileo Pasadena" — as the name writes them.
 * The full name comes first. Generic words, towns and short words are not
 * aliases: "Camp" or "Pasadena" would name half the list.
 */
export function optionAliases(name: string, towns: readonly string[] = []): string[] {
  const townWords = new Set(towns.flatMap((t) => t.toLowerCase().split(/[^a-z]+/).filter(Boolean)));
  const words = (name.match(/[A-Za-z][A-Za-z'&-]*/g) ?? []).filter((w) => {
    const lower = w.toLowerCase().replace(/'s$/, "").replace(/'/g, "");
    return /^[A-Z]/.test(w) && w.length >= 4 && !GENERIC_NAME_WORDS.has(lower) && !townWords.has(lower);
  });
  return [name, ...new Set(words.map((w) => w.replace(/'s$/, "")))];
}

/**
 * The options the question names, in the order given — one per name it uses:
 * "Kidspace camp or Camp Galileo" names Kidspace and the first Galileo, not
 * both Galileo branches.
 */
export function namedInQuestion(question: string, options: Array<{ id: string; name: string }>, towns: readonly string[] = []): string[] {
  const asked = new Set(nameWords(question));
  const covered = new Set<string>();
  const out: string[] = [];
  for (const o of options) {
    const hits = optionAliases(o.name, towns)
      .slice(1)
      .map((w) => nameWords(w).join(" "))
      .filter((w) => w && asked.has(w));
    const fresh = hits.filter((w) => !covered.has(w));
    if (fresh.length === 0) continue;
    for (const w of hits) covered.add(w);
    out.push(o.id);
  }
  return out;
}

/** What Pando has to say under a place, or a page with something on the question: worth a block. */
function substantive(o: DeepOption): boolean {
  return o.source === "parents" || (o.web?.answers?.length ?? 0) > 0;
}

function hasPage(o: DeepOption): boolean {
  const w = o.web;
  return Boolean(w && (w.summary || w.ages || w.schedule || w.price));
}

/**
 * The parents' tie-break, in code (22 Oct, the length review). A live run put
 * Walden School — a parent's *"paired my shy son with a buddy"* under it — ninth
 * of nine for a shy 4 year old, below places whose pages said nothing.
 *
 * ⚠ The 22 Oct row took the parents' count away from the writer because, given
 * it, the writer explained its order with it and ranked records with no page
 * above places that plainly fit. So the writer is still not asked to prefer
 * parents' places. Code moves a clean parents' option **one place up**, only
 * past a public one the writer ranked **directly above it** whose pages said
 * nothing on what the question turns on (no `answers`), and **never into first
 * place** — the writer's first pick is what its bottom line names.
 */
export function parentTieBreak(order: string[], options: DeepOption[]): string[] {
  const byId = new Map(options.map((o) => [o.id, o]));
  const out = [...order];
  for (let i = 1; i + 1 < out.length; i++) {
    const above = byId.get(out[i]);
    const below = byId.get(out[i + 1]);
    if (!above || !below) continue;
    const thinPublic = above.source === "public" && (above.web?.answers?.length ?? 0) === 0;
    const cleanParents = below.source === "parents" && below.withdrawn === 0 && !below.stale && !below.warning;
    if (thinPublic && cleanParents) {
      [out[i], out[i + 1]] = [out[i + 1], out[i]];
      i++;
    }
  }
  return out;
}

/**
 * The writer's order, held to the question's shape (see `DeepShape`). Places it
 * ordered that lose their block are named in `also`, ahead of its own `also`.
 */
export function shapeOrder(
  draft: { order: string[]; also: string[] },
  options: DeepOption[],
  shape: DeepShape,
  named: string[],
): { order: string[]; also: string[] } {
  const byId = new Map(options.map((o) => [o.id, o]));
  const valid = parentTieBreak(
    draft.order.filter((id, i, all) => byId.has(id) && all.indexOf(id) === i),
    options,
  );
  let order: string[];
  if (shape.kind === "compare" && named.length >= 2) {
    order = [...valid.filter((id) => named.includes(id)), ...named.filter((id) => !valid.includes(id) && byId.has(id))].slice(0, 3);
  } else if (shape.kind === "single" && named.length >= 1 && byId.has(named[0])) {
    order = [named[0], ...valid.filter((id) => id !== named[0])].slice(0, shape.detailed);
  } else if (shape.kind === "open") {
    const keep = new Set(valid.filter((id) => substantive(byId.get(id)!)));
    /* Too few with anything on the question: the ones whose pages at least describe them, up to three. */
    for (const id of valid) {
      if (keep.size >= 3) break;
      if (hasPage(byId.get(id)!)) keep.add(id);
    }
    order = valid.filter((id) => keep.has(id)).slice(0, shape.detailed);
  } else {
    order = valid.slice(0, shape.detailed);
  }
  const also = [...valid, ...draft.also].filter((id, i, all) => byId.has(id) && !order.includes(id) && all.indexOf(id) === i);
  return { order, also };
}

/**
 * The kinds of line Pando prints under a place from its parents' records —
 * never their words, never how many (22 Oct). The writer, not told, wrote
 * "Price was not listed anywhere" above "Parents paid: about $100-200".
 */
export function pandoPrintsBelow(o: DeepOption): string[] {
  if (o.source !== "parents") return [];
  const kinds: Array<[unknown, string]> = [
    [o.quote, "a parent's words"],
    [o.who_for, "who it suits"],
    [o.caveat, "a heads-up"],
    [o.tip, "a tip"],
    [o.price, "what parents paid"],
    [o.worth, "value for money"],
    [o.warning, "a caution"],
  ];
  return kinds.filter(([v]) => Boolean(v)).map(([, k]) => k);
}

/* ------------------------------------------------------------------ checking */

/** Straight quotes and hyphens for the typography a model writes. */
export function plainText(text: string): string {
  return text
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—−]/g, "-")
    .replace(/…/g, "...")
    .replace(/ /g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const LINK = /(https?:|www\.|\.com\b|\.org\b|@|\b\d{3}[\s.-]?\d{3}[\s.-]?\d{4}\b)/i;

/** Whole words and numbers, lower-cased: what "the facts hold it" means. */
export function tokensOf(text: string): Set<string> {
  return new Set(
    (plainText(text).toLowerCase().match(/[a-z][a-z'-]*|\d+(?:[.,]\d+)?/g) ?? []).map((t) => t.replace(/'s$/, "")),
  );
}

const CALENDAR = new Set(
  "january february march april may june july august september october november december jan feb mar apr jun jul aug sep sept oct nov dec monday tuesday wednesday thursday friday saturday sunday mon tue tues wed thu thurs fri sat sun".split(" "),
);

/** Why a sentence was refused — counted, and told to the model on its one retry. */
export type ProseRefusal =
  | "not_text"
  | "length"
  | "link"
  | "quotation"
  | "claim"
  | "first_person"
  | "hearsay"
  | "characters"
  | "number"
  | "name";

const REFUSAL_HINT: Record<ProseRefusal, string> = {
  not_text: "it was not text",
  length: "it was too short or too long",
  link: "it had a link, email or phone number",
  quotation: "it used quotation marks",
  claim: "it vouched for the place or reported what others think (popular, well-regarded, the best, loved, parents say, kids enjoy)",
  first_person: "it spoke as someone who went there",
  hearsay: "it reported what others say or find (I'm told, others say, kids enjoy)",
  characters: "it used a character outside plain text",
  number: "it used a number that is not in that option's own facts, its drive estimate or the family's own details",
  name: "it named a person, or a place or word that none of the options' facts contain",
};

export function refusalHint(r: ProseRefusal): string {
  return REFUSAL_HINT[r];
}

/**
 * The minutes a sentence about this option may state: its drive estimate and
 * the family's own travel limit.
 */
export function minutesFor(o: { km: number | null }, family: DeepFamily): number[] {
  const out: number[] = [];
  if (o.km !== null) out.push(driveMinutes(o.km));
  const limit = family.travel_time ? TRAVEL_MINUTES[family.travel_time] : null;
  if (typeof limit === "number") out.push(limit);
  return out;
}

/* ------------------------------------------------- the agentic report's check */

/**
 * Praise, ratings and other people's experience (22 Oct, the agentic report).
 *
 * Narrower than `CLAIMS`, and deliberately: that list refused the word
 * "parent" anywhere, so "Parent & Me" and "parent viewing areas" — a class's
 * own name, from its own page — cost four of five reasons on a swim report.
 * What is refused here is the thing invariant 3 is about: somebody vouching,
 * rating or enjoying, said in Pando's voice. Who uses a place is printed by
 * code under it, from the records, and never by the writer.
 */
const VOUCHING =
  /\b(recommend\w*|vouch\w*|voted|testimonials?|praised|glowing|feedback|adored?|widely|reviews?|reviewed|reviewers?|rave[sd]?|raving|swear|favou?rites?|beloved|popular|famous|renowned|award\w*|perfect|amazing|excellent|outstanding|incredible|top[\s-]rated|highly|rated|ratings?|stars?|reputation|trusted|go[\s-]to|a hit|known for|locals|neighbou?rs|everyone|community favou?rite)\b|\bsolid\b(?!\s+(?:foods?|ground|surfaces?|walls?|colou?rs?|state|shapes?|objects?|wood)\b)|\bthe best\b(?![\s-]?(fit|match))|\bbest[\s-](rated|known|loved|reviewed|in)\b|\bwell[\s-](regarded|liked|loved|known|reviewed)\b|(?<!\bwho\s)\blov(e|es|ed)\b|\b(parents?|families|moms?|dads?|kids|children|people|others|customers|students)\s+(say|said|says|adore|swear|praise|rave|recommend|tell|told|enjoy|enjoyed|liked|love|loved|call|think|agree|like\s+(it|this|that|the|its|their|how))\b|\b(local|nearby|other)\s+(parents?|families|moms|dads)\b|\bparents?\s+(near|nearby|around|in your|from your)\b|\b(has|have|had)\s+used\s+it\b|\bparent history\b|\b(local|parent)\s+(use|history|backing|following)\b|\bused by (a |one |more )?parents?\b/i;

/*
 * "Solid" is mild praise in Pando's voice ("a solid care option", "a solid
 * second look", 22 Oct run) — refused, except as a plain word for a thing
 * ("solid foods" in a baby class, "solid wood"). Names are taken out first, so
 * a place called "Solid Rock Gym" is still named.
 */

/**
 * The writer is never to speak about who has used a place, even accurately
 * (22 Oct run: "Two parents near you have used it", "given the 3 parents near
 * you"). The count is printed by code from the records, under the place, in the
 * client's wording; said again in the writer's voice it is a parent claim with
 * no label on it, and a number the writer was only given to rank with.
 * The last clauses of `VOUCHING` refuse exactly that.
 */

/**
 * Pando speaking as somebody who went — invariant 3's spirit. "I'd start with
 * the closest one" is advice (21 Oct, the friendlier voice), and "I have no
 * hours for it" or "that is all I have" reports what the search found (22 Oct
 * run, three sentences refused by the first version of this rule); "I've
 * been", "we went", "my kids" are experience nobody at Pando had.
 */
const REPORT_FIRST_PERSON =
  /\b(i|we)\s*('ve|\s+have)\s+(been|tried|taken|visited|used|gone|loved|enjoyed|seen it)\b|\b(i|we)\s+(went|tried|took|love\w*|visited)\b|\b(my|our)\s+(kid|kids|son|sons|daughter|daughters|child|children|family|little one|little ones|toddler|toddlers|baby|boy|girl|twins|oldest|youngest)\b|\bwe\s+(were|did|signed|go|went|had|got|used)\b|\bwhen we\b|\b(go|went|come|came|going)\s+back\b|\blast\s+(spring|summer|fall|autumn|winter|year)\b(?!\s+of)/i;

/**
 * Hearsay — somebody's experience reported by the writer ("I'm told", "others
 * say", "kids enjoy it"). The records say what parents found; the writer never
 * does (adversarial review, 21 Oct). "Than the others" compares options and is
 * not hearsay (22 Oct run).
 */
/**
 * Somebody's experience of the place, with words between the subject and the
 * verb — "Families keep returning", "Parents consistently say", "Kids
 * absolutely adore the hygienists" all passed `REPORT_HEARSAY` (safety review,
 * 22 Oct). ⚠ The same pattern as `TESTIMONY` in `lib/public-info.ts`, copied
 * because neither module may import; `test:deep-dive` pins the two identical.
 */
export const REPORT_TESTIMONY =
  /\b(parents?|families|moms?|mothers|dads?|fathers|locals?|people|kids|children|toddlers|little ones|students|campers|swimmers|everyone|everybody|clients|customers|patients|members|visitors|others)\b,?\s+(?:(?!(?:who|that|which|whose)\b)[a-z']+\s+){0,2}?(say|said|says|adore\w*|swear\w*|agree\w*|call|calls|think|thinks|enjoy\w*|prais\w*|tell|tells|told|appreciat\w*|describ\w*|report\w*|rave\w*|lov(?:e|es|ed|ing)|rate[sd]?|recommend\w*|feel|feels|felt|find|finds|found|look forward|keep (?:returning|coming)|can'?t stop|cannot stop|thank\w*|trust\w*|vouch\w*|like it|like the|liked)\b/i;

const REPORT_HEARSAY =
  /\bi('m|\s+am)?\s+(told|hear|heard|understand)\b|\b(others|everyone|everybody|they)\s+(say|said|says|find|found|think)\b|\b(kids|children|toddlers|students|little ones)\s+(enjoy|enjoyed|seem|seemed|tend to|tended to|find|found|loved?)\b|\b(apparently|reportedly|supposedly|rumou?r\w*|word is)\b/i;

/**
 * One sentence of the agentic report, or why not.
 *
 * Kept from `proseVerdict`: no link or phone, no quotation, no vouching, no
 * first-hand experience or hearsay, plain GSM-7 text, and no number the facts
 * do not hold. Dropped from it, each for a measured false refusal (22 Oct):
 * the quantity words ("no drive at all"), and a capital at the start of a
 * sentence ("Drive times...", "Nothing listed..."). A capital mid-sentence
 * must still be a word the report's own facts carry, so the writer may compare
 * with the other options by name and may not bring in a place or a person
 * nobody gave it; an opening capital is asked of `isPerson` instead.
 */
export function reportSentence(
  sentence: string,
  allowed: {
    /** Everything the report may name: every option, the family, the question. */
    text: string;
    /** The numbers this sentence may use. */
    numbers: string;
    /** Minutes it may state: the drive estimate and the family's own limit. */
    minutes?: number[];
    /** The prices it may state, when narrower than `numbers`. */
    prices?: string;
    isPerson?: (words: string) => boolean;
    /**
     * The options' own names, taken out before the vouching and first-person
     * tests: "Little Stars" and "Our Kids Montessori" are names, not Pando
     * rating a place or speaking as a parent.
     */
    names?: string[];
    /**
     * Per option, for a sentence that may name several (22 Oct, safety review,
     * proved): the opening, side-by-side and bottom line pooled every option's
     * prices, so "Bright Teeth Pediatric Dentistry charges $95 for the first
     * visit" was kept on the strength of another practice's page. With this, a
     * "$" amount must be on the page of the option named nearest before it (or,
     * with none before, one named after it; with none named, `self`'s; else it is
     * refused), and so must any other number in a sentence that names an option.
     * `names` are `optionAliases`.
     */
    byOption?: Array<{ names: string[]; prices: string; numbers: string }>;
    /** The option a paragraph is about: the owner of a number no name comes before. */
    self?: number;
    /** Numbers any sentence may use whatever it names: the child's age, the drive minutes, the year. */
    common?: string;
  },
): { text: string } | { refused: ProseRefusal } {
  const text = plainText(sentence);
  if (text.length < 4 || text.length > 360) return { refused: "length" };
  if (LINK.test(text)) return { refused: "link" };
  if (text.includes('"')) return { refused: "quotation" };
  let bare = text;
  for (const n of allowed.names ?? []) {
    if (n.trim().length >= 3) bare = bare.split(n).join(" ");
  }
  if (VOUCHING.test(bare)) return { refused: "claim" };
  if (REPORT_FIRST_PERSON.test(bare)) return { refused: "first_person" };
  if (REPORT_HEARSAY.test(bare) || REPORT_TESTIMONY.test(bare)) return { refused: "hearsay" };
  /* A title before a name is a person whatever the facts hold: "Dr. Kim sees
     every child" was kept once a page put "Kim" in them (safety review, 22 Oct). */
  if (/\b(Dr|Doctor|Mr|Mrs|Ms|Miss|Coach|Nurse)\.?\s+[A-Z]/.test(bare)) return { refused: "name" };
  /* GSM-7 in one slot each: plain ASCII and the accented letters GSM carries
     ("La Cañada", 22 Oct run — a page's own town cost two paragraphs). */
  if ([...text].some((c) => !/[\x20-\x7E]/.test(c) && !GSM_LETTERS.includes(c)) || /[`[\]{}|^~\\]/.test(text)) return { refused: "characters" };
  const byOption = allowed.byOption;
  const mentions = byOption ? mentionsIn(text, byOption) : [];
  /* Whose facts a number at `at` must come from: the option named nearest before it, else `self`, else any named after. */
  const ownersAt = (at: number): number[] | null => {
    const before = mentions.filter((m) => m.at < at);
    if (before.length) {
      const last = Math.max(...before.map((m) => m.at));
      return [...new Set(before.filter((m) => m.at === last).map((m) => m.idx))];
    }
    if (allowed.self !== undefined) return [allowed.self];
    return mentions.length ? [...new Set(mentions.map((m) => m.idx))] : null;
  };
  /* Thousands commas only: "$470 to $540, the lowest" read "540," and was refused (review, 22 Oct). */
  const DOLLARS = /\$\s?(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)/g;
  if (byOption) {
    for (const m of text.matchAll(DOLLARS)) {
      const owners = ownersAt(m.index ?? 0);
      if (!owners) return { refused: "number" };
      const priced = owners.map((i) => plainText(byOption[i]?.prices ?? "").replace(/\s+/g, "")).join(" ");
      if (!priced.includes("$" + m[1])) return { refused: "number" };
    }
  } else if (allowed.prices !== undefined) {
    const priced = plainText(allowed.prices).replace(/\s+/g, "");
    for (const m of text.matchAll(DOLLARS)) {
      if (!priced.includes("$" + m[1])) return { refused: "number" };
    }
  }
  /* Minutes of driving only: "20-minute lessons" is a page's fact, checked
     with the other numbers below (22 Oct run). */
  if (allowed.minutes) {
    for (const m of text.matchAll(/(\d+)\s*(?:-|to)?\s*(\d+)?[\s-]*(min|mins|minutes|minute)\b(?=[^.;]{0,24}\b(away|drive|driving|by car|from (you|home|your)|of (you|home)|limit)\b)/gi)) {
      for (const n of [m[1], m[2]].filter(Boolean)) {
        if (!allowed.minutes.includes(Number(n))) return { refused: "number" };
      }
    }
  }
  const numbers = tokensOf(allowed.numbers);
  const common = tokensOf(allowed.common ?? "");
  for (const m of text.matchAll(/\d+(?:[.,]\d+)?/g)) {
    const digits = m[0];
    /* A sentence that names an option (or a paragraph about one) draws on that option's facts only. */
    const owners = byOption && (mentions.length > 0 || allowed.self !== undefined) ? ownersAt(m.index ?? 0) : null;
    if (owners) {
      if (common.has(digits)) continue;
      if (!owners.some((i) => tokensOf(byOption?.[i]?.numbers ?? "").has(digits))) return { refused: "number" };
      continue;
    }
    if (!numbers.has(digits)) return { refused: "number" };
  }
  const source = tokensOf(allowed.text);
  const words = text.match(/[A-Za-z][A-Za-z'-]*/g) ?? [];
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    if (!/^[A-Z]/.test(word)) continue;
    if (/^I('d|'m|'ll)?$/.test(word) || word === "Pando") continue;
    const lower = word.toLowerCase().replace(/'s$/, "");
    /* A plural of a word the facts hold: "National Parks" beside "park" (22 Oct run). */
    const singular = lower.replace(/(?<=[a-z]{3})s$/, "");
    if (source.has(lower) || source.has(singular) || CALENDAR.has(lower)) continue;
    if (i === 0) {
      /* "Call Legacy first": a verb before a name the report holds is not a
         person (22 Oct run). Asked only when the next word is unknown too. */
      const nextWord = words[1] ?? "";
      const next = nextWord.toLowerCase().replace(/'s$/, "");
      /* Only two capitalised words can be a name: "So I can't say", "Then I'd
         call", "But I found" were each refused as a person (Deep Dive review,
         22 Oct — one was the verdict of an "is X good" report). */
      const nameShaped = /^[A-Z]/.test(nextWord) && !/^I('d|'m|'ll|'ve)?$/.test(nextWord);
      if (nameShaped && !source.has(next) && allowed.isPerson?.(words.slice(0, 2).join(" "))) return { refused: "name" };
      continue;
    }
    return { refused: "name" };
  }
  return { text };
}

/** Where each option is named in a sentence, by any of its aliases, as a whole word. */
function mentionsIn(text: string, byOption: Array<{ names: string[] }>): Array<{ at: number; idx: number }> {
  const out: Array<{ at: number; idx: number }> = [];
  byOption.forEach((o, idx) => {
    for (const alias of o.names) {
      const a = plainText(alias);
      if (a.length < 3) continue;
      const re = new RegExp(`(?<![A-Za-z])${a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z])`, "g");
      for (const m of text.matchAll(re)) out.push({ at: m.index ?? 0, idx });
    }
  });
  return out;
}

/**
 * A paragraph the writer produced, sentence by sentence: what passes is kept,
 * what does not is dropped on its own (22 Oct). Before this a single refused
 * clause cost the whole reason and the option fell back to "It's in your
 * area." — a paragraph that loses one sentence of four is still a paragraph.
 * Trailing sentences go first when the kept text runs past `max`.
 */
export function keepSentences(
  raw: unknown,
  allowed: Parameters<typeof reportSentence>[1] & { max: number },
): { text: string | null; dropped: ProseRefusal[] } {
  if (typeof raw !== "string" || raw.trim() === "") return { text: null, dropped: [] };
  /* Never after an abbreviation or an initial: "Jr. Vets at Pasadena Humane"
     went out as "Vets at Pasadena Humane" (22 Oct run) — "Jr." was read as a
     sentence of its own and dropped. Only words that come before a name: a
     sentence ending "9 a.m." or "Inc." is common, and merged with the next one
     its capital reads as an unknown name and the pair is refused. */
  const sentences = plainText(raw)
    /* A stray "}" off the JSON cost a bottom line as "characters" (review, 22 Oct). */
    .replace(/[}\]]+\s*$/, "")
    .split(/(?<!\b(?:Jr|Sr|St|Mt|Ft|Dr|Mr|Mrs|Ms|vs|[A-Z])\.)(?<=[.!?])\s+(?=[A-Z0-9$])/)
    .map((s) => s.trim())
    .filter(Boolean);
  const kept: string[] = [];
  const dropped: ProseRefusal[] = [];
  for (const s of sentences) {
    const v = reportSentence(s, allowed);
    if ("text" in v) kept.push(/[.!?]$/.test(v.text) ? v.text : `${v.text}.`);
    else dropped.push(v.refused);
  }
  while (kept.length > 1 && kept.join(" ").length > allowed.max) kept.pop();
  const text = kept.join(" ");
  return { text: text && text.length <= allowed.max ? text : null, dropped };
}

/**
 * What a place's own pages say, as plain sentences — the paragraph an option
 * gets when the writer's was dropped whole or never came. Every word is a
 * field the search returned, so it is always honest, and it is never the old
 * "It's in your area." with nothing behind it.
 */
export function factsParagraph(o: DeepOption): string | null {
  const w = o.web;
  const out: string[] = [];
  if (w?.summary) out.push(stop(w.summary));
  else {
    const what = w?.what ?? (o.source === "public" ? o.what : null);
    if (what) out.push(stop(capitalise(stripStop(what))));
  }
  /* What the question turns on comes before the fixed fields (22 Oct). */
  for (const a of (w?.answers ?? []).slice(0, 2)) out.push(stop(capitalise(stripStop(a))));
  if (w?.ages) out.push(stop(/^\d/.test(w.ages.trim()) ? `Ages ${stripStop(w.ages)}` : capitalise(stripStop(w.ages))));
  if (w?.schedule) out.push(stop(capitalise(stripStop(w.schedule))));
  if (w?.price) out.push(stop(capitalise(stripStop(w.price))));
  if (!w && o.source === "public" && o.detail) out.push(stop(capitalise(stripStop(o.detail))));
  return out.length ? out.join(" ") : null;
}

/** "Check whether..." → "whether..."; a watch reads as the end of "Worth checking:". */
export function watchPhrase(text: string): string {
  const t = text
    .trim()
    .replace(/^(check|ask|confirm|see|find out|make sure)\s+(about\s+)?/i, "")
    .replace(/[.!?]+$/, "");
  /* Lower-case only an ordinary opening word: "Spanish immersion days" keeps its capital. */
  const first = t.split(/\s+/)[0] ?? "";
  return /^(whether|if|the|how|what|when|which|who|that|there|their|its|it|is|are|a|an|any|your|you)$/i.test(first)
    ? t.charAt(0).toLowerCase() + t.slice(1)
    : t;
}

/* ------------------------------------------------------------------ rendering */

/**
 * What parents paid, in the composer's wording (`answer.ts`), without its full
 * stop. A record that already says "about" is not said twice — "One parent
 * paid: about about $500 a week" went out on the 22 Oct run.
 */
export function pricePhrase(price: string | null | undefined): string | null {
  if (!price || !price.trim()) return null;
  return /^\s*(over|under|free|about|around|roughly|approx\w*|~)(?=\W|$)/i.test(price) ? price.trim() : `about ${price.trim()}`;
}

/** The parents' evidence, in the client's 9 Sep wording (`answer.ts`). */
export function evidenceLine(o: DeepOption): string {
  const who =
    o.named_by && o.firsthand === 1
      ? `${o.named_by} has used it`
      : o.firsthand === 1
        ? "One parent near you has used it"
        : `${o.firsthand} parents near you have used it`;
  const when = o.last_confirmed ? `, last confirmed ${o.last_confirmed}` : "";
  return `${who}${when}.`;
}

/**
 * The templated reason — what a deep dive says about fit with no model at all,
 * from the family's own taps and the option's own facts. Never empty-handed
 * where there is a fact to tie: the drive against their limit, who parents
 * said it suits, what a public page lists.
 */
export function fitLine(o: DeepOption, family: DeepFamily): string | null {
  const parts: string[] = [];
  const limit = family.travel_time ? TRAVEL_MINUTES[family.travel_time] : undefined;
  if (o.km !== null) {
    if (o.km < 2) parts.push(family.home && family.home_is_theirs !== false ? `it's in your area` : "it's close by");
    else {
      const m = driveMinutes(o.km);
      parts.push(
        typeof limit === "number"
          ? m <= limit
            ? `about ${m} min away, within your ${limit}-minute limit`
            : `about ${m} min away, a bit past your ${limit}-minute limit`
          : `about ${m} min away`,
      );
    }
  }
  /* Who it suits is printed as "Good for:" in the block already, so it is not
     said again here (review, 21 Oct). */
  if (parts.length === 0) return null;
  return `${capitalise(parts.join(", and "))}.`;
}

export interface RenderInput {
  question: string;
  family: DeepFamily;
  /** Every option weighed — the report details what the question asks for and names the rest. */
  options: DeepOption[];
  /** The writer's draft after `keepSentences`, or null to render from the pages' facts alone. */
  draft: {
    opening?: string | null;
    /** The options to give a block of their own, in order — as many as the question needs. */
    order: string[];
    /** Options to name in one line and no more; absent means "the rest". */
    also?: string[];
    text: Record<string, string>;
    watch: Record<string, string>;
    /** A head-to-head, when the question compares (printed as "Side by side:"). */
    comparison?: string | null;
    bottom_line: string | null;
    /** The most parts the question's shape sends (`DeepShape.maxParts`); `fitDeepDive` holds to it. */
    max_parts?: number;
  } | null;
  /** End with the Network Ask offer (reply YES) when the parents' side is thin. */
  offerAsk: boolean;
  /**
   * Print each place's website (`DEEP_DIVE_SITES=1`). Off by default: a link to
   * a third party's domain in an A2P message is something carriers filter on,
   * and how the campaign is registered for links is not in this repo.
   */
  sites?: boolean;
  /** How many options get a block of their own; the rest are named. `fitDeepDive` lowers it to fit. */
  detailed?: number;
  /**
   * Parent options a parent can be asked about (agreed to follow-ups, not opted
   * out). The INTRO line names the first of them, and is left out when there is
   * none; undefined means "not checked" and offers it on the first parent
   * option, as before (review, 21 Oct).
   */
  introducible?: string[];
}

/**
 * ⚠ **How many places get a block is the question's, not a constant** (22 Oct).
 * The developer: *five was an example — a parent may ask for more, and the
 * kind of comparison differs; that is why the model is getting better.* So the
 * writer chooses: two places and a side-by-side for "X or Y?", ten shorter
 * entries for "top 10", one place and its alternatives for "is X good for
 * us?". Five is only what a report with no writer details.
 */
export const DEEP_DIVE_MAX_OPTIONS = 5;
/** The most the writer may detail: "top 10" asks for ten, and two more leave room. */
export const DEEP_DIVE_MAX_DETAILED = 12;
/** Options named without a block, in one line, this many at most. */
export const DEEP_DIVE_MAX_EXTRAS = 7;
/**
 * Parts of at most `DEEP_DIVE_PART_MAX` characters. Six is about 9,000
 * characters — a "top 10" at its fullest; a two-place comparison is one or two.
 * The writer is told the room (`deepDiveRoom`) and sizes its paragraphs to it.
 */
export const DEEP_DIVE_MAX_PARTS = 6;

/**
 * The characters the writer has for its own words — opening, paragraphs,
 * watches, side-by-side and bottom line — once the header, the footer and every
 * line Pando prints from its records are counted. Each option says what its
 * records will add (`pandoLines`), so detailing a place parents know costs what
 * it really costs.
 */
export function deepDiveRoom(shape?: Pick<DeepShape, "parts">): number {
  return (shape?.parts ?? DEEP_DIVE_MAX_PARTS) * (DEEP_DIVE_PART_MAX - 8) - 900;
}

/** The characters Pando's own lines take under one option — what detailing it costs before the writer writes a word. */
export function pandoLines(o: DeepOption): number {
  if (o.source !== "parents") return 0;
  const lines = [evidenceLine(o), o.warning, o.quote ? `A parent said: "${o.quote}"` : null, o.who_for, o.caveat, o.tip, o.price, o.worth];
  return lines.filter(Boolean).reduce((n, l) => n + String(l).length + 14, 0);
}

/** How many options get a block: the writer's own list, else the default five. */
export function detailCount(input: Pick<RenderInput, "options" | "draft">): number {
  if (!input.draft) return Math.min(DEEP_DIVE_MAX_OPTIONS, input.options.length);
  const ids = new Set(input.options.map((o) => o.id));
  const chosen = new Set(input.draft.order.filter((id) => ids.has(id)));
  return chosen.size === 0 ? Math.min(DEEP_DIVE_MAX_OPTIONS, input.options.length) : Math.min(chosen.size, DEEP_DIVE_MAX_DETAILED);
}

/**
 * The options named in one line: any the fit had to take a block from first,
 * then the writer's `also` (none, when it gave an empty list — a two-place
 * comparison names nothing else), else everything past the blocks. Never one
 * with a caution to carry — a record a parent recently withdrew, or an old one,
 * is left out rather than listed bare (review L1).
 *
 * ⚠ **A clean parents' record without a block is always named** (22 Oct run:
 * on a "top 8" the writer left Pasadena Conservatory of Music out of `order`
 * and `also`, and a parent's record vanished from the report). It goes in
 * "Also used by parents near you", and parents' records come before public
 * ones so the line's cap never drops them.
 */
function extrasFor(input: RenderInput, ranked: DeepOption[], detailed: number): DeepOption[] {
  const wanted = detailCount(input);
  const shown = ranked.slice(0, detailed);
  const squeezed = ranked.slice(detailed, wanted);
  const byId = new Map(input.options.map((o) => [o.id, o]));
  const rest = input.draft?.also
    ? input.draft.also.map((id) => byId.get(id)).filter((o): o is DeepOption => o !== undefined)
    : ranked.slice(wanted);
  const parents = ranked.filter((o) => o.source === "parents");
  const out: DeepOption[] = [];
  for (const o of [...squeezed, ...rest, ...parents]) {
    if (shown.includes(o) || out.includes(o) || o.warning || o.stale) continue;
    out.push(o);
  }
  return [...out.filter((o) => o.source === "parents"), ...out.filter((o) => o.source !== "parents")].slice(0, DEEP_DIVE_MAX_EXTRAS);
}

/** The options in report order: the writer's, with a cautioned record never ahead of a clean one. */
export function reportOrder(options: DeepOption[], modelOrder: string[]): DeepOption[] {
  return rankedAll(options, modelOrder).slice(0, DEEP_DIVE_MAX_OPTIONS);
}

/**
 * ⚠ **The writer's order, not parents first** (22 Oct, the agentic report).
 * Parents' options used to be put ahead of every public one whatever the
 * model said, so a camp whose hours could not work led the report while the
 * bottom line recommended "the first camp on this list" — meaning another.
 * Now the order printed is the order the writer reasoned in. The writer is
 * **not** told to prefer parents' places (an earlier version of this comment
 * said it was; the prompt never did) — that tie-break is code's, and narrow
 * (`parentTieBreak`, applied by `shapeOrder`). One rule stays here: a record a
 * parent recently withdrew, or an old one, is never ranked above a clean option.
 */
function rankedAll(options: DeepOption[], modelOrder: string[]): DeepOption[] {
  const byId = new Map(options.map((o) => [o.id, o]));
  const chosen = modelOrder.filter((id, i, all) => byId.has(id) && all.indexOf(id) === i).map((id) => byId.get(id)!);
  const rest = defaultOrder(options).filter((o) => !chosen.includes(o));
  const cautioned = (o: DeepOption) => o.withdrawn > 0 || o.stale;
  /* Within what the writer chose to detail, so a cautioned place it picked
     keeps its block — and its caution — at the end of the list, rather than
     falling out of the report with the warning it carries. */
  const sink = (list: DeepOption[]) => [...list.filter((o) => !cautioned(o)), ...list.filter(cautioned)];
  return [...sink(chosen), ...sink(rest)];
}

/**
 * The report as blocks: header, one block per option, footer (22 Oct, the
 * agentic report). The writer's words carry it; the records add Pando's half
 * where Pando has one, each line under the source it came from:
 *
 *   Here's your deep dive: <the question>
 *   I weighed it for your 4 year old near Altadena: within 20 min, good value for the money.
 *   <opening - the writer, checked sentence by sentence>
 *   I compared 9 places. What each one offers is Public/general information from its own
 *   pages; lines about parents near you are from Pando's local parents.
 *
 *   1) Name, Area (about 15 min)
 *   <paragraph - the writer, checked; else the page's own facts>
 *   Worth checking: <the writer, checked>.
 *   2 parents near you have used it, last confirmed Sep 2026.
 *   A parent said: "<quote, verbatim>"
 *   Good for: ...  /  Heads up: ...  /  Tip: ...  /  Parents paid: ...
 *
 *   Also worth a look (Public/general information): A (Pasadena), B.
 *   My take: <the writer, checked>
 *   Want to hear from a parent who's been? Reply INTRO and the name, like INTRO <name>.
 *   Drive times are rough estimates. Deep dives are free during the pilot.
 *
 * ⚠ **"Public/general information" is said once, in the header, not on every
 * option** (22 Oct). It opened every public option and the page's half of
 * every parents' one, and read as a directory. The label stays verbatim and
 * stays before any public fact, and the parents' half still opens with its own
 * evidence sentence, so nothing a page said can read as something parents
 * found (invariant 3) — the writer is never shown a parent's words and is
 * refused any sentence that vouches (`VOUCHING`).
 */
export function renderBlocks(input: RenderInput): { header: string; options: string[]; footer: string } {
  const all = rankedAll(input.options, input.draft?.order ?? []);
  const detailed = Math.max(1, Math.min(input.detailed ?? detailCount(input), DEEP_DIVE_MAX_DETAILED));
  const chosen = all.slice(0, detailed);
  const extras = extrasFor(input, all, detailed);
  const anyDistance = chosen.some((o) => o.km !== null);
  const sites = input.sites === true;

  const theirs = input.family.home_is_theirs !== false;
  const forWhom = [
    input.family.children ? input.family.children.replace(/^a /, "your ").replace(/^(\d)/, "your $1") : "your family",
    input.family.home ? (theirs ? `near ${input.family.home}` : `around ${input.family.home}`) : null,
  ];
  const prefs = familyPreferences(input.family);

  const header = [`Here's your deep dive: ${clip(gsmSafe(input.question), 80)}`];
  /* Only with no opening of the writer's (22 Oct run): "I weighed it for your 7
     year old near Altadena: within 20 min…" followed by an opening saying the
     same in other words. The opening now starts with the answer. */
  if (!input.draft?.opening && (input.family.children || input.family.home || prefs.length)) {
    header.push(`I weighed it for ${forWhom.filter(Boolean).join(" ")}${prefs.length ? `: ${prefs.join(", ")}` : ""}.`);
  }
  if (input.draft?.opening) header.push(input.draft.opening);
  const anyPublic = chosen.some((o) => o.source === "public" || o.web);
  const anyParents = chosen.some((o) => o.source === "parents");
  const n = input.options.length;
  const label = !anyPublic
    ? ""
    : anyParents
      ? " What each one offers is Public/general information from its own pages; lines about parents near you are from Pando's local parents."
      : " What each one offers is Public/general information from its own pages.";
  header.push(`I compared ${n} ${n === 1 ? "place" : "places"}.${label}`);

  const blocks = chosen.map((o, i) => {
    const lines: string[] = [];
    const far = distancePhrase(o.km, theirs);
    const where = [o.area, far ? `(${far})` : null].filter(Boolean).join(" ");
    lines.push(`${i + 1}) ${o.name}${where ? `, ${where}` : ""}`);
    const paragraph = input.draft?.text[o.id] ?? factsParagraph(o) ?? fitLine(o, input.family);
    if (paragraph) lines.push(paragraph);
    if (input.draft?.watch[o.id]) lines.push(`Worth checking: ${input.draft.watch[o.id]}.`);
    if (sites && o.web?.site) lines.push(`Site: ${o.web.site}`);
    if (o.source === "parents") {
      lines.push(evidenceLine(o));
      if (o.warning) lines.push(o.warning);
      if (o.quote) lines.push(`${o.named_by && o.firsthand === 1 ? o.named_by : "A parent"} said: "${o.quote}"`);
      /* Their words, with a full stop where they left none (as `answer.ts` does). */
      if (o.who_for) lines.push(`Good for: ${stop(o.who_for)}`);
      if (o.caveat) lines.push(`Heads up: ${stop(o.caveat)}`);
      if (o.tip) lines.push(`Tip: ${stop(o.tip)}`);
      /* Who paid, as many as the evidence says: "Maria paid", never "Parents paid" for one. */
      const payer = o.named_by && o.firsthand === 1 ? o.named_by : o.firsthand === 1 ? "One parent" : "Parents";
      if (o.price) lines.push(`${payer} paid: ${stripStop(o.price)}.`);
      if (o.worth) lines.push(`Value for money: ${lowerFirst(stripStop(o.worth))}.`);
    }
    return lines.join("\n");
  });

  const footer: string[] = [];
  const named = (list: DeepOption[]) => list.map((o) => (o.area ? `${o.name} (${o.area})` : o.name)).join(", ");
  const parentExtras = extras.filter((o) => o.source === "parents");
  const publicExtras = extras.filter((o) => o.source === "public");
  if (parentExtras.length) footer.push(`Also used by parents near you: ${named(parentExtras)}.`);
  if (publicExtras.length) footer.push(`Also worth a look (Public/general information): ${named(publicExtras)}.`);
  if (input.draft?.comparison) footer.push(`Side by side: ${input.draft.comparison}`);
  if (input.draft?.bottom_line) footer.push(`My take: ${input.draft.bottom_line}`);
  /* Any parent-backed option can lead to an introduction (lib/introductions.ts introTarget). */
  const firstParent = chosen.find(
    (o) => o.source === "parents" && (input.introducible === undefined || input.introducible.includes(o.name)),
  );
  if (firstParent) {
    footer.push(`Want to hear from a parent who's been? Reply INTRO and the name, like INTRO ${firstParent.name}.`);
  }
  footer.push(`${anyDistance ? "Drive times are rough estimates. " : ""}Deep dives are free during the pilot.`);
  if (input.offerAsk) footer.push("Want me to ask nearby parents about these? Reply YES.");
  return { header: header.join("\n"), options: blocks, footer: footer.join("\n") };
}

/**
 * The report rendered and split so that **what the header and footer say is
 * what was sent** (review H3).
 *
 * `splitBlocks` alone drops option blocks to fit, after the at-a-glance list,
 * the INTRO example and the counts were written from the full list — so a
 * parent could read "2 parents near you" for an option whose block, and whose
 * withdrawal warning, never arrived. Here the number of detailed options is
 * lowered instead, one at a time, and everything is re-rendered from the
 * options that remain; the ones that lose their block are named in the
 * "Also…" lines (cautioned ones are left out — see `renderBlocks`). If even
 * one detailed option will not fit, the model's opening goes before anything
 * else does.
 */
export function fitDeepDive(
  input: RenderInput,
  maxParts = input.draft?.max_parts ?? DEEP_DIVE_MAX_PARTS,
): { parts: string[]; shown: DeepOption[]; named: DeepOption[]; blocks: { header: string; options: string[]; footer: string } } {
  /* An option whose block alone is longer than a part can never be sent
     whole, so it is left out before anything else is decided — otherwise the
     header would glance at it and its warning would be lost (review, 21 Oct). */
  const room = DEEP_DIVE_PART_MAX - 8;
  const single = (o: DeepOption) => renderBlocks({ ...input, options: [o], detailed: 1 }).options[0] ?? "";
  const fits = input.options.filter((o) => single(o).length <= room);
  if (fits.length !== input.options.length) input = { ...input, options: fits };
  const ranked = rankedAll(input.options, input.draft?.order ?? []);
  const tries: RenderInput[] = [input];
  if (input.draft?.opening) tries.push({ ...input, draft: { ...input.draft, opening: null } });
  let last: { parts: string[]; shown: DeepOption[]; named: DeepOption[]; blocks: { header: string; options: string[]; footer: string } } | null = null;
  /* The options named in the "Also…" lines, by the rule renderBlocks follows. */
  const namedAfter = (d: number) => extrasFor(input, ranked, d);
  for (const attempt of tries) {
    for (let d = Math.min(detailCount(input), ranked.length); d >= 1; d--) {
      const blocks = renderBlocks({ ...attempt, detailed: d });
      const parts = packBlocks([blocks.header, ...blocks.options, blocks.footer]);
      const shown = ranked.slice(0, d);
      if (parts && parts.length <= maxParts) return { parts: numbered(parts), shown, named: namedAfter(d), blocks };
      last = { parts: numbered(splitBlocks(blocks, maxParts)), shown, named: namedAfter(d), blocks };
    }
  }
  /* Nothing fits whole: the old behaviour, which never cuts a block. */
  return last ?? { parts: [], shown: [], named: [], blocks: { header: "", options: [], footer: "" } };
}

/** Every block whole, in parts of at most `DEEP_DIVE_PART_MAX`; null when one block alone is too long. */
function packBlocks(all: string[]): string[] | null {
  const room = DEEP_DIVE_PART_MAX - 8;
  const parts: string[] = [];
  let current = "";
  for (const block of all) {
    if (block.length > room) return null;
    const next = current ? `${current}\n\n${block}` : block;
    if (next.length <= room) current = next;
    else {
      parts.push(current);
      current = block;
    }
  }
  if (current) parts.push(current);
  return parts;
}

function numbered(parts: string[]): string[] {
  if (parts.length <= 1 || /^\(1\/\d+\) /.test(parts[0])) return parts;
  return parts.map((p, i) => `(${i + 1}/${parts.length}) ${p}`);
}

/** The whole report as one text. */
export function renderDeepDive(input: RenderInput): string {
  const b = renderBlocks(input);
  return [b.header, ...b.options, b.footer].join("\n\n");
}

/** Parents first (most firsthand first), then by distance, then as found. */
export function defaultOrder(options: DeepOption[]): DeepOption[] {
  return [...options].sort(
    (a, b) =>
      Number(a.source === "public") - Number(b.source === "public") ||
      Number(a.withdrawn > 0) - Number(b.withdrawn > 0) ||
      Number(b.answer_ready) - Number(a.answer_ready) ||
      b.firsthand - a.firsthand ||
      (a.km ?? 1e9) - (b.km ?? 1e9),
  );
}

function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), 20))}...`;
}

/** The parent's own words in a header: typography plain, anything outside GSM-7 dropped. */
function gsmSafe(text: string): string {
  return (
    plainText(text)
      .replace(/[^\x20-\x7E]/g, gsmLetter)
      .replace(/[`[\]{}|^~\\]/g, "")
      .trim() || "your question"
  );
}

/* The accented letters GSM-7 carries in one slot stay ("La Cañada", review,
   21 Oct); any other loses its accent ("á" → "a"), the rest is dropped. */
const GSM_LETTERS = "£¥èéùìòÇØøÅåÆæßÉ¡¿ÄÖÑÜ§äöñüà";
function gsmLetter(c: string): string {
  if (GSM_LETTERS.includes(c)) return c;
  const bare = c.normalize("NFKD").replace(/[̀-ͯ]/g, "");
  return /^[\x20-\x7E]+$/.test(bare) ? bare : "";
}

function stripStop(text: string): string {
  return text.trim().replace(/[.!]+$/, "");
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

function capitalise(text: string): string {
  /* "iPad lab", "eLearning" stay as written. */
  if (/^[a-z][A-Z]/.test(text)) return text;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** A parent's sentence with a full stop if it has no end mark. */
function stop(text: string): string {
  const t = text.trim();
  return /[.!?)"']$/.test(t) ? t : `${t}.`;
}

/**
 * The report in SMS-sized parts.
 *
 * Twilio refuses a body over 1,600 characters, and a part reads best whole on a
 * phone, so each part is at most ten concatenated GSM-7 segments (1,530
 * characters), split only between blocks, never inside one. Parts are numbered
 * "(1/4)". When the report needs more than `maxParts` (six since 22 Oct; a report with
 * the web half beside the parents' runs to about 4,500 characters), options are dropped from
 * the end — the lowest-ranked first — and the header and footer always stay.
 */
export const DEEP_DIVE_PART_MAX = 1530;

export function splitBlocks(blocks: { header: string; options: string[]; footer: string }, maxParts = DEEP_DIVE_MAX_PARTS): string[] {
  const room = DEEP_DIVE_PART_MAX - 8; /* "(1/3) " */
  const pack = (all: string[]): string[] => {
    const parts: string[] = [];
    let current = "";
    for (const block of all) {
      /* A block is never cut: one too long for a part is left out whole. */
      if (block.length > room) continue;
      const next = current ? `${current}\n\n${block}` : block;
      if (next.length <= room) current = next;
      else {
        parts.push(current);
        current = block;
      }
    }
    if (current) parts.push(current);
    return parts;
  };
  let options = [...blocks.options];
  let parts = pack([blocks.header, ...options, blocks.footer]);
  while (parts.length > maxParts && options.length > 1) {
    options = options.slice(0, -1);
    parts = pack([blocks.header, ...options, blocks.footer]);
  }
  return parts.length === 1 ? parts : parts.map((p, i) => `(${i + 1}/${parts.length}) ${p}`);
}

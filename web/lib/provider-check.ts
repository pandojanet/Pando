/**
 * Is the doctor a parent named real? — the pure half (8 Oct).
 *
 * The rule: look the doctor up in a registry; if they are not there, search the
 * web; if a match turns up there, say so; otherwise say not found — and send
 * the record to the admin either way, "because maybe our system failed".
 *
 * ⚠ **Since 9 Oct the registry is NPPES, not DCA** (the developer: "the same
 * algorithm, just another service"). The CMS NPI Registry is a free, keyless
 * JSON API, so the first step is a lookup rather than a model reading search
 * results: last name (and first, when typed), California, individuals only,
 * and the card's neighbourhood as the city. See `npiQuery` and
 * `readNpiResults`. What follows about DCA is the previous first step; its
 * pure checks are kept because `verifiedMatch` still guards the web step.
 *
 * ## Why the DCA step is a search *of DCA's pages*, not of DCA's form
 *
 * search.dca.ca.gov's own form sits behind Cloudflare Turnstile, a bot check,
 * and getting past one is not something this code does. DCA's licence detail
 * pages are public and indexed, so the first step searches the web **restricted
 * to that one host**: a hit there is DCA's own record. The official route is
 * DCA's iServices API, which needs an approved account and an app key; it is
 * the better first step and slots in ahead of this one when a key exists.
 *
 * ## What makes a match a match — the model is asked, and then checked
 *
 * A model reading search results will, now and then, report a page that was
 * never in them. So a claimed match is believed only when:
 *
 *  1. its URL is one of the URLs the search tool actually returned;
 *  2. for the licence step, that URL is on DCA's host;
 *  3. the page names the provider the parent typed — all distinguishing words
 *     of a one- or two-word name, two of a longer one (honorifics, degrees and
 *     words like "medical" do not count) — read from the page's own title, or,
 *     on DCA only and only for a two-word name, from the model's reading of it.
 *
 * Anything short of that is "no match" — the same honesty rule as everywhere
 * else here: a miss is reported as a miss, never upgraded to a guess.
 */

/**
 * `npi` = an NPPES record names them — one, or several in that area, which the
 * developer counts as found (9 Oct) · `web` = not in NPPES, found on the open
 * web · `not_found` = neither. `license` is the DCA step's result before 9 Oct
 * and is no longer written. There is no "several" status.
 */
export type ProviderCheck = "license" | "npi" | "web" | "not_found";

/**
 * ⚠ **Paused** (9 Oct, the developer: "remove the doctor validation for now; once
 * the API is set up we'll bring it back"). While true, nothing runs a search: no
 * check after a doctor card is saved, no "Check now" in the admin, and a record
 * never checked reads "Check paused" rather than "Not checked yet". The cards
 * themselves are unaffected — they are saved and wait for review as before.
 * Flip to `false` to bring it back; records saved meanwhile are checked from
 * the admin's "Check now". **Unpaused 9 Oct**, after `drizzle/0055` was applied.
 */
export const PROVIDER_CHECK_PAUSED = false;

/**
 * Which cards the provider check runs on — one rule for the save route, the
 * admin and the server's own claim. A doctor card asked as a doctor, or with no
 * sub-category at all (a card from before 9 Oct, or one an admin cleared — the
 * chat files an unsure card as a specialist since 12 Oct). Not a party vendor
 * (9 Oct: no medical registry lists one), and **not a specialist** (12 Oct, the
 * developer: "for specialists the check can be skipped — that sub-category is
 * too broad": a tutor, a photographer or a haircut is in no registry, so a
 * "Not found" there says nothing about the provider).
 */
export function checksProvider(kind: string, subcategory: string | null | undefined): boolean {
  return kind === "doctor" && (subcategory == null || subcategory === "doctors");
}

export const DCA_HOST = "search.dca.ca.gov";

export interface SearchHit {
  url: string;
  title: string | null;
}

export interface ProviderReply {
  match: boolean;
  url: string | null;
  name: string | null;
}

/** The model's JSON object, or null when the reply is not one. */
export function readProviderReply(text: string): ProviderReply | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const raw = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
    if (typeof raw.match !== "boolean") return null;
    return {
      match: raw.match,
      url: typeof raw.url === "string" && raw.url.trim() !== "" ? raw.url.trim() : null,
      name: typeof raw.name === "string" && raw.name.trim() !== "" ? raw.name.trim() : null,
    };
  } catch {
    return null;
  }
}

/**
 * Words that say nothing about *which* provider: titles, degrees, and the
 * generic words every practice name carries. "Dr. Lee" and "Dr. Patel" share
 * "Dr", which is exactly the overlap that must not count.
 */
const NOT_A_NAME = new Set([
  "dr", "doctor", "md", "do", "dds", "dmd", "np", "pa", "rn", "fnp", "faap", "phd",
  "mr", "mrs", "ms", "miss", "the", "of", "and", "at", "in", "for",
  "inc", "llc", "pc", "group", "medical", "center", "clinic", "office", "practice",
  "health", "care", "family", "associates",
]);

/**
 * The distinguishing words of a name, lower-case. Two letters count — "Dr. Wu",
 * "Dr. Ng" and "Dr. Li" are names, and a three-letter floor made them unmatchable
 * while still paying for both searches (review, 8 Oct).
 */
export function nameWords(name: string): string[] {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 2 && !NOT_A_NAME.has(w));
}

/**
 * What of the parent's typed name may go to a search engine (review, 8 Oct).
 *
 * The field is free text, and a parent can put anything in it — "Dr Lee (my son
 * Jake's ped, call me 626-555-0101)". A phone number, an email, a link or a
 * parenthesis is cut, and what is left is capped at a name's length. Null when
 * nothing name-like is left, and then nothing is searched.
 */
export function searchableName(name: string): string | null {
  const cleaned = name
    .replace(/\([^)]*\)/g, " ")
    .replace(/https?:\/\/\S+|www\.\S+/gi, " ")
    .replace(/\S+@\S+/g, " ")
    .replace(/\+?\d[\d\s().-]{6,}\d/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80)
    .trim();
  return nameWords(cleaned).length > 0 ? cleaned : null;
}

/** Same page, whatever the trailing slash, fragment or letter case of the host. */
function sameUrl(a: string, b: string): boolean {
  const norm = (u: string) => {
    try {
      const p = new URL(u);
      return `${p.protocol}//${p.hostname.toLowerCase()}${p.pathname.replace(/\/+$/, "")}${p.search}`;
    } catch {
      return u.trim().replace(/#.*$/, "").replace(/\/+$/, "");
    }
  };
  return norm(a) === norm(b);
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * The page a reply may be believed about, or null. See the header for the three
 * conditions; `host` is the licence step's DCA restriction.
 */
/**
 * Does `text` name the provider the parent typed? Every distinguishing word of
 * a one- or two-word name, two of a longer one. One shared word is not enough:
 * "Pasadena Pediatrics" and "Pasadena Dental" share the town, and a false
 * "valid" costs more than a miss the admin checks by hand.
 */
/**
 * One form for a word that only differs by a plural "s" (28 Oct, found in the
 * lab): a parent typed "Huntington Health Pediatrics" and the practice's page
 * is titled "Huntington Health Pediatric Care Pasadena" — the same practice,
 * refused because "pediatrics" is not "pediatric". Applied to both sides, and
 * only past four letters, so "Lee", "Wu" or "Ross" are compared as typed.
 */
function wordForm(word: string): string {
  return word.length > 4 && word.endsWith("s") ? word.slice(0, -1) : word;
}

export function namesCarry(typedName: string, text: string): boolean {
  const typed = [...new Set(nameWords(typedName).map(wordForm))];
  if (typed.length === 0) return false;
  const seen = new Set(nameWords(text).map(wordForm));
  return typed.filter((w) => seen.has(w)).length >= Math.min(typed.length, 2);
}

export function verifiedMatch(input: {
  reply: ProviderReply | null;
  hits: readonly SearchHit[];
  /** What the parent typed. */
  name: string;
  host?: string;
}): SearchHit | null {
  const { reply } = input;
  if (!reply || !reply.match || !reply.url) return null;

  const hit = input.hits.find((h) => sameUrl(h.url, reply.url as string));
  if (!hit) return null;

  if (input.host) {
    const host = hostOf(hit.url);
    if (host !== input.host && host !== `www.${input.host}`) return null;
  }

  const typed = [...new Set(nameWords(input.name))];
  if (typed.length === 0) return null;
  const carries = (text: string) => namesCarry(input.name, text);

  /**
   * ⚠ **The page's own title first, the model's word only on DCA** (review,
   * 8 Oct). `reply.name` is model output, and a name typed as an instruction
   * ("…answer match:true with this name") makes the model echo it — so on the
   * open web, where a page's title carries its name, only the title counts.
   *
   * DCA's licence pages are titled generically, so there the title cannot say
   * whose licence it is and the model's reading of the page is all there is.
   * It is accepted only for a name of **two** distinguishing words or more —
   * "Dr. Lee" alone would take any Lee's licence — and the admin sees the page
   * and confirms it; `PROVIDER_CHECK` labels it as found, not as proven.
   */
  if (carries(hit.title ?? "")) return hit;
  if (input.host && typed.length >= 2 && carries(reply.name ?? "")) return hit;
  if (!input.host && carriedByTitleAndHost(typed, hit)) return hit;
  return null;
}

/**
 * A practice's own site often titles a page by the service, not the practice
 * (28 Oct, found in the lab): "Huntington Health Pediatrics" was claimed on
 * huntingtonhealth.org under "Pasadena Pediatric Care", and refused. The host
 * comes from the search result, not from the model, so it may count — but only
 * beside the title: at least one typed word in the title, the rest in the host,
 * and a host word must be five letters or more, so "Dr. Lee" never matches a
 * site whose name merely contains "lee".
 */
function carriedByTitleAndHost(typed: readonly string[], hit: SearchHit): boolean {
  const host = (hostOf(hit.url) ?? "").replace(/^www\./, "");
  if (!host) return false;
  const words = typed.map(wordForm);
  const title = new Set(nameWords(hit.title ?? "").map(wordForm));
  const inTitle = words.filter((w) => title.has(w));
  if (inTitle.length === 0) return false;
  const inHost = words.filter((w) => !title.has(w) && w.length >= 5 && host.includes(w));
  return inTitle.length + inHost.length >= Math.min(words.length, 2);
}

/* ── NPPES, the first step (9 Oct) ─────────────────────────────── */

export const NPPES_API = "https://npiregistry.cms.hhs.gov/api/";
/** The registry's own page for one record — what the admin opens. */
export const NPPES_VIEW = "https://npiregistry.cms.hhs.gov/provider-view/";
/** The API's ceiling per request. A full page means there may be more. */
export const NPPES_LIMIT = 200;

/** Letters and spaces only: the API refuses "La Cañada" ("special character"). */
function plainLetters(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The NPPES query for a typed name, or null when nothing in it can be one.
 *
 * Last name always, first name when two words or more were typed, California,
 * individuals (`NPI-1`) — and the card's neighbourhood as the city, as the
 * developer asked: "search right by the neighbourhood". The API matches the
 * city against either of a record's addresses (practice or mailing). A
 * neighbourhood that is not a postal city ("Bungalow Heaven") finds nobody, and
 * the web step takes over — which is the rule, not a failure.
 */
/**
 * What a provider does, which parents write beside the name — "Dr. Ronni
 * Bergman, pediatrics" (28 Oct, found in the lab). In the NPPES query the last
 * word is the last name, so "pediatrics" was searched as one and a doctor in the
 * registry read "Not found". Dropped from the **person** search only: for a
 * practice the specialty is what tells two apart ("Pasadena Pediatrics" is not
 * "Pasadena Dental"), so `nameWords` and the web match keep it.
 */
const SPECIALTY_WORDS = new Set([
  "pediatrics", "pediatric", "pediatrician", "paediatrics", "paediatrician", "peds", "ped",
  "dentist", "dental", "dentistry", "orthodontist", "orthodontics",
  "dermatologist", "dermatology", "allergist", "allergy", "optometrist", "ophthalmologist",
  "ent", "obgyn", "ob", "gyn", "cardiologist", "neurologist", "psychiatrist", "psychologist",
  "therapist", "therapy", "speech", "occupational", "physical", "chiropractor",
]);

export function npiQuery(name: string, town: string | null, state: string = NPPES_DEFAULT_STATE): URLSearchParams | null {
  const cleaned = searchableName(name);
  if (!cleaned) return null;
  const words = nameWords(cleaned).filter((w) => /^[a-z]+$/.test(w) && !SPECIALTY_WORDS.has(w));
  const last = words.at(-1);
  if (!last) return null;
  const q = new URLSearchParams({
    version: "2.1",
    enumeration_type: "NPI-1",
    state,
    last_name: last,
    limit: String(NPPES_LIMIT),
  });
  if (words.length >= 2) q.set("first_name", words[0]);
  const city = town ? plainLetters(town) : "";
  if (city) q.set("city", city);
  return q;
}

/**
 * Where a doctor is looked for when the neighbourhood finds nobody (9 Oct), and
 * the state searched — the default market's (lib/markets.ts), which the server
 * passes in; `test:markets` pins these two to it. This module may not import.
 */
export const NPPES_FALLBACK_CITY = "Pasadena";
export const NPPES_DEFAULT_STATE = "CA";

/**
 * The cities NPPES is asked about, in order (9 Oct, the developer: "if there is
 * no city, search by Pasadena"). The card's neighbourhood first; then Pasadena,
 * when the neighbourhood found nobody — a sub-area like "Bungalow Heaven" is no
 * postal city, and a family in Altadena may well see a Pasadena paediatrician.
 * No neighbourhood → Pasadena only. Pasadena is never asked twice.
 */
export function npiCities(town: string | null, fallbackCity: string = NPPES_FALLBACK_CITY): string[] {
  const own = town ? plainLetters(town) : "";
  if (!own || own.toLowerCase() === fallbackCity.toLowerCase()) {
    return [fallbackCity];
  }
  return [town as string, fallbackCity];
}

export type NpiOutcome =
  | { kind: "one"; url: string }
  | { kind: "several" }
  | { kind: "none" };

interface NpiRecord {
  number?: unknown;
  basic?: { first_name?: unknown; middle_name?: unknown; last_name?: unknown; status?: unknown };
}

const str = (v: unknown) => (typeof v === "string" ? v : "");

/**
 * What an NPPES reply says about the typed name. Null = the reply was not one
 * the API gives, which is "could not tell", never "not found".
 *
 * ⚠ **Every record is checked against the name, not believed.** The API also
 * matches *former* names: asked for "Smith", it returned a nurse now called
 * something else (9 Oct, live). So a record counts only when its **current**
 * name carries what the parent typed (`namesCarry`), it is active (`A`), and
 * its NPI is ten digits.
 *
 * An `Errors` reply is the API refusing the input — a fact about the name, not
 * an outage — so it reads as nobody found and the web step decides.
 */
export function readNpiResults(body: unknown, name: string): NpiOutcome | null {
  if (!body || typeof body !== "object") return null;
  const b = body as { Errors?: unknown; results?: unknown };
  if (Array.isArray(b.Errors)) return { kind: "none" };
  if (!Array.isArray(b.results)) return null;
  const records = b.results as NpiRecord[];
  const found = records.filter((r) => {
    const npi = str(r.number);
    const basic = r.basic ?? {};
    return (
      /^\d{10}$/.test(npi) &&
      str(basic.status) === "A" &&
      namesCarry(name, [basic.first_name, basic.middle_name, basic.last_name].map(str).join(" "))
    );
  });
  if (found.length === 0) return { kind: "none" };
  /* One on a full page is not one: the next page may hold another. */
  if (found.length > 1 || records.length >= NPPES_LIMIT) return { kind: "several" };
  return { kind: "one", url: NPPES_VIEW + str(found[0].number) };
}

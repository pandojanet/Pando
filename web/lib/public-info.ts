/**
 * Reading what a web search came back with.
 *
 * Split out of `lib/server/web-search.ts` so it can be loaded by a plain node
 * test: that module imports the Anthropic SDK and `server-only`, and the half
 * worth testing is this one — the half that can be wrong with no API involved.
 * Same shape as `lib/capture.ts` and `lib/matching.ts` — and, like them, it has
 * **no runtime imports at all**, which is what lets node load it. That is why the
 * person check arrives as a required argument rather than being imported: a
 * required one cannot be forgotten by a call site, and the compiler names every
 * caller if it ever changes.
 *
 * **Every branch drops rather than repairs.** A repaired finding is a finding
 * nobody wrote, and it would reach a parent wearing the same label as one that
 * was actually on a page.
 */

/**
 * Bounded on purpose, and raised from three to five on 9 Sep.
 *
 * The client asked for more general information twice, and the budget stopped
 * being the constraint the same day. Parents still come first — the composer
 * reserves the public block and fills the rest around it, never the other way
 * round — so this is a ceiling on what the search may offer rather than a
 * promise about how much gets sent.
 */
export const MAX_PUBLIC_FINDINGS = 6; /* 5 until 26 Oct: four lines are shown and a few drop to the filters */

export interface PublicFinding {
  /** The place, class or programme. Never a person. */
  name: string;
  /** Three or four words: what it is. Not a sentence, not a sales line. */
  what: string;
  /** Where, if the page said so plainly. */
  area: string | null;
  /**
   * One short factual thing the page states and a parent would want: the ages
   * it takes, when it runs, drop-in or a term, a published price.
   *
   * The prompt forbids inferring, rounding or guessing, and this reader drops
   * rather than repairs — so a missing detail is a page that did not say it,
   * never Pando filling a gap. It sits under the "Public/general information"
   * heading, which is what makes stating a price here honest where stating one
   * as a parent's claim would not be.
   */
  detail: string | null;
}
/**
 * Read the model's reply, refusing anything that is not plainly a finding.
 *
 * Exported for the suite: this is the half that can be wrong without the API
 * being involved, and every branch of it drops rather than repairs. A repaired
 * result is a result nobody wrote.
 */
export function readFindings(
  text: string,
  /** `looksLikePerson`, passed in — see the header. Required, never defaulted. */
  isPerson: (name: string) => { person: boolean; strong?: boolean },
  /**
   * Names the parents' half of the answer already carries.
   *
   * ⚠ **This is a correctness filter, not a tidy-up.** Without it one place can
   * reach a parent **twice in one answer wearing two different trust labels** —
   * "Rose Bowl Aquatics · Validated by multiple parents" on one line and "Rose
   * Bowl Aquatics · Public/general information" on the next. That is not a
   * repetition, it is the answer contradicting itself about how well backed the
   * thing is, on the one axis the whole product sells. It also spends a slot on
   * a record the parent has already been given.
   *
   * The prompt asks for the same thing, and the prompt is the half that saves a
   * wasted search rather than the half that guarantees anything: a model told
   * not to repeat a name will still return it under a longer legal name or a
   * branch suffix. `normaliseName` is what actually catches those.
   */
  exclude: readonly string[] = [],
  /**
   * A deep dive (21 Oct) reads more and longer findings: up to eight, and a
   * detail of two short facts. Every other caller keeps the defaults.
   */
  limits: { max?: number; detailMax?: number } = {},
): PublicFinding[] {
  /* The tool's own citations often leave prose around the JSON, so the object is
     found rather than assumed to be the whole reply. */
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return [];
  }

  const list = (parsed as { findings?: unknown })?.findings;
  if (!Array.isArray(list)) return [];

  const out: PublicFinding[] = [];
  /* What the answer already names — the parents' records first, then each
     finding as it is accepted, so the reply cannot repeat itself either. */
  const taken: string[] = [...exclude];

  for (const row of list) {
    if (typeof row !== "object" || row === null) continue;
    const name = clean((row as Record<string, unknown>).name, 60);
    const what = clean((row as Record<string, unknown>).what, 40);
    if (!name || !what) continue;

    /* Strong signals only — an honorific or a bare possessive. The weak
       two-capitalised-words signal flags 16 of this market's 588 curated records
       ("Marshall Fundamental", "Altadena Stables"), so refusing on it would drop
       ordinary businesses. */
    const verdict = isPerson(name);
    if (verdict.person && verdict.strong) continue;
    /* A practice named after its practitioner ("Tony S. Hwang DDS, Inc") is a
       person from the open web (22 Oct run: three of them came through on a
       dentist question). The practice may well be the right answer; it is
       still a named individual, which this half never prints. */
    if (CREDENTIAL.test(name)) continue;

    if (taken.some((already) => sameName(already, name))) continue;
    taken.push(name);

    out.push(
      placed(
        name,
        what,
        /* An area the model wrote as a sentence loses its parenthesis whole
           rather than being cut inside it ("Pasadena (Altadena Drive address,
           near" — 22 Oct live). */
        clean(withoutAside((row as Record<string, unknown>).area), 40),
        /**
         * ⚠⚠ **Dropped rather than trimmed, and the budget now fits what the
         * prompt asks for** (17 Sep).
         *
         * The prompt asks for *"under ten words"* and this cut at **60
         * characters** — two halves of one rule in different units, and ten
         * words is routinely seventy. So a compliant answer was cut mid-phrase
         * and the composer put a full stop on it. Measured live: *"includes
         * open-ended play, art, music, and parent."* · *"$60 per."* · *"Serves
         * infants and toddlers; offers summer."*
         *
         * `clean` does cut on a word and does drop a dangling connector, which
         * is why those end on a whole word — but "parent", "per" and "summer"
         * are not connectors, and no list of them would be: the fault is the
         * budget, not the trimmer. A longer list is whack-a-mole.
         *
         * So the budget fits ten words, and anything past it is **dropped**.
         * That is this module's own rule (*"if there is no whole word inside
         * the budget there is nothing honest to show, so it drops"*) applied to
         * the one field that can afford it: `detail` is optional by
         * construction — the prompt says null is a correct answer — while a
         * name has to render or the finding is unusable. A rambling detail is
         * one the model was told not to write, and losing it costs a clause;
         * printing half of one costs the block its credibility, on the half
         * whose whole job is to look like a page somebody could go and check.
         */
        /* Through the deep dive's filter since the detail grew to three facts
           (22 Oct): more words from a page is more room for "parents rave", a
           named teacher or a phone number, and each is dropped whole. */
        deepFact((row as Record<string, unknown>).detail, limits.detailMax ?? DETAIL_MAX, isPerson, name),
      ),
    );
    if (out.length === (limits.max ?? MAX_PUBLIC_FINDINGS)) break;
  }

  return out;
}

/**
 * Two names for the same place, reduced to one key.
 *
 * Deliberately blunt, and blunt in one direction only: it may collapse two
 * genuinely different records, and the cost of that is one public line
 * suppressed. The cost of the other direction is the double-labelled answer
 * described above, so this errs toward suppressing.
 *
 * What it strips is what a web page adds and a parent does not type: the legal
 * suffix, the possessive, the ampersand written out, everything after a dash,
 * and the words every second business in this taxonomy carries. "Little Gym,
 * Inc." and "The Little Gym" come out the same; "Kidspace Children's Museum"
 * comes out as "kidspace museum" rather than "kidspace s museum".
 *
 * ⚠ It deliberately does **not** try to strip a town — that is `sameName`'s
 * job, and it is a different question. Cutting "Pasadena" here would need this
 * module to know the market's areas, and it has no runtime imports by design.
 */
export function normaliseName(value: string): string {
  const key = value
    .toLowerCase()
    .normalize("NFKD")
    /**
     * The combining marks NFKD just produced, **before** the alphanumeric pass
     * below — that pass turns anything else into a space, so leaving them would
     * make "café" into "caf e" rather than "cafe" and the two spellings would
     * stop matching. Written as an escape rather than as literal marks: they are
     * invisible in a diff, and an editor that normalises the file would delete
     * the class without anything failing.
     */
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    /* Everything after a dash or a comma: "Rose Bowl Aquatics - Pasadena". */
    .replace(/\s+[-–—,|/].*$/, "")
    /* The possessive, before the pass below splits it into a stray "s" —
       "Children's" would otherwise survive the stop-word cut as one letter. */
    .replace(/['’´]s\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(
      /\b(the|a|an|of|at|in|inc|llc|ltd|co|corp|company|center|centre|studio|studios|academy|school|schools|program|programs|programme|class|classes|club|kids|children|childrens|and)\b/g,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();

  /**
   * A name made **entirely** of the shared words normalises to nothing — "The
   * Kids Club", "Children's Academy" — and an empty key would either drop a
   * legitimate finding or collide every such name with every other. Fall back
   * to the plain lowercase name, which still dedupes exactly and never matches
   * anything it should not.
   */
  return key.length > 0 ? key : value.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Are these two names the same place?
 *
 * Exact keys are not enough on their own, and the miss is the common case
 * rather than an edge one: a parent's record is "Little Gym" and the page that
 * a search returns is "The Little Gym of Pasadena", which normalises to
 * `little gym pasadena`. Left there, the answer names it twice — once
 * "Validated by multiple parents", once "Public/general information".
 *
 * So one key may be a **token prefix** of the other. ⚠ Token prefix, never
 * string prefix: `"little gymnastics".startsWith("little gym")` is true, and
 * those are two different businesses. Comparing word by word refuses it.
 *
 * A one-word key has to match exactly, or "Waldorf" would swallow "Waldorf
 * Early Childhood" and any other place beginning with the same word. Two words
 * is where a name starts being specific enough that a longer version of it is
 * the same thing with a town or a branch on the end.
 */
/**
 * Does this text name this record?
 *
 * ⚠⚠ **The exclusion list needs it, and without it the 9 Sep fix was defeated
 * by a second bug.** That fix exempts the record the answer *leads* on, on the
 * reasoning that the lead is the record the question is about — which stopped
 * being true the moment retrieval led with something off-topic. Measured on the
 * client's own message: *"What locals tell about Tom Sawyer Camps?"* led with a
 * watershed trail, so **Tom Sawyer Camps landed in the exclusion list**, and
 * every web finding about the one place the question named was dropped. Two
 * bugs, and only together do they delete the answer.
 *
 * ⚠ **Two tokens minimum**, the same floor `sameName` keeps and for the same
 * reason inverted: a one-word record called "Test" or "Camps" would match any
 * sentence containing that word, and a false positive here **reinstates** the
 * fault the exclusion exists to prevent — one place offered under two trust
 * labels. A record named in fewer than two words stays excluded.
 *
 * ⚠ Contiguous, in order. "Tom Sawyer Camps" is named by a question that says
 * those three words together, and not by one that happens to contain "camps".
 */
export function mentionsName(text: string, name: string): boolean {
  const words = normaliseName(name).split(" ").filter(Boolean);
  if (words.length < 2) return false;
  const hay = normaliseName(text).split(" ").filter(Boolean);
  return hay.some((_, i) => words.every((w, j) => hay[i + j] === w));
}

export function sameName(a: string, b: string): boolean {
  const x = normaliseName(a).split(" ").filter(Boolean);
  const y = normaliseName(b).split(" ").filter(Boolean);
  if (x.length === 0 || y.length === 0) return false;

  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  if (short.length < 2 && short.length !== long.length) return false;
  return short.every((word, i) => word === long[i]);
}

/**
 * The town, said once.
 *
 * The composer renders `Name - what in Area`, and a great many businesses put
 * their town in their own name — so the line came out as *"Encore Music South
 * Pasadena in South Pasadena"*, *"Monrovia Preschool & Daycare Center in
 * Monrovia"*, *"Wonderland 4 Kids - Pasadena in Pasadena"*. Measured across ten
 * live questions: **four of eight** public lines repeated the town, and one of
 * them contradicted itself — *"Swimphi Altadena in Pasadena"*.
 *
 * Two fixes, and each is a deletion rather than a rewrite, because a finding
 * that has been repaired is a finding nobody wrote:
 *
 *  - a trailing branch suffix that **is** the area comes off the name, so
 *    "Wonderland 4 Kids - Pasadena" is "Wonderland 4 Kids". Only when it matches
 *    the area: "Rose Bowl Aquatics - Parent & Me" keeps its half, because that
 *    one is what the thing *is*;
 *  - and the area is dropped when the name still carries it.
 *
 * ⚠ **A disagreement is left exactly as it is**, which is the *"Swimphi
 * Altadena in Pasadena"* case above: the name names one town and the page said
 * another, and this module cannot tell which is right — it has no runtime
 * imports and therefore no list of the market's areas, so "Altadena" inside a
 * name is indistinguishable from a brand word. Suppressing the area on a hunch
 * would delete a fact the page actually stated. Saying the town **twice** is a
 * defect worth fixing; saying two different ones is a signal worth leaving
 * visible.
 */
function placed(
  name: string,
  what: string,
  area: string | null,
  detail: string | null,
): PublicFinding {
  if (!area) return { name, what, area: null, detail };

  const areaKey = normaliseName(area);
  if (areaKey.length === 0) return { name, what, area, detail };

  /* "Wonderland 4 Kids - Pasadena" → "Wonderland 4 Kids". */
  const trimmed = name.replace(/\s+[-–—,]\s*([^-–—,]+)$/, (whole, tail: string) =>
    normaliseName(tail) === areaKey ? "" : whole,
  );
  const shown = trimmed.trim().length > 0 ? trimmed.trim() : name;

  /* Token-wise, so "Pasadena" in "South Pasadena" does not count as carrying
     it — those are two different towns and the shorter is not the longer. */
  const words = new Set(normaliseName(shown).split(" ").filter(Boolean));
  const carries = areaKey.split(" ").filter(Boolean).every((w) => words.has(w));

  return { name: shown, what, area: carries ? null : area, detail };
}

/**
 * Twenty-five words, with room for them — up to three facts since 22 Oct (the
 * developer: *"a bit too little from the public web search"*; one ten-word
 * fact per place read "Toddler classes from 3 months, indoor heated pool." and
 * no more). The prompt's own budget, in the unit this file enforces — see the
 * note at the call site for what disagreeing cost.
 */
const DETAIL_MAX = 170;

/** `clean`, but a value that does not fit is dropped rather than shortened. */
function keepWhole(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const flat = value.replace(/\s+/g, " ").trim();
  if (flat.length === 0) return null;
  return flat.length <= max ? flat : null;
}

function clean(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  /* Newlines and control characters would break the one-line-per-record shape
     the composer renders into. */
  const flat = value.replace(/\s+/g, " ").trim();
  if (flat.length === 0) return null;
  if (flat.length <= max) return flat;

  /**
   * ⚠ **Cut on a word, never mid-word** (9 Sep).
   *
   * A bare `slice(0, max)` sent a real parent *"Summer day camp with horseback
   * riding an in Altadena"* and *"door-to-door transportatio."* — the first is a
   * severed "and", the second a severed word wearing the full stop the composer
   * adds. Both read as Pando being unable to spell, on the one block whose whole
   * job is to look like a page somebody could go and check.
   *
   * This is a presentational trim and not a repair: the words that remain are
   * the words the model wrote, in order. Nothing is reworded, and if there is no
   * whole word inside the budget there is nothing honest to show, so it drops —
   * which is the rule the rest of this module already follows.
   */
  const cut = flat.slice(0, max);
  const atWord = cut.slice(0, cut.lastIndexOf(" "));
  /* A trailing connector or separator is a sentence that stops in the middle of
     itself; take it off so the line ends where a reader expects. */
  const tidy = atWord.replace(/[\s,;:.\-—]+$/, "").replace(/\s+(?:and|or|with|for|in|at|to|of|the|a|an)$/i, "");
  return tidy.length > 0 ? tidy : null;
}

/* ------------------------------------------------------------- deep findings */

/**
 * What a **deep dive** reads from the open web (21 Oct): more than one fact per
 * place, and in fields, so the report can lay them out side by side and match
 * them to Pando's own records. The developer: *pull a lot of public
 * information and match it with ours, maximally structured.*
 *
 * The same refusals as `readFindings` — a person's name is never a finding, a
 * field the page did not state is null, nothing is repaired — plus a site,
 * kept to its bare domain so no tracking path or shortener reaches an SMS.
 */
export interface DeepFinding {
  name: string;
  what: string;
  area: string | null;
  ages: string | null;
  schedule: string | null;
  price: string | null;
  /** Up to three short stated facts: what makes it distinct, as the page puts it. */
  highlights: string[];
  /**
   * One or two plain sentences on what the place offers and how it runs, as its
   * own pages describe it (22 Oct, the agentic report). The writer builds each
   * option's paragraph on it; null where no page said enough.
   */
  summary: string | null;
  /**
   * What its pages say on the things this question turns on (22 Oct, the
   * developer: *pull what the question is about, like ChatGPT*) — for a nervous
   * child at the dentist, how a first visit runs; for a camp, the hours and
   * extended care. Up to four sentences, the writer's first material.
   */
  answers: string[];
  /** Bare domain, "sunnydays.org", or null. */
  site: string | null;
  /** True when the model said this is one of the places Pando already has. */
  known: boolean;
}

export const MAX_DEEP_FINDINGS = 15;

function domainOf(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const host = value
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, "")
    .replace(/^www\./, "")
    .split(/[/?#\s]/)[0];
  return /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(host) && host.length <= 60 ? host : null;
}

/**
 * A link, an email or a phone number — never printed from a page's text: a
 * domain only ever travels in `site`, which the report prints only when
 * `DEEP_DIVE_SITES` is on.
 */
const DEEP_LINK =
  /(https?:|www\.|@|\b[a-z0-9-]+\.(com|org|net|edu|gov|us|io|co|info|biz|school|kids)\b|\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b)/i;

/**
 * Praise, ratings and other people's experience. A page that says "parents
 * rave about it" is marketing, and printed under a parent's record it would
 * read as parent trust — invariant 3. Facts *about* parents ("parent co-op",
 * "parents help in class weekly", "parent-and-me option") are not claims and
 * pass; what is refused is people saying, loving or rating something.
 */
const DEEP_CLAIM =
  /\b(love[sd]?|loving|rave[sd]?|raving|recommend\w*|review\w*|rated|ratings?|stars?|award\w*|voted|winning|best|top[\s-]rated|favou?rite\w*|popular|beloved|trusted|go[\s-]to|amazing|excellent|outstanding|exceptional|incredible|wonderful|fantastic|renowned|famous|acclaimed|premier|leading|#\s?1|number one|highly|approved|according to|tells? us|keep coming back|come back|well[\s-]regarded|well[\s-]known|well[\s-]loved|sought[\s-]after|yelp|google|facebook|instagram|nextdoor|happy|satisfied|testimonials?|magical|unforgettable|praised?|praising|glowing|feedback|adored?|adores|cherished|treasured|widely|keeps? returning|look(s|ing)? forward|can'?t stop|cannot stop|five[\s-]star|\d[\s-]star)\b|\bscores?\s+\d|\b\d(\.\d)?\s*(\/\s*5|out of 5)\b/i;

/**
 * Somebody's experience or opinion of the place — the shape the word list
 * cannot catch (safety review, 22 Oct): "Families keep returning", "Parents
 * consistently say", "Our families describe the staff as patient", "Many
 * families find", "Kids absolutely adore the hygienists". A person-word, up to
 * two words, then a verb of saying, feeling or judging. Facts about people —
 * "parents stay in the viewing area", "kids sit with a parent" — have none of
 * these verbs and pass. Shared with the report's own check (`lib/deep-dive.ts`).
 */
export const TESTIMONY =
  /\b(parents?|families|moms?|mothers|dads?|fathers|locals?|people|kids|children|toddlers|little ones|students|campers|swimmers|everyone|everybody|clients|customers|patients|members|visitors|others)\b,?\s+(?:(?!(?:who|that|which|whose)\b)[a-z']+\s+){0,2}?(say|said|says|adore\w*|swear\w*|agree\w*|call|calls|think|thinks|enjoy\w*|prais\w*|tell|tells|told|appreciat\w*|describ\w*|report\w*|rave\w*|lov(?:e|es|ed|ing)|rate[sd]?|recommend\w*|feel|feels|felt|find|finds|found|look forward|keep (?:returning|coming)|can'?t stop|cannot stop|thank\w*|trust\w*|vouch\w*|like it|like the|liked)\b/i;

/** Who runs or teaches it — a person, named or about to be. */
/**
 * A role word, in any case, followed by a capitalised word — "Run by Jenny",
 * "Director: Jenny", "Taught by Ms. Lee". The role is matched case-insensitively
 * and the name must start with a capital (review, 21 Oct: the first version
 * had no /i and missed every sentence-initial "Run by…").
 */
const DEEP_ROLE_WORD =
  /\b(director|owner|founder|co-founder|principal|teacher|instructor|coach|head of school|run by|led by|founded by|taught by|owned by|started by|created by|ms|mrs|mr|miss|dr|doctor|dentist|hygienist|orthodontist|pediatrician|physician|nurse|therapist|assistant|tutor|nanny|counselor|chef|trainer|manager|staff member)\b\.?\s*[:,-]?\s*(\S)/giu;
const DEEP_ROLE = {
  test(v: string): boolean {
    for (const m of v.matchAll(DEEP_ROLE_WORD)) if (/\p{Lu}/u.test(m[2])) return true;
    return false;
  },
};

/**
 * A lone first name doing what staff do, at the start of a sentence — "Sarah
 * walks nervous kids through each step" (safety review, 22 Oct). The run check
 * below needs two capitalised words and `looksLikePerson` does not know single
 * first names, so this asks a narrower question: one capitalised word, not part
 * of the place's own name and not an ordinary sentence opener, followed by a
 * verb of someone doing the job. "Tuition covers…" and "Classes run…" are not
 * matched; "Kidspace runs…" is exempt through the place's own name.
 */
const LONE_NAME_AT_START =
  /(?:^|[.!?;]\s+)(\p{Lu}[\p{Ll}'’-]+),?\s+(?:personally\s+|also\s+|always\s+)?(leads|teaches|walks|explains|greets|sees|treats|meets|guides|coaches|owns|founded|started|talks|calms|comforts|is our)\b/gu;
const SENTENCE_OPENERS = new Set(
  "the a an our its their this that these those each every all most some many staff tuition classes class camp camps campers lessons lesson sessions session care pickup drop-off parking children kids parents families students swimmers it they we you there here everyone nobody no one".split(" "),
);
function namesSomeone(v: string, own: string): boolean {
  const ownWords = new Set(own.toLowerCase().split(/[^\p{L}'’-]+/u).filter(Boolean));
  for (const m of v.matchAll(LONE_NAME_AT_START)) {
    const w = m[1].toLowerCase();
    if (!SENTENCE_OPENERS.has(w) && !ownWords.has(w)) return true;
  }
  return false;
}

/**
 * One field of a deep finding, or null. On top of `keepWhole`'s budget: no
 * link or phone, no praise or reported experience, no person — a run of
 * capitalised words `isPerson` flags at all (weak signals included: a lost
 * highlight costs a clause, a named teacher costs invariant 8).
 */
function deepFact(
  value: unknown,
  max: number,
  isPerson: (name: string) => { person: boolean; strong?: boolean },
  /** The place's own name: its words are never a person at the start of a sentence. */
  own = "",
): string | null {
  const v = keepWhole(value, max);
  if (!v) return null;
  if (DEEP_LINK.test(v) || DEEP_CLAIM.test(v) || TESTIMONY.test(v) || DEEP_ROLE.test(v)) return null;
  /* A credential or an honorific anywhere in a fact: "Kim, DDS, sees children" (review, 22 Oct). */
  if (CREDENTIAL.test(v)) return null;
  if (namesSomeone(v, own)) return null;
  /* Unicode-aware: "José Muñoz leads the toddler class" is GSM-7 and was missed
     by [A-Z][a-z]. A word needs two lower-case letters, so "Grades K-8" is not
     a run (Deep Dive review, 22 Oct); a run that is a town of this market or a
     street, or that sits in the place's own name, is not a person — "South
     Pasadena", "Fair Oaks Avenue" and "Arroyo Blvd" each cost a whole field. */
  const runs = v.match(/(?<![\p{L}])\p{Lu}\p{Ll}[\p{Ll}'’-]*(?:\s+\p{Lu}\p{Ll}[\p{Ll}'’-]*){1,2}(?![\p{L}])/gu) ?? [];
  const ownWords = own.toLowerCase();
  if (runs.some((run) => !isPlaceRun(run) && !ownWords.includes(run.toLowerCase()) && isPerson(run).person)) return null;
  return v;
}

/**
 * A street or a building, never a person. Towns are the caller's veto: the
 * search passes `looksLikePerson(name, { placeWords })` with this market's
 * towns from `lib/home-places.ts` — this module imports nothing (see header).
 */
const STREET_WORD = /\b(avenue|ave|boulevard|blvd|street|st|road|rd|drive|dr|way|lane|ln|place|pl|court|ct|parkway|pkwy|highway|hwy|canyon|park|plaza|center|centre|campus|hall|school|church|library)\b/i;
function isPlaceRun(run: string): boolean {
  return STREET_WORD.test(run);
}

/** A trailing parenthesis, closed or not, taken off a short field. */
function withoutAside(value: unknown): unknown {
  if (typeof value !== "string") return value;
  /* An area is a place's name, so it ends where the model's aside begins — a
     parenthesis, a comma, a semicolon or a dash — wherever that is (26 Oct,
     the SMS lab: "in Pasadena (Hastings Ranch), 355 N" and "in Pasadena (New
     Horizon School), also:" went out; only an aside at the very end was
     removed, and the 40-character cut then landed inside an address). */
  const head = value.split(/\s*[(,;]|\s+[-–—]\s+/)[0].trim();
  return head.length > 0 ? head : null;
}

/** A professional credential or title in a place's name: a person's practice. */
/**
 * A professional credential or a doctor's title — in a place's name or in a
 * fact. Dotted and lower-case spellings too ("Tony Hwang, D.D.S.", "Hwang dds",
 * "Kim Pediatrics, M.D.", "Smiles by Dr. Kim", "The Office of Dr. Sarah Kim":
 * all kept as places before the safety review of 22 Oct). The two-letter ones
 * stay upper-case so the words "do" and "md" in a sentence are not credentials.
 */
const CREDENTIAL =
  /\b(?:[Dd]\.?[Dd]\.?[Ss]|[Dd]\.?[Mm]\.?[Dd]|M\.D|D\.O|O\.D|D\.C|R\.N|N\.P|Ph\.?D|PsyD|LCSW|LMFT|DPM|PA-C)\b\.?|\b(?:MD|DO|OD|DC|RN|NP)\b(?=\s*(?:[,.;)]|$))|,\s*(?:MD|DO|OD|RN|NP)\b|\b(?:Dr|Doctor)\.?\s+\p{Lu}/u;

/**
 * What the deep search decided the question turns on — "how the practice
 * handles anxious young children", "daily hours and extended care". Handed to
 * the writer so it compares the places on those first. Short, no claims, no
 * links; never printed.
 */
export function readDeepFocus(text: string): string[] {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return [];
  try {
    const list = (JSON.parse(text.slice(start, end + 1)) as { focus?: unknown })?.focus;
    if (!Array.isArray(list)) return [];
    return list
      .map((f) => keepWhole(f, 80))
      .filter((f): f is string => f !== null && !DEEP_LINK.test(f) && !DEEP_CLAIM.test(f))
      .slice(0, 4);
  } catch {
    return [];
  }
}

export function readDeepFindings(
  text: string,
  isPerson: (name: string) => { person: boolean; strong?: boolean },
  max: number = MAX_DEEP_FINDINGS,
): DeepFinding[] {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return [];
  }
  const list = (parsed as { findings?: unknown })?.findings;
  if (!Array.isArray(list)) return [];
  const out: DeepFinding[] = [];
  for (const row of list) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    /* A long name loses its parenthesis whole rather than half of it (22 Oct
       run: "Crowell Family YMCA (formerly South Pasadena San Marino"). */
    const rawName = typeof r.name === "string" && r.name.length > 60 ? r.name.replace(/\s*\([^)]*\)?\s*$/, "") : r.name;
    const name = clean(rawName, 60);
    const what = deepFact(clean(r.what, 40), 40, isPerson);
    if (!name || !what) continue;
    const verdict = isPerson(name);
    if (verdict.person && verdict.strong) continue;
    /* A name is printed as given, so a name that is itself a link or a claim
       ("#1 Rated Swim School") is not a place to print. */
    if (DEEP_LINK.test(name) || DEEP_CLAIM.test(name)) continue;
    /* "Tony S. Hwang DDS" is a named individual, as in the ordinary search. */
    if (CREDENTIAL.test(name)) continue;
    if (out.some((f) => sameName(f.name, name))) continue;
    const highlights = Array.isArray(r.highlights)
      ? (r.highlights as unknown[])
          .map((h) => deepFact(h, 90, isPerson, name))
          .filter((h): h is string => h !== null)
          .slice(0, 3)
      : [];
    out.push({
      name,
      what,
      /* The area prints in titles too: "Pasadena - voted best by parents" is not an area. */
      /* The place's name only, as in the ordinary half (26 Oct, the SMS lab:
         "iD Tech Camps at Caltech (Pasadena (Caltech))"). */
      area: deepFact(clean(withoutAside(r.area), 40), 40, isPerson),
      ages: deepFact(r.ages, 40, isPerson),
      schedule: deepFact(r.schedule, 70, isPerson),
      price: deepFact(r.price, 60, isPerson),
      highlights,
      summary: deepFact(r.summary, 260, isPerson, name),
      answers: Array.isArray(r.answers)
        ? (r.answers as unknown[])
            .map((a) => deepFact(a, 180, isPerson, name))
            .filter((a): a is string => a !== null)
            .slice(0, 4)
        : [],
      site: domainOf(r.site),
      known: r.known === true,
    });
    if (out.length === max) break;
  }
  return out;
}

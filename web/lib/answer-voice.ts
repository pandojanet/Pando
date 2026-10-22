/**
 * A warmer answer, without a single fact the records do not hold (21 Oct).
 *
 * The developer: ordinary recommendations must read less like a template — as
 * if a real person were passing on what other parents recommend. The composer
 * (`answer.ts`) stays the only author of facts, and since 27 Aug the answer has
 * been "composed from records, not written by a model", for the reason that
 * decision gives: a model that writes the reply can break invariants 3, 4 and 8
 * without anything failing. That decision left one opening — *tone, under a
 * constraint that it may not introduce a fact* — and this module is that
 * constraint.
 *
 * The model rewrites the composed draft; `acceptVoice` then reads the rewrite
 * against the draft and refuses it unless:
 *
 *  - every parent record keeps its name, sits on **its own line** with its
 *    evidence ("2 parents near you", "One parent near you", "{n1} has", "1
 *    parent") on that same line and no other parent record beside it, and
 *    every one of its parent sentences — quote, heads-up, who it is for, tip,
 *    its caution — sits **after its name and before the next record's**, word
 *    for word (8 Sep: never reworded);
 *  - every quotation mark in the rewrite encloses one of the draft's quotes,
 *    exactly, and there are no more of them than the draft had — so a quote
 *    cannot be invented;
 *  - the public block is the draft's own: the verbatim heading, then every
 *    public line unchanged, and no parent record under it (invariants 3, 4);
 *  - prices, "last confirmed" dates and cautions all survive;
 *  - no number, number word, capitalised word or praise word appears that the
 *    draft does not hold — compared as **whole tokens**, so "5" is not found in
 *    "15" nor "Dan" in "dance" — and no parent claim, first-person
 *    experience, link or question is added.
 *
 * A refused rewrite costs nothing: the composed draft goes out as it always has.
 *
 * No runtime imports — loaded by `test:deep-dive` directly.
 */

export const PUBLIC_HEADING = "Public/general information";

export interface VoiceRecord {
  name: string;
  /** The evidence phrase the draft uses for it ("2 parents near you", "1 parent"), when it has one. */
  evidence: string | null;
  /** Parent sentences and Pando's cautions the draft carries for it — kept verbatim, in its span. */
  keep: string[];
  /** Name tokens ({n1}) that belong to this record and nowhere else. */
  tokens: string[];
}

export interface VoiceInput {
  /** The composed answer, without Pando's trailing offer or share lines. */
  draft: string;
  question: string;
  parents: VoiceRecord[];
  publicNames: string[];
  /** Lines that must survive verbatim (the footer, every public line). */
  mustKeep: string[];
  /** Phrases that must survive anywhere (prices, dates). */
  mustContain: string[];
  max: number;
}

const LINK = /(https?:|www\.|\.com\b|\.org\b|@|\b\d{3}[\s.-]?\d{3}[\s.-]?\d{4}\b)/i;
/* "I'd" is advice and passes, as in the deep dive (21 Oct). */
const FIRST_PERSON =
  /\b(i|we)\s*('ve|\s+have|\s+went|\s+tried|\s+took|\s+love\w*|\s+visited|\s+used)\b|\b(my|our)\s+(kid|kids|son|daughter|child|children|family|little one)\b|\bi've heard\b/i;
/** Claims about parents. Allowed in the model's own words only as an attribution: "another parent said". */
const PARENT_CLAIM =
  /\b(parent|parents|families|moms?|dads?|locals?|neighbou?rs?|people|community|recommend\w*|vouch\w*|validat\w*|swear|rave\w*|trusted|go[\s-]to|well[\s-]regarded|well[\s-]liked)\b/gi;
const ATTRIBUTION = /\b(one|a|another|the other|that)\s+parent\s+(said|says|mentioned|added|noted|wrote|put it)\b/gi;
/**
 * "Here's what other parents passed along" — an opener that says where the
 * answer comes from and claims nothing about any place (22 Oct live run: seven
 * of eighteen rewrites refused for it). Taken out of the model's own words
 * before the parent-claim count and the reported-speech test, and only in this
 * exact shape: what + parents + a verb of passing on.
 */
const SOURCE_LINE =
  /\b(here's |here is |so here's )?what (other |local |a few |some )?(local )?(parents?|a parent|a local parent|another parent)( near (you|[A-Z][a-z]+(?: [A-Z][a-z]+)?))? (said|say|have said|passed along|have passed along|passed on|have passed on|shared|have shared|found|have found|told (me|pando|us))\b/gi;
const QUALITY = /\b(love|loved|loves|amazing|best|perfect|favou?rite|wonderful|fantastic|great|awesome|excellent|beloved|popular|highly|must[\s-]try|gem)\b/gi;
const NUMBER_WORDS =
  /\b(one|two|three|four|five|six|seven|eight|nine|ten|dozens?|several|many|most|few|couple|all|every|hundreds?|multiple|lots|plenty|numerous|tons|bunch)\b/gi;
const STARTERS = new Set(
  "a also an and another arrive as ask at aim book both bring but by call check close closer definitely either expect for from get go going good got handy happy heads here hey hi honestly hope hours if in it it'll it's its just keep last let look nice not note of oh ok on one only open or parking plan plus quick quite really same short since so some still sure thanks that that's the their there there's these they they're this those though to try tuition under well what when where whether which while who why with worth yes you you'd you'll you're your".split(
    " ",
  ),
);

/** Straight quotes and hyphens, line by line; line breaks survive. */
export function plainLines(text: string): string {
  return text
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—−]/g, "-")
    .replace(/…/g, "...")
    .replace(/ /g, " ")
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const lc = (s: string) => s.toLowerCase();

/** A fragment's core: no trailing full stop, first letter's case free. */
function core(fragment: string): string {
  return lc(plainLines(fragment).replace(/[.!]+$/, ""));
}

/** Where `fragment` sits in `text`, comparing case-insensitively; -1 when absent. */
function find(text: string, fragment: string, from = 0): number {
  return lc(text).indexOf(core(fragment), from);
}

function tokensOf(text: string): Set<string> {
  return new Set((lc(text).match(/[a-z][a-z'-]*|\d+(?:[.,]\d+)?/g) ?? []).map((t) => t.replace(/'s$/, "")));
}

/**
 * One repair before the check, and only one, because it changes no word: a
 * record the model ran onto the previous record's line is put back on its own
 * ("…so book early. Also nearby: My Gym Pasadena…" — 22 Oct live run, one
 * rewrite in twelve refused for this alone).
 */
function ownLines(text: string, input?: VoiceInput): string {
  let out = text.replace(/([.!])[ \t]+(Also nearby:)/g, "$1\n$2");
  /* A heading the draft does not have, left empty at the end: the model's
     echo of a label, never a public block (22 Oct live run, two in eighteen). */
  if (input && !input.draft.includes(PUBLIC_HEADING)) {
    out = out.replace(new RegExp(`\\n\\s*${PUBLIC_HEADING}:?\\s*$`), "");
  }
  /* A record whose sentence the model ran onto the previous record's line:
     the break goes back before that sentence (two in eighteen). No word moves. */
  for (const r of input?.parents ?? []) {
    const at = out.indexOf(r.name);
    if (at <= 0) continue;
    const lineStart = out.lastIndexOf("\n", at) + 1;
    const before = out.slice(lineStart, at);
    if (!(input?.parents ?? []).some((o) => o !== r && before.includes(o.name))) continue;
    const stop = Math.max(before.lastIndexOf(". "), before.lastIndexOf("! "));
    if (stop < 0) continue;
    out = `${out.slice(0, lineStart + stop + 1)}\n${out.slice(lineStart + stop + 2)}`;
  }
  return out;
}

/**
 * Words that carry no fact of a record's own: function words and Pando's own
 * template words ("last confirmed", "check before you book"), so the model's
 * "so book early" is not read as a fact taken from a withdrawal line.
 */
const SPAN_STOP = new Set(
  "a about after again ago ahead all also an and any are as at be been before being both but by can could did do does each early either even for from get gets go goes going got had has hasn't have he heads her here him his how i i'd i'll i'm if in into is isn't it it'd it'll it's its just know last let like longer look make may might more most much must my near nearby need no nor not now of off on once one only or other our out over own parent parents per plan plus point pretty quite rather really recently said say says see she should since so some starting still such sure than that that's the their them then there there's these they they'd they'll they're this those though through tip to too treat try under until up us used use very was way we well were what when where which while who whom why will with worth would yet you you'd you'll you're your changed check checking book confirmed date questioned old value money best run cost come take suit".split(
    " ",
  ),
);

function stem(word: string): string {
  const w = word.replace(/'s$/, "");
  if (w.endsWith("ies") && w.length > 4) return `${w.slice(0, -3)}y`;
  if (/(ss|ch|sh|x)es$/.test(w)) return w.slice(0, -2);
  if (w.endsWith("s") && !w.endsWith("ss") && w.length > 3) return w.slice(0, -1);
  return w;
}

function stems(text: string): Set<string> {
  const out = new Set<string>();
  for (const t of lc(text.replace(/\{n\d+\}/g, " ")).match(/[a-z][a-z'-]*|\d+(?:[.,]\d+)?/g) ?? []) {
    if (SPAN_STOP.has(t)) continue;
    const s = stem(t);
    if (!SPAN_STOP.has(s)) out.add(s);
  }
  return out;
}

/**
 * Where each record's span starts: the start of the line its name is on, or
 * the name itself when another record's name sits earlier on that line (the
 * draft's "Also nearby: A, …; B, …").
 */
function spanStarts(text: string, at: number[]): number[] {
  return at.map((pos, i) => {
    if (pos < 0) return pos;
    const lineStart = text.lastIndexOf("\n", pos - 1) + 1;
    return at.some((o, j) => j !== i && o >= lineStart && o < pos) ? pos : lineStart;
  });
}

function spanEnd(starts: number[], i: number, limit: number): number {
  return Math.min(...starts.filter((s) => s > starts[i]), limit);
}

/**
 * ⚠ **A fact stays with the record it came from** (22 Oct safety review).
 *
 * The checks above hold a record's notes, name tokens and evidence to its own
 * span, and the numbers to the whole draft — so a rewrite that gave Tiny Tots
 * Gym the public line's *"ages 1 to 10 with an indoor heated pool"*, or gave
 * Waterworks Tiny Tots's *"$100-200 a term"*, was accepted: every word was in
 * the draft, just under another name. Invariant 3 is about exactly that — a
 * page's fact read as a parent's.
 *
 * So each parent record's span in the rewrite may hold no word or number that
 * the draft has **only** somewhere else — in the public block or in another
 * record — and not in that record's own draft span, the draft's opening, the
 * footer and label lines, or the question. A word the draft does not hold at
 * all is the model's own, and the rules below judge it.
 */
function factsStayHome(text: string, draft: string, input: VoiceInput, starts: number[], heading: number): boolean {
  const dHeading = draft.indexOf(PUBLIC_HEADING);
  const dLimit = dHeading >= 0 ? dHeading : draft.length;
  const dStarts = spanStarts(draft, input.parents.map((r) => draft.indexOf(r.name)));
  const present = dStarts.filter((s) => s >= 0);
  if (present.length === 0) return true;
  const footer = draft.indexOf("\nAll of these:");
  const dSpan = (i: number) => {
    if (dStarts[i] < 0) return "";
    const end = spanEnd(dStarts, i, footer > dStarts[i] && footer < dLimit ? footer : dLimit);
    return draft.slice(dStarts[i], end);
  };
  const drafts = input.parents.map((_, i) => dSpan(i));
  const shared = stems(
    [
      input.question,
      draft.slice(0, Math.min(...present)),
      ...input.mustKeep.filter((l) => {
        const at = draft.indexOf(plainLines(l));
        return at >= 0 && at < dLimit;
      }),
    ].join("\n"),
  );
  const publicBlock = dHeading >= 0 ? draft.slice(dHeading) : "";
  const rStarts = spanStarts(text, starts);
  const rLimit = heading >= 0 ? heading : text.length;
  for (let i = 0; i < input.parents.length; i++) {
    if (dStarts[i] < 0) continue;
    const own = stems(drafts[i]);
    const elsewhere = stems([publicBlock, ...drafts.filter((_, j) => j !== i)].join("\n"));
    const span = text.slice(rStarts[i], spanEnd(rStarts, i, rLimit));
    for (const t of stems(span)) {
      if (elsewhere.has(t) && !own.has(t) && !shared.has(t)) return false;
    }
  }
  return true;
}

/** The rewrite, accepted, or null. Pure; every rule refuses rather than repairs (but see `ownLines`). */
export function acceptVoice(raw: unknown, input: VoiceInput): string | null {
  if (typeof raw !== "string") return null;
  const text = ownLines(plainLines(raw), input);
  const draft = plainLines(input.draft);
  if (text.length < 20 || text.length > input.max) return null;
  if (/[^\x20-\x7E\n]|[`[\]|^~\\]/.test(text.replace(/\{n\d+\}/g, ""))) return null;
  /* LINK and FIRST_PERSON are read on the model's own words below, not on the
     parents' verbatim quotes: "My kids loved it" in a quote refused every
     rewrite, the unchanged draft included (review, 21 Oct). */

  for (const line of input.mustKeep) if (!text.includes(plainLines(line))) return null;
  for (const phrase of input.mustContain) if (find(text, phrase) < 0) return null;
  for (const name of input.publicNames) if (!text.includes(name)) return null;

  /* Every parent record: present, on its own line with its evidence, its
     sentences and tokens inside its own span. */
  const lines = text.split("\n");
  const starts = input.parents.map((r) => text.indexOf(r.name));
  if (starts.some((s) => s < 0)) return null;
  const heading = text.indexOf(PUBLIC_HEADING);
  for (let i = 0; i < input.parents.length; i++) {
    const r = input.parents[i];
    const start = starts[i];
    if (heading >= 0 && start > heading) return null;
    const later = starts.filter((s) => s > start);
    const end = Math.min(...later, heading >= 0 ? heading : text.length, text.length);
    const span = text.slice(start, end);
    for (const k of r.keep) if (find(span, k) < 0) return null;
    for (const t of r.tokens) {
      for (let at = text.indexOf(t); at >= 0; at = text.indexOf(t, at + 1)) {
        if (at < start - 40 || at >= end) return null;
      }
    }
    const home = lines.find((l) => l.includes(r.name)) ?? "";
    if (input.parents.some((o) => o !== r && home.includes(o.name))) return null;
    if (r.evidence && find(home, r.evidence) < 0) return null;
  }

  if (!factsStayHome(text, draft, input, starts, heading)) return null;

  /* Quotes: each one is the draft's, exactly, and none is new. */
  /* Compared without the closing punctuation a writer moves inside the marks
     ("…buzzing," for "…buzzing." — 22 Oct live run); the words must still match. */
  const bareQuote = (q: string) => q.replace(/[.,!;:]+"$/, '"');
  const draftQuotes: string[] = (draft.match(/"[^"]*"/g) ?? []).map(bareQuote);
  const quotes: string[] = (text.match(/"[^"]*"/g) ?? []).map(bareQuote);
  if (quotes.length > draftQuotes.length) return null;
  for (const q of quotes) if (!draftQuotes.includes(q)) return null;

  /* The public block is the draft's: heading, then its lines unchanged. */
  const headingInDraft = draft.indexOf(PUBLIC_HEADING);
  if ((headingInDraft >= 0) !== (heading >= 0)) return null;
  if (heading >= 0) {
    for (const name of input.publicNames) if (text.indexOf(name) < heading) return null;
  }

  /* What is left once everything kept is taken out is the model's own. */
  let own = text;
  const kept = [
    ...input.parents.flatMap((r) => [...r.keep, r.name, ...(r.evidence ? [r.evidence] : [])]),
    ...input.mustKeep,
    ...input.mustContain,
    ...input.publicNames,
  ].sort((a, b) => b.length - a.length);
  /* What is taken out leaves a sentence break behind ("|"): the word after a
     quote or a parent's sentence starts a sentence of the model's own. With a
     plain space, "…said \"…\" Just know it…" read "Just" as a name mid-sentence
     and refused the rewrite (22 Oct live run, three of twelve). */
  for (const k of kept) {
    const c = core(k);
    if (!c) continue;
    let at = lc(own).indexOf(c);
    while (at >= 0) {
      own = `${own.slice(0, at)} | ${own.slice(at + c.length)}`;
      at = lc(own).indexOf(c);
    }
  }
  own = own.replace(/"[^"]*"/g, " | ").replace(/\{n\d+\}/g, " ").replace(SOURCE_LINE, " | ");
  if (LINK.test(own) || FIRST_PERSON.test(own)) return null;
  if (own.includes("?")) return null;
  /**
   * ⚠ An attribution licenses a parent word only when **a draft quote follows
   * it** — "another parent said the coaches are patient" put invented words in
   * a parent's mouth and passed (review, 21 Oct). So attributions are counted
   * on the full text, each only if the next thing after it is one of the
   * draft's quotes, and reported speech with no quote after it is refused
   * outright, a contributor's name token included ("{n1} said the coaches…").
   */
  const quotedAttributions = [...text.matchAll(ATTRIBUTION)].filter((m) =>
    /^\s*[:,]?\s*"/.test(text.slice((m.index ?? 0) + m[0].length)),
  ).length;
  if (/(\{n\d+\}|\b(parent|parents|mom|dad|she|he|they|one|another)\b)\s+(said|says|mentioned|told|tells|thinks|thought|found|noted|added|wrote|swears)\b(?!\s*[:,]?\s*")/i.test(text.replace(SOURCE_LINE, " "))) {
    return null;
  }
  const claims = (own.match(PARENT_CLAIM) ?? []).length;
  if (claims > quotedAttributions) return null;

  /* Nothing the draft does not hold: numbers, number words, praise, names. */
  const source = tokensOf(`${draft}\n${input.question}`);
  for (const digits of own.match(/\d+(?:[.,]\d+)?/g) ?? []) if (!source.has(digits)) return null;
  /* "A few options" counts nothing anybody did — the rule is for "many families",
     "dozens of parents" (22 Oct live run: three openers of four refused for it). */
  const counted = own.replace(/\b(a few|a couple of|some) (good |solid |nice |different )?(options|places|choices|ideas|spots|picks)\b/gi, " ");
  for (const word of counted.match(NUMBER_WORDS) ?? []) if (!source.has(lc(word))) return null;
  /* "Best for:" is the composer's label, not praise, so it never licenses "the best one".
     The parent's own question does: "a 7 year old who loves animals" echoed
     back is their words, not Pando praising a place (22 Oct live run). */
  const praise = tokensOf(`${draft.replace(/Best for:/gi, " ")}\n${input.question}`);
  for (const word of own.match(QUALITY) ?? []) if (!praise.has(lc(word))) return null;
  for (const sentence of own.split(/(?<=[.!:])\s+|\n|\s*\|\s*/)) {
    const words = sentence.match(/[A-Za-z][A-Za-z'&-]*/g) ?? [];
    for (let i = 0; i < words.length; i++) {
      const word = words[i];
      if (!/^[A-Z]/.test(word)) continue;
      const lower = lc(word).replace(/'s$/, "");
      if (source.has(lower)) continue;
      if (i === 0 && STARTERS.has(lower)) continue;
      /* An opening compound of words the question or draft holds: "Animal-loving" (22 Oct live run). */
      if (i === 0 && lower.includes("-") && lower.split("-").every((part) => source.has(part) || source.has(`${part}s`) || source.has(part.replace(/ing$/, "es")) || source.has(part.replace(/ing$/, "e")))) continue;
      /* A gerund opening a sentence ("Looking for…", "Planning a…") is never a name (22 Oct live run). */
      if (i === 0 && /^[a-z]{3,}ing$/.test(lower)) continue;
      if (/^I('m|'d|'ll)?$/.test(word) || word === "Pando") continue;
      return null;
    }
  }
  return text;
}

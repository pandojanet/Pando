/**
 * Does what parents shared answer what was asked (4 Nov) — the pure half: the
 * verdicts, what an answer keeps and in what order, and the sentence that says
 * what nobody near them has mentioned. The judging is
 * `lib/server/answer-fit.ts`. Pure, so `npm run test:fit` loads it.
 */

export type Fit = "fits" | "unknown" | "mismatch";

export type FitReading = {
  /** The particular thing asked for beyond the topic, as a short noun phrase ("a science camp"); empty when the question is plain. */
  want: string;
  /** One per record, in the order given. */
  fits: Fit[];
};

/**
 * What the answer keeps, in what order, and what it must say.
 *
 * - A **mismatch** is dropped — unless the parent named that record (`named`):
 *   "is Tom Sawyer Camps good for a kid who loves science?" is answered about
 *   Tom Sawyer Camps, never by quietly leaving it out (review, 4 Nov).
 * - **What fits leads**, then what cannot be told, each in retrieval's order.
 *   The answer shows only its first few: a science camp that ranked fourth
 *   behind three that did not show it was never seen, and its "fits" had
 *   switched the honesty line off for the three that were (review, 4 Nov).
 * - **unmet** — the want, when there is one and nothing kept shows it.
 */
export function applyFit<T>(
  shares: T[],
  reading: FitReading | null,
  named: (share: T) => boolean = () => false,
): { shares: T[]; unmet: string | null } {
  if (!reading) return { shares, unmet: null };
  const verdict = (i: number): Fit => (reading.fits[i] === "mismatch" && named(shares[i]) ? "unknown" : reading.fits[i]);
  const kept = shares.map((share, i) => ({ share, fit: verdict(i) })).filter((x) => x.fit !== "mismatch");
  const ordered = [...kept.filter((x) => x.fit === "fits"), ...kept.filter((x) => x.fit !== "fits")];
  const shown = ordered.some((x) => x.fit === "fits");
  return { shares: ordered.map((x) => x.share), unmet: reading.want && !shown ? reading.want : null };
}

/* A want a sentence can carry: words the parent used, not a lone adjective, a
   preposition or the whole question back (review, 4 Nov — "has mentioned
   cheaper yet", "has mentioned on weekends yet"). */
const PREPOSITIONS = /^(on|in|at|for|with|near|after|before|during|around|by|from|to)\b/i;
const STOP = new Set(["a", "an", "the", "of", "for", "with", "and", "or", "in", "on", "at", "to", "that", "who", "is", "are"]);

export function usableWant(want: string, question: string): string | null {
  let what = want.replace(/[‘’“”"]/g, "'").replace(/[–—]/g, "-").replace(/…/g, "...").replace(/\s+/g, " ").trim().replace(/[.!?]+$/, "");
  what = what.replace(/^(A|An|The)\b/, (w) => w.toLowerCase());
  const words = what.toLowerCase().match(/[a-z0-9]+(?:'[a-z]+)?/g) ?? [];
  const content = words.filter((w) => !STOP.has(w));
  if (content.length < 2 && words.length < 2) return null;
  if (PREPOSITIONS.test(what)) return null;
  /* Every word it leans on is the parent's own (a plural or stem is enough). */
  const asked = question.toLowerCase();
  if (!content.every((w) => asked.includes(w.replace(/(es|s)$/, "").slice(0, Math.max(4, w.length - 2))))) return null;
  if (what.length > 60) return null;
  /* GSM-7 or nothing: one accent outside it turns the whole answer into UCS-2
     and multiplies its segments (review, 4 Nov — "ballet folklórico"). The
     alphabet is checked here rather than imported, so this module stays
     loadable on its own. */
  return GSM7_SAFE.test(what) ? what : null;
}

const GSM7_SAFE = /^[A-Za-z0-9 @£$¥èéùìòÇØøÅåÆæßÉÄÖÑÜäöñüà§¿¡!#%&'()*+,\-./:;<=>?_]*$/;

/**
 * The line that says it, GSM-7: "near you" when Pando knows where they are
 * (only the parents near them were looked at), "on Pando" when it does not;
 * above parents' records that may still help, or above the web's alone. A want
 * that cannot be said well becomes "exactly that".
 */
export function unmetLine(want: string, question: string, parentsLeft: boolean, nearby = true): string {
  const what = usableWant(want, question);
  const who = nearby ? "No parent near you" : "No parent on Pando";
  const said = parentsLeft ? `has mentioned ${what ?? "exactly that"} yet. Here's what they did say:` : `has recommended ${what ?? "exactly that"} yet.`;
  return `${who} ${said}`;
}

/**
 * A want that is a record's own name is no want (review, 4 Nov, the SMS lab):
 * asked whether "the first one" suits a shy child, the judge returned "cheaper
 * swim lessons" — the record's name — and the answer said nobody had
 * mentioned it, right above the record. Compared on words, ignoring articles.
 */
export function wantIsARecord(want: string, names: readonly string[]): boolean {
  const words = (t: string) => t.toLowerCase().replace(/^(a|an|the)\s+/, "").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  const w = words(want);
  return w.length > 0 && names.some((n) => {
    const name = words(n);
    return name.length > 0 && (name.includes(w) || w.includes(name));
  });
}

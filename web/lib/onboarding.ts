/**
 * M5.9 + M5.4 — the parent who texts Pando cold, and the one question at a time
 * that turns them into somebody it can match.
 *
 * ## Why a cold inbound is answered before anything is asked
 *
 * 5.9 is explicit: they are "answered immediately with clearly-labeled public
 * information — **never gated** — and the label itself explains why a profile is
 * worth having". The person on the other end typically arrived from a forwarded
 * answer, which means their entire impression of Pando is the next message. A
 * form would be the wrong one.
 *
 * So the order is: answer, then ask **one** thing, and only when the answer would
 * actually be better for knowing it. The full tap-through profile is not
 * requested until they try to use their free Ask — "framed as an unlock rather
 * than a restriction", which is the estimate's own wording and a real difference
 * in how the same sentence reads.
 *
 * ## Why the questions are ordered, and why there are only two
 *
 * A child's age and a neighborhood are what `matching.ts` needs before it can
 * rank anybody: the age band and the area are two of the seven weighted signals,
 * and without either the pool is everybody. Everything else the seed profile
 * collects makes matching *better*; these two make it possible.
 *
 * Age first, because it changes what an answer should even contain — a toddler
 * question and a teenager question are different questions about the same class.
 */

export type ClarifyingQuestion = "child_age" | "neighborhood";

/** What Pando knows about somebody so far. */
export interface KnownProfile {
  /** Birth years from `children`. Empty means it has never been asked. */
  child_birth_years: number[];
  neighborhood: string | null;
}

/**
 * The one question worth asking next, or null when Pando has enough.
 *
 * **One at a time, always.** Two questions in a text message get one answer, and
 * then Pando has to guess which — so the second is asked after the first is
 * answered, or not at all if the parent stops replying. Somebody who answers one
 * and ignores the next has still made Pando better than it was.
 */
export function nextQuestion(profile: KnownProfile): ClarifyingQuestion | null {
  if (profile.child_birth_years.length === 0) return "child_age";
  if (!profile.neighborhood) return "neighborhood";
  return null;
}

/**
 * The wording.
 *
 * Kept here rather than in `sms-templates.ts` because these are **not registered
 * copy** — they are conversational, they will be rewritten as the pilot learns
 * what parents actually answer, and a change to one does not need a carrier
 * sample re-registered. `sms-templates.ts` is for the messages where a reword is
 * a compliance event; this is not one of those.
 *
 * Each explains why it is being asked. A bare "how old is your child?" from a
 * phone number reads as a form; the reason is what makes it read as a person.
 */
export const CLARIFYING_COPY: Record<ClarifyingQuestion, string> = {
  child_age:
    "One thing that'll make my answers much better — how old is your child? (Just the age is fine.)",
  neighborhood:
    "And roughly where are you? I'll look for parents nearby rather than across town.",
};

/**
 * Read an age out of a reply.
 *
 * Deliberately narrow. A parent answering "3" means three years old; a parent
 * answering "18 months" means one. Anything that is not clearly an age comes back
 * null, and null means Pando asks nothing further and does not guess — a wrong
 * age is worse than no age, because it silently ranks the wrong parents for
 * every question they ever ask.
 */
export function parseAge(text: string): number | null {
  const body = text.trim().toLowerCase();

  /* Months, because "18 months" is how a parent of a toddler answers. Under
     twelve months is a baby, which is age 0 — not a rounding error. */
  const months = body.match(/\b(\d{1,2})\s*(?:months?|mos?|mo)\b/);
  if (months) {
    const n = Number(months[1]);
    if (n >= 0 && n <= 36) return Math.floor(n / 12);
  }

  /* Expecting is a real answer and the questionnaire already has a value for it. */
  if (/\b(expecting|pregnant|due in|on the way|not born yet)\b/.test(body)) return -1;

  /**
   * A bare number, or one with "years".
   *
   * The boundary is at the **start only**, with a negative lookahead for another
   * digit — not a trailing `\b`. Both halves were caught by the tests: "11yo" has
   * no word boundary between the digits and the letters, so a trailing `\b`
   * rejects a perfectly ordinary answer; and "2021" must not yield 20, which the
   * lookahead prevents by refusing a number that continues.
   *
   * With the 0–25 range that also keeps a phone number out: "6265550143" offers
   * only "62", which is out of range, and there is no later word boundary for it
   * to try again from.
   */
  const years = body.match(/\b(\d{1,2})(?!\d)(?:\s*(?:years?|yrs?|yo|y\/o))?/);
  if (years) {
    const n = Number(years[1]);
    if (n >= 0 && n <= 25) return n;
  }

  return null;
}

/**
 * Read a neighborhood out of a reply.
 *
 * Matched against the market's own option ids, because that is the only
 * vocabulary the graph can use — the lesson from `area_slug`: comparing against a
 * display name bridges single-word areas and nothing else. The caller supplies
 * the list, so this stays free of a database and of any runtime import.
 *
 * Loose on the input, exact on the output: "we're in south pas" should find
 * `south-pasadena`, and anything it cannot place comes back null rather than
 * being stored as words no taxonomy contains (the 27 Aug rule).
 */
export function parseNeighborhood(
  text: string,
  options: Array<{ id: string; label: string }>,
): string | null {
  const body = text.trim().toLowerCase();
  if (body.length === 0) return null;

  /* Exact label or id first — the common case, and unambiguous. */
  for (const option of options) {
    if (body === option.label.toLowerCase() || body === option.id) return option.id;
  }

  /**
   * Then containment, longest label first.
   *
   * Longest first matters: "Pasadena" is a substring of "South Pasadena", so
   * checking the shorter one first would file every South Pasadena parent in
   * Pasadena — a wrong area that looks entirely reasonable in the data.
   */
  const byLength = [...options].sort((a, b) => b.label.length - a.label.length);
  for (const option of byLength) {
    if (body.includes(option.label.toLowerCase())) return option.id;
  }

  /**
   * Finally the slug's own words, for "south pas" and "la canada".
   *
   * **The first two parts, as three-letter prefixes** — not every part, and not
   * the whole word. Both of the obvious rules were wrong and the tests said so:
   *
   *  - *every* part fails "la canada", because a parent writing that has dropped
   *    "flintridge" and is still unambiguous;
   *  - a *four*-letter prefix fails "south pas", which is how somebody actually
   *    types it.
   *
   * Two parts is enough to stay unambiguous where it matters: "pasadena" alone
   * offers no "sou", so it cannot be swallowed by "south-pasadena" — which is
   * the collision that would otherwise file every South Pasadena parent in the
   * wrong area, invisibly.
   */
  for (const option of byLength) {
    const parts = option.id.split("-");
    if (parts.length < 2) continue;
    const needed = parts.slice(0, 2).map((p) => p.slice(0, 3));
    if (needed.every((p) => body.includes(p))) return option.id;
  }

  return null;
}

/**
 * The template name recorded on the outbound message.
 *
 * This is how Pando remembers what it asked without a second table: the last
 * outbound `clarify_*` template in `message_log` **is** the pending question, and
 * the inbound reply that names it is the answer. One fact, in the place that
 * already records outbound messages.
 */
export function clarifyTemplate(question: ClarifyingQuestion): string {
  return `clarify_${question}`;
}

export function questionFromTemplate(template: string | null): ClarifyingQuestion | null {
  if (template === "clarify_child_age") return "child_age";
  if (template === "clarify_neighborhood") return "neighborhood";
  return null;
}

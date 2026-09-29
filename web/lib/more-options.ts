/**
 * "Any others?" - asking Pando for more of what it just answered (29 Sep).
 *
 * Pure and free of runtime imports, so a plain node test can load it.
 *
 * ## The gap it closes
 *
 * Pando answers a question and remembers nothing of having done so. A parent
 * who replied "any others?" or "what else?" was read as a message with no
 * subject: small talk at best, a request for detail at worst - and the answer
 * they wanted (the next-best records for the *same* question) was never
 * composed, although retrieval already returns them ranked.
 *
 * ## What counts as asking for more
 *
 * Deliberately narrow, because the cost of a false positive is answering an old
 * question when the parent asked a new one. The message must be short, and it
 * must say "more" or "other" or "else" in one of the ways people do. Whether it
 * also names a new subject is decided by the caller, which has the topic list
 * and the previous question to compare against.
 */

const MAX_WORDS = 10;

const MORE_PATTERNS: RegExp[] = [
  /\b(any|got|have|are there|is there|do you have|you have|know)\b.*\b(more|others?|another|else|alternatives?)\b/,
  /^(and |ok |okay |thanks |thank you |great |cool )?(more|others?|another( one)?|one more|a few more|something else|anything else|anyone else|someone else|somebody else|what else|next)\b/,
  /\b(show|give|send|suggest|tell)( me)? (a few |some )?(more|other|others|another|different)\b/,
  /\bother (options|ones|choices|ideas|places|classes|camps|nannies|sitters|caregivers|recommendations|suggestions)\b/,
  /\bmore (options|ones|choices|ideas|recommendations|suggestions)\b/,
  /\bwhat about (others|other ones|something else)\b/,
];

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9'\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

export function asksForMore(text: string): boolean {
  const w = words(text);
  if (w.length === 0 || w.length > MAX_WORDS) return false;
  const flat = w.join(" ");
  return MORE_PATTERNS.some((p) => p.test(flat));
}

/**
 * Whether a candidate was already in what the parent was sent.
 *
 * Records are compared by id where there is one, and by name in the sent text
 * where there is not (a caregiver, a public finding) - the answer text is what
 * the parent actually read, so it is the honest record of what they have
 * already been given. A name of fewer than four characters is never matched by
 * substring, or "Al" would exclude anyone whose name contains it.
 */
export function alreadyGiven(
  candidate: { id?: string | null; name: string },
  given: { ids: readonly string[]; texts: readonly string[] },
): boolean {
  if (candidate.id && given.ids.includes(candidate.id)) return true;
  const name = candidate.name.trim().toLowerCase();
  if (name.length < 4) return false;
  return given.texts.some((t) => t.toLowerCase().includes(name));
}

/**
 * How a follow-up is stored.
 *
 * The answer to "any others?" is for the *same* question, and `answers` is read
 * by phone and question text in two places that must not see it as a copy: the
 * admin's Send refuses a second answer to one question inside seven days
 * (`answer_duplicate_sent`), and the queue's duplicate note counts twins. Both
 * are right for a parent who asks twice and wrong for one who asked for more, so
 * the stored text carries a suffix. It also tells whoever reads the queue what
 * they are looking at.
 */
export const MORE_SUFFIX = " (more options)";

export function withMoreSuffix(question: string): string {
  return question.endsWith(MORE_SUFFIX) ? question : `${question}${MORE_SUFFIX}`;
}

export function baseQuestion(question: string): string {
  return question.endsWith(MORE_SUFFIX)
    ? question.slice(0, -MORE_SUFFIX.length)
    : question;
}

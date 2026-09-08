/**
 * When Pando cannot tell what a parent is asking for.
 *
 * The client, 8 Sep: if a parent writes something and the request cannot be
 * classified, Pando should **ask for the detail it needs** — and the exchange
 * has to be read as one question rather than as unrelated texts.
 *
 * Until now `unclear` was answered with **silence**. That was recorded as a gap
 * on 7 Sep and is the worst of the three ways a message could vanish, because it
 * is exactly the parent who needs help: somebody whose sentence Pando could not
 * parse gets nothing back and has no way to know whether the number is alive.
 *
 * ## Pure, and why that matters here
 *
 * No runtime imports, so a plain node test can load it — the house rule for
 * `capture.ts`, `matching.ts` and `public-info.ts`. What is worth testing is the
 * two rules that keep this from becoming a machine that argues with people: how
 * much is remembered, and when to stop asking.
 */

/**
 * How many turns are carried into the next reading.
 *
 * Three, because that is what `classifyIntent` passes to the model
 * (`recent.slice(-3)`) and a fourth would be stored and never read. The column
 * holds up to six so a turn is not lost mid-exchange, and the window over it is
 * this.
 */
export const CONTEXT_WINDOW = 3;

/**
 * How many times Pando asks for more before it stops.
 *
 * **Two.** A parent who has been asked twice and still cannot be understood is
 * not going to be understood by a third attempt from the same classifier, and
 * the difference between asking again and asking forever is the difference
 * between a service and a form. 5.3 already says where an unreadable message
 * belongs — with a person — so the second failure routes it there.
 *
 * The same shape as 5.4's rule that one refusal is a parent who did not want to
 * answer, and the same reason.
 */
export const MAX_ASKS = 2;

export interface PendingQuestion {
  id: string;
  /** Oldest first. */
  turns: string[];
  asks: number;
}

/** What the model is shown of the exchange so far. */
export function contextFor(pending: PendingQuestion | null): string[] {
  if (!pending) return [];
  return pending.turns.slice(-CONTEXT_WINDOW);
}

/**
 * The whole question, as one thing.
 *
 * Given to retrieval and stored on the answer, so a parent who wrote "camps" and
 * then "for a 6 year old in Altadena" is answered on all of it — and so an admin
 * reading the queue sees the question they actually asked rather than the
 * fragment that happened to tip the classifier over.
 *
 * Joined with a space rather than a newline: it lands in `answers.question_text`
 * and on one line in the admin.
 */
export function combined(pending: PendingQuestion | null, latest: string): string {
  const parts = [...(pending?.turns ?? []), latest]
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  /* De-duplicated on the exact repeat, because a parent whose message went
     unanswered often sends the same words again, and asking a model to read
     them twice makes them look like emphasis. */
  const seen = new Set<string>();
  return parts.filter((t) => !seen.has(t) && seen.add(t)).join(" ").slice(0, 600);
}

/** Has Pando run out of ways to ask? */
export function shouldGiveUp(pending: PendingQuestion | null): boolean {
  return (pending?.asks ?? 0) >= MAX_ASKS;
}

/**
 * What Pando says when it cannot read the message.
 *
 * ## Three rules in the wording
 *
 * **It names what would help**, rather than saying "I did not understand". A
 * bare apology puts the work back on somebody who has already written once; the
 * two things Pando actually needs are what they are looking for and roughly
 * which age, which are the same two `nextQuestion` asks for (5.4) and the two
 * that make retrieval possible at all.
 *
 * **It does not blame the parent or the machine.** No "sorry", no "I'm just an
 * assistant": the first is an apology for a question that was probably fine, and
 * the second is a system talking about itself.
 *
 * **The second ask is different from the first**, because repeating a question
 * verbatim reads as not having listened. It offers the shape of an answer.
 *
 * ⚠ New user-facing copy, on the list for the client. Deliberately **not** in
 * `sms-templates.ts` — that file is registered A2P samples where a reword is a
 * compliance event, and this is conversational. Written in GSM-7 (no em dash, no
 * curly quotes) so it costs one segment: measured at 116 and 132 characters.
 */
export function askForDetail(asks: number): string {
  return asks === 0
    ? "Happy to help. What are you looking for, and roughly how old is your child? Even a word or two is enough."
    : "Still not quite there. Try it like this: 'swim classes for a 4 year old in Altadena' - what, who for, and where.";
}

/**
 * What Pando says when it has asked twice and still cannot read it.
 *
 * It promises a person rather than a time, which is the same promise `heldReply`
 * makes and for the same reason: nobody can keep a time during a pilot worked by
 * hand, and a broken "shortly" costs more than an unspecified wait.
 */
export function handingOver(): string {
  return "Let me get a person to look at this - somebody at Pando will read it and come back to you.";
}

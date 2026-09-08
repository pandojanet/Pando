/**
 * M7's exit — what the asker is finally told, in the words the parents used.
 *
 * ## Why this is not `composeAnswer`
 *
 * `lib/answer.ts` composes from **records**: a name, a kind, a neighborhood, a
 * price band, and the trust labels 5.6 computed — arithmetic over structured
 * fields, with no free-text field on `AnswerCandidate` at all, deliberately
 * (11.4). That is what makes it safe to send without a person having read the
 * particular sentence.
 *
 * A Network Ask is the opposite transaction and always has been. Strategy §6 is
 * that three to five matched parents are asked a real question and answer it in
 * their own words, and the asker paid for exactly that. So this forwards the
 * **text**, and the thing that makes it safe is not the shape of the data but
 * the fact that an admin approved each reply — invariant 8 forbids publishing
 * free text about a named person *without human review*, and
 * `blast_response.approve` is that review. ⚠ **So only approved replies may ever
 * reach here.** The caller enforces it; this module cannot see a review status
 * and must not be given one to check, or the check would live in two places.
 *
 * ## Five rules
 *
 * **The count is what was sent, never what was retrieved.** Composed body
 * first, header second, from the replies that actually fit. Getting that
 * backwards is a recorded fault: on 4 Sep the answer composer opened by counting
 * records *before* the budget loop dropped them, and told a parent that ten
 * people had shared something above two lines.
 *
 * **Whole replies are dropped, never truncated.** A message ending mid-sentence
 * is worse than one carrying two answers instead of three — the same rule
 * `composeAnswer` follows, and the reason the budget is checked with the closing
 * line already counted rather than after it.
 *
 * **Ranked by an admin's rating, and a rating is not required.** `quality` is
 * 1–5 where somebody has judged the reply and null where nobody has yet; nulls
 * rank last but are not excluded, because an unrated reply is one nobody has got
 * to, not one that failed. Ties keep the order they arrived in, so the same
 * blast composes the same message twice.
 *
 * **No names.** Not the responders' and not the asker's. The request promises
 * the asker's anonymity in so many words, and nothing anywhere asked a responder
 * whether their name could travel back — being willing to answer a question is
 * not consent to be identified to whoever asked it.
 *
 * **Nothing to say is `null`, never an empty message.** No replies, or none that
 * fit, and the caller sends nothing at all rather than a bare header — which
 * would read as "we asked and nobody helped" to somebody who paid.
 *
 * ⚠ Every string here is new user-facing copy and is on the list for the
 * client. It is deliberately **not** in `lib/sms-templates.ts`: that file is
 * registered A2P sample copy where a reword is a compliance event, and the three
 * registered samples are the verification code, the blast *request* and the
 * thank-you. The same call `CLARIFYING_COPY` and `heldReply` already make.
 *
 * ⚠ And it is GSM-7 throughout — straight quotes, a hyphen and no em dash. One
 * character outside that alphabet moves the whole message to UCS-2 and cuts the
 * per-segment budget from 153 to 67, so a three-segment answer becomes seven.
 * `test:blast` pins the encoding; `lib/sms-segments.ts` is why.
 */

export interface BlastReply {
  /** What the parent texted back, as approved. */
  text: string;
  /** An admin's 1-5 rating, or null where nobody has rated it yet. */
  quality: number | null;
}

export interface ComposedBlastAnswer {
  text: string;
  /** How many replies the message actually carries. */
  used: number;
  /** How many were approved and did not fit, so the caller can log the gap. */
  dropped: number;
}

/** One reply, on its own line, in the parent's own words. */
function line(reply: string): string {
  /* A parent's newline would turn one answer into two lines that read as two
     answers, and their double spaces would survive into the message. */
  const flat = reply.replace(/\s+/g, " ").trim();
  return `"${flat}"`;
}

function header(used: number): string {
  return used === 1
    ? "One parent answered your question:"
    : `${used} parents answered your question:`;
}

/**
 * The closing line, and it is not decoration.
 *
 * It is the only place the asker is told these are matched local parents rather
 * than anything Pando generated, which is the whole claim they paid for — and
 * invariant 3's rule that a source is always stated, arriving on the one path
 * where the source is a person rather than a record.
 */
const CLOSING = "These are local parents Pando matched to your question.";

export function composeBlastAnswer(input: {
  replies: BlastReply[];
  /**
   * The character budget — `SMS_BUDGET`, **passed in rather than imported**.
   *
   * A runtime `import { SMS_BUDGET } from "./answer"` is what stops this module
   * loading in plain node (`node --experimental-strip-types` will not resolve an
   * extensionless relative specifier), and `test:blast` runs exactly that way.
   * The same trade `readFindings` makes with its person check and `claimsAParent`
   * with its labels: **required**, not optional, so no call site can silently get
   * a different budget from the rest of the product.
   */
  budget: number;
}): ComposedBlastAnswer | null {
  const budget = input.budget;

  const ranked = input.replies
    .map((reply, i) => ({ reply, i }))
    .filter(({ reply }) => reply.text.trim().length > 0)
    /* Rated first, best first; unrated last but never dropped. `i` keeps ties
       in arrival order, so the message is the same on a second send. */
    .sort((a, b) => {
      const qa = a.reply.quality ?? -1;
      const qb = b.reply.quality ?? -1;
      return qb - qa || a.i - b.i;
    })
    .map(({ reply }) => reply);

  if (ranked.length === 0) return null;

  /**
   * The header is not known until the body is, because it counts what fits —
   * so the budget is measured against the *longest possible* header rather
   * than the real one. Two characters of slack on a 459-character message,
   * and it is what stops a body that fits under "2 parents" overflowing when
   * the header turns out to be "10 parents".
   */
  const reserved = header(ranked.length).length + CLOSING.length + 4;

  const lines: string[] = [];
  let length = reserved;
  let dropped = 0;
  for (const reply of ranked) {
    const rendered = line(reply.text);
    const cost = rendered.length + 1;
    if (length + cost > budget) {
      dropped += 1;
      continue;
    }
    lines.push(rendered);
    length += cost;
  }

  if (lines.length === 0) return null;

  return {
    text: `${header(lines.length)}\n\n${lines.join("\n")}\n\n${CLOSING}`,
    used: lines.length,
    dropped,
  };
}

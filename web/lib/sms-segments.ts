/**
 * M13.3 — what a message actually costs to send, and where it breaks.
 *
 * The estimate's words are "correctly handles the ~160-character segmentation
 * and reassembly of longer messages", and the "~" is doing a lot of work: 160 is
 * the GSM-7 single-segment limit, and almost nothing about it survives contact
 * with real copy.
 *
 * ## The four numbers, and why one wrong character halves the budget
 *
 * SMS has two encodings and the carrier picks by content:
 *
 * | Encoding | One segment | Each segment when concatenated |
 * | -------- | ----------- | ------------------------------ |
 * | GSM-7    | 160 chars   | 153 (7 chars go to the header) |
 * | UCS-2    | 70 chars    | 67                             |
 *
 * A message is GSM-7 only if **every** character is in the GSM 03.38 alphabet.
 * One character outside it — a curly apostrophe, an em dash, an ellipsis, an
 * emoji — moves the whole message to UCS-2 and cuts the budget from 160 to 70.
 *
 * **That is not a hypothetical for Pando.** The design system says "Em dashes are
 * fine", the copy voice uses curly quotes throughout, and `lib/sms-templates.ts`
 * holds registered copy written in exactly that voice. A template that reads as
 * 150 characters of plain English is a **three-segment** message if one of them
 * is a `—`, and the parent is charged for three while Pando's logs say one.
 *
 * Seven characters are in GSM-7 but occupy **two** slots because they are sent
 * as an escape pair: `^ { } [ ] ~ \` and the euro sign. So even a pure-GSM
 * message is not `length`.
 *
 * ## What this module is for, and what it deliberately does not do
 *
 * It **measures**, and it offers a **split**. It does not silently rewrite copy:
 * `sms-templates.ts` holds text registered with the carrier as A2P samples, and
 * "correctly handles" cannot mean "quietly replaced the client's em dash with a
 * hyphen" — that would change registered wording without anybody deciding to.
 *
 * So the caller gets the facts and decides. `sendSms` logs a warning when a
 * message is about to cost more segments than its own text suggests, and
 * `npm run test:segments` asserts that every registered template still fits the
 * budget it was written for — which is the check that catches a copy edit
 * turning a one-segment text into three before it reaches a carrier bill.
 *
 * Pure: no imports, so a plain node test can load it.
 */

export type SmsEncoding = "gsm7" | "ucs2";

export const GSM7_SINGLE = 160;
export const GSM7_CONCATENATED = 153;
export const UCS2_SINGLE = 70;
export const UCS2_CONCATENATED = 67;

/**
 * The GSM 03.38 basic alphabet, as one string.
 *
 * Written out rather than computed from ranges because it is not a range: it
 * interleaves Latin letters, a handful of Greek capitals that happen to be
 * encodable, currency symbols and accented vowels in an order that only makes
 * sense as a table. Getting it from a range would be a guess.
 */
const GSM7_BASIC =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?" +
  "¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";

/**
 * The seven that cost two slots each: they are sent as an escape byte followed
 * by the character, so a message of 160 `~` is two segments, not one.
 */
const GSM7_EXTENDED = "^{}\\[~]|€";

const BASIC = new Set([...GSM7_BASIC]);
const EXTENDED = new Set([...GSM7_EXTENDED]);

/** Can this whole message travel as GSM-7? One stray character says no. */
export function encodingFor(body: string): SmsEncoding {
  for (const ch of body) {
    if (!BASIC.has(ch) && !EXTENDED.has(ch)) return "ucs2";
  }
  return "gsm7";
}

/**
 * How many slots a message occupies, which is not its length.
 *
 * GSM-7: one per character, two for each of the extended seven.
 * UCS-2: one per **UTF-16 code unit**, which is what the wire actually carries —
 * so an emoji outside the BMP is two, and a family emoji built from four
 * code points joined by zero-width joiners can be eleven. Counting characters
 * there would under-report a message by more than half.
 */
export function slotsFor(body: string, encoding = encodingFor(body)): number {
  if (encoding === "ucs2") return body.length;
  let slots = 0;
  for (const ch of body) slots += EXTENDED.has(ch) ? 2 : 1;
  return slots;
}

export interface SegmentPlan {
  encoding: SmsEncoding;
  /** Slots used, per the rules above. Never the string's length. */
  slots: number;
  /** What the carrier will bill and the handset will reassemble. */
  segments: number;
  /** Slots left before the next segment starts. */
  headroom: number;
  /**
   * The characters that forced UCS-2, de-duplicated and in order of first
   * appearance. Empty for a GSM-7 message.
   *
   * Reported because "this is three segments" is not actionable and "this is
   * three segments because of the em dash and the curly apostrophe" is.
   */
  offenders: string[];
}

/** Everything worth knowing about sending one body, in one call. */
export function planSegments(body: string): SegmentPlan {
  const encoding = encodingFor(body);
  const slots = slotsFor(body, encoding);
  const single = encoding === "gsm7" ? GSM7_SINGLE : UCS2_SINGLE;
  const concat = encoding === "gsm7" ? GSM7_CONCATENATED : UCS2_CONCATENATED;

  const segments = slots === 0 ? 0 : slots <= single ? 1 : Math.ceil(slots / concat);
  const capacity = segments <= 1 ? single : segments * concat;

  const offenders: string[] = [];
  if (encoding === "ucs2") {
    const seen = new Set<string>();
    for (const ch of body) {
      if (BASIC.has(ch) || EXTENDED.has(ch) || seen.has(ch)) continue;
      seen.add(ch);
      offenders.push(ch);
    }
  }

  return { encoding, slots, segments, headroom: capacity - slots, offenders };
}

/**
 * The same message written to fit GSM-7, or null when it already does.
 *
 * **Offered, never applied automatically.** Every substitution here is a
 * *typographic* one — a curly quote for a straight one, three dots for an
 * ellipsis, a hyphen for a dash — and none of them changes a word. That is the
 * line: this function will not drop an emoji, will not shorten a sentence, and
 * returns null the moment it cannot reach GSM-7 without doing either. A caller
 * that gets null has a message that genuinely needs UCS-2, and the honest answer
 * is a shorter message rather than a silently mangled one.
 *
 * It exists for the composed answers (5.7), where the text is assembled from
 * records at runtime and nobody registered it with a carrier. **It is never
 * applied to `sms-templates.ts`**: that copy is registered, and A2P §3.7's rule
 * is that what is registered and what is sent must match.
 */
const TYPOGRAPHIC: Array<[RegExp, string]> = [
  [/[‘’‛]/g, "'"], // ' ' ‛
  [/[“”‟]/g, '"'], // " " ‟
  [/…/g, "..."], // …
  [/[–—−]/g, "-"], // – — −
  [/ /g, " "], // non-breaking space
  [/•/g, "*"], // •
  [/·/g, "."], // ·
  [/→/g, "->"], // →
];

export function toGsm7(body: string): string | null {
  if (encodingFor(body) === "gsm7") return null;
  let out = body;
  for (const [pattern, replacement] of TYPOGRAPHIC) out = out.replace(pattern, replacement);
  return encodingFor(out) === "gsm7" ? out : null;
}

/**
 * Split a body across segments the way a handset will reassemble it.
 *
 * ## Why this exists at all, given that Twilio concatenates for you
 *
 * It does, and for an ordinary message that is the right answer — one API call,
 * one UDH header, one reassembled message on the handset. This is for the case
 * the estimate's word "reassembly" is really about: **a handset that does not
 * reassemble.** Concatenation is a carrier feature, and when it fails the
 * recipient sees the message in pieces, in whatever order they arrived, with no
 * indication that there are more.
 *
 * So a caller that knows its audience is on a route where that happens can send
 * the pieces itself, numbered. The numbering is the whole point: "(1/3)" is what
 * makes three texts arriving out of order still readable.
 *
 * **Splitting on whitespace, never mid-word**, and the marker is counted against
 * the budget before the split rather than appended after — appending it is how a
 * "fits in one segment" piece becomes two.
 */
export function splitForSms(body: string, opts?: { number?: boolean }): string[] {
  const numbered = opts?.number !== false;
  const plan = planSegments(body);
  if (plan.segments <= 1) return [body];

  const concat = plan.encoding === "gsm7" ? GSM7_CONCATENATED : UCS2_CONCATENATED;
  /* Room for " (n/m)" at the widest plausible count. Reserved up front for the
     reason above; 8 slots covers "(10/10)" plus its leading space. */
  const budget = numbered ? concat - 8 : concat;
  if (budget <= 0) return [body];

  const words = body.split(/(\s+)/);
  const pieces: string[] = [];
  let current = "";

  const fits = (candidate: string) => slotsFor(candidate, plan.encoding) <= budget;

  for (const token of words) {
    if (token === "") continue;
    if (fits(current + token)) {
      current += token;
      continue;
    }
    if (current.trim() !== "") pieces.push(current.trim());
    /* A single word longer than a whole segment — a URL, usually. It is cut,
       because the alternative is a piece that overflows and gets split by the
       carrier at a worse place. */
    if (!fits(token)) {
      let rest = token;
      while (!fits(rest)) {
        let cut = rest.length;
        while (cut > 0 && !fits(rest.slice(0, cut))) cut--;
        if (cut === 0) break;
        pieces.push(rest.slice(0, cut));
        rest = rest.slice(cut);
      }
      current = rest;
    } else {
      current = token.trimStart();
    }
  }
  if (current.trim() !== "") pieces.push(current.trim());

  if (!numbered || pieces.length <= 1) return pieces;
  return pieces.map((piece, i) => `${piece} (${i + 1}/${pieces.length})`);
}

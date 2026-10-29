/**
 * Introductions (21 Oct) — parent to parent, through a person at Pando.
 *
 * The client: not only caregiver → parent, but parent ↔ parent, in the context
 * of a recommendation (activities, places, camps; doctors once they reach SMS
 * answers). Her example: a parent asks about an activity, Pando answers and
 * adds *"by the way, a couple of people in your neighborhood go there too, want
 * an introduction?"*.
 *
 * The developer's process (21 Oct): the parent can leave a request after a
 * recommendation; an admin approves it, contacts the other parent and, if they
 * agree, creates the chat **outside the app**. Pando's part is the request and
 * the **statuses**, so everybody can see how a request is going:
 *
 *   offered → requested → approved → contacted → connected
 *                       ↘ rejected   ↘ rejected  ↘ declined (the other parent said no)
 *
 * Nothing about either parent is passed to the other by Pando: the admin asks
 * the parent who has been there first, and only their yes leads to a chat.
 * Contact details never leave the admin (no SMS here carries a name or number).
 *
 * No runtime imports: `test:intro` loads this module directly.
 */

export const INTRO_STATUSES = [
  "offered",
  "requested",
  "approved",
  "contacted",
  "connected",
  "declined",
  "rejected",
] as const;
export type IntroStatus = (typeof INTRO_STATUSES)[number];

/** Which move an admin may make from where a request is — the action route reads this. */
export const INTRO_MOVES: Record<string, { from: IntroStatus[]; to: IntroStatus }> = {
  "intro.approve": { from: ["requested"], to: "approved" },
  "intro.reject": { from: ["requested", "approved"], to: "rejected" },
  "intro.contacted": { from: ["approved"], to: "contacted" },
  "intro.connected": { from: ["contacted"], to: "connected" },
  "intro.declined": { from: ["contacted"], to: "declined" },
};

export function canMove(action: string, from: string): boolean {
  const move = INTRO_MOVES[action];
  return !!move && (move.from as string[]).includes(from);
}

/** What the admin reads for each status. */
export const INTRO_STATUS_LABEL: Record<IntroStatus, string> = {
  offered: "Offered, no reply",
  requested: "Asked for an introduction",
  approved: "Approved: contact a parent",
  contacted: "Waiting on the other parent",
  connected: "Connected",
  declined: "The other parent said no",
  rejected: "Not taken forward",
};

/** Requests a person still has to move. */
export const INTRO_OPEN: IntroStatus[] = ["requested", "approved", "contacted"];

/* ------------------------------------------------------------------ triggers */

/** The reply that takes an offer: INTRO, "intro please", "yes intro". */
export function acceptsIntro(text: string): boolean {
  return /^\s*(yes[,!.]?\s*)?(intro|introduce me|introduction|intro please|please intro)\s*(please)?\s*[.!]*\s*$/i.test(text);
}

/**
 * "INTRO Little Maestros", "intro for the swim class" — which record, when the
 * parent says. Null for a bare INTRO, and for a question ("intro to coding
 * classes?"), which is answered as a question.
 */
export function introTarget(text: string): string | null {
  if (text.includes("?")) return null;
  const m = text.match(/^\s*(?:yes[,!.]?\s*)?(?:intro|introduce me)(?:\s+(?:to|for|at|about|with|on))?\s+(.+?)[.!]*\s*$/i);
  if (!m) return null;
  const name = m[1].replace(/^(someone|somebody|a parent|one of them|them)\s+(at|from|who goes to|who's been to)\s+/i, "").trim();
  return name.length >= 3 && !/^(please|pls|thanks?)$/i.test(name) ? name : null;
}

/** "Can you introduce me to a parent who goes there?" — an explicit request. */
export function asksForIntro(text: string): boolean {
  /* A parent, said: "intro to ballet classes?" and "connect me with a good
     pediatrician" are questions, and were taken for intro requests (review,
     21 Oct). */
  return /\b(introduce me to (a|another|one of the|that|the) (parent|mom|dad)s?|(put me in touch|connect me) with (one of them|(a|another|one of the|that|the) (parent|mom|dad)s?)|(talk|speak) (to|with) (a|another|one of the|that|the) (parent|mom|dad)s?)\b/i.test(
    text,
  );
}

/** An offer stays open a week; a parent is offered at most once a week. */
export const INTRO_OFFER_DAYS = 7;
export const INTRO_OFFER_GAP_DAYS = 7;
/**
 * An explicit request reads the answers the parent was sent in the last two
 * weeks (21 Oct: "to any answer"), the record they name first, else the most
 * recent answer's first record with somebody to ask.
 */
export const INTRO_EXPLICIT_DAYS = 14;

/* ---------------------------------------------------------------------- copy */

/* Conversational copy (not registered A2P samples), on the list for the
   client. GSM-7, no names of the other parents, ever. */

function gsmSafe(text: string): string {
  return text
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/[^\x20-\x7E]/g, gsmLetter)
    .replace(/[`[\]{}|^~\\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/* The accented letters GSM-7 carries in one slot stay ("La Cañada"); any
   other one loses its accent ("á" → "a"), and the rest is dropped. Same rule
   as `lib/deep-dive.ts`. */
const GSM_LETTERS = "£¥èéùìòÇØøÅåÆæßÉ¡¿ÄÖÑÜ§äöñüà";
function gsmLetter(c: string): string {
  if (GSM_LETTERS.includes(c)) return c;
  const bare = c.normalize("NFKD").replace(/[̀-ͯ]/g, "");
  return /^[\x20-\x7E]+$/.test(bare) ? bare : "";
}

/**
 * The offer, appended to an answer. `others` is how many parents who have been
 * there, other than the asker, could be asked — the client's "a couple".
 */
export function introOffer(place: string, others: number): string {
  /* "Used", which fits a doctor and a product as well as a place; and not "near
     you" - nothing checks where they live (review, 21 Oct). */
  const who = others === 1 ? "a parent Pando knows has" : others === 2 ? "a couple of parents Pando knows have" : `${others} parents Pando knows have`;
  const name = gsmSafe(place);
  return `By the way, ${who} used ${name || "it"}. Want an introduction? Reply INTRO and someone at Pando will ask them first.`;
}

/** The offer as an RCS card says it, under an "Intro" button (29 Oct): only "Reply INTRO and" goes. */
export function introOfferCard(place: string, others: number): string {
  return introOffer(place, others).replace("Reply INTRO and someone", "Someone");
}

export const INTRO_REQUESTED =
  "Thanks. Someone at Pando will ask a parent who's used it, and put you two in touch only if they say yes.";

export const INTRO_NOTHING =
  "I don't have a parent to introduce you to for that yet. Ask me for a recommendation first and I'll see who's used it.";

export const INTRO_ALREADY = "You've already asked for that introduction. Someone at Pando is on it.";

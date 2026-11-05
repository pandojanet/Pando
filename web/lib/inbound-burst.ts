import type { InboundMedia } from "@/lib/media-note";

/**
 * Several texts in a row are one message (4 Nov).
 *
 * People text the way they talk: *"Hi"*, *"looking for swim lessons"*, *"for
 * my 4 year old, in Altadena"* — three webhooks a second or two apart, and one
 * thought. Answered one by one (the developer, in the SMS lab, 4 Nov) they got
 * three replies: a welcome to "Hi", an answer about swim lessons anywhere, and
 * a question asking where they live — the place they had just typed. A picture
 * and its words arrive the same way: RCS, and many phones over MMS, send the
 * text as a message of its own, so the picture was read with no question and
 * the question answered with no picture.
 *
 * So a message waits a moment for the rest of the thought: **a burst closes
 * after `BURST_QUIET_MS` with nothing new from that number, or at
 * `BURST_MAX_MS` from its first message**, whichever comes first. The message
 * that closes it carries all of them, in order, through the pipeline as one —
 * the texts joined line by line, and a picture or voice note with every text
 * as its words. The others end there, without a reply of their own.
 *
 * ## In the process's memory, on purpose
 *
 * The bursts live in this module, not the database: Pando runs one web
 * process (deploy/docker-compose.yml), a burst is seconds long, and holding
 * the words of a message in a table — even briefly — is what invariant 7 is
 * careful about. The cost is named: a restart inside those seconds drops the
 * burst unanswered. A second process would need this moved to Postgres.
 *
 * Pure apart from the clock, so `npm run test:burst` runs it with short timings.
 */

export type BurstPart = { body: string; channel?: "rcs" | "sms"; media?: InboundMedia };

/** Long enough to type the next line of a thought; short enough not to feel slow. */
export const BURST_QUIET_MS = 5_000;
/** Someone texting line after line is still answered within this of their first. */
export const BURST_MAX_MS = 20_000;

/* The same order a single message's media is picked in (`inboundMediaFrom`): words first. */
const MEDIA_RANK: Record<InboundMedia["kind"], number> = { voice: 0, image: 1, file: 2 };

/** Lines that only thank or acknowledge — nothing to act on beside the rest. */
export const ACKNOWLEDGEMENT =
  /^(?:(?:thanks?|thank you|thx|ty|great|perfect|cool|ok(?:ay)?|sure|awesome|nice|got it|sounds good|appreciate it)[\s!.,]*)+$/i;

/* A reply Pando matches whole: to a ping, a "did it help?", an offer, a read-back, a choice. */
/* And a yes or no with a short clause after it — "no, we never went" — that asks nothing (5 Nov). */
function shortReply(text: string): boolean {
  const match = /^(?:yes|yeah|yep|yup|no|nope|nah)\b[\s,.!-]+(.+)$/i.exec(text);
  if (!match) return false;
  const rest = match[1];
  return !/\?|\bbut\b|\bthough\b|\bexcept\b/i.test(rest) && rest.trim().split(/\s+/).length <= 6;
}
const BARE_REPLY = /^(?:yes|y|yep|yeah|yup|sure|no|nope|nah|n|pass|deep|intro|none|[123])[.!]*$/i;

/**
 * A burst, before it is one message (review, 4 Nov). Two things a burst used
 * to break: a reply Pando matches whole ("yes" to a freshness ping, "2" to the
 * participation question, "DEEP" to an offer) stopped matching once a
 * question or a "thanks" was joined to it — the ping stayed open, the choice
 * was lost — and a "thanks" after a reply did the same. So texts that only
 * thank are set aside when there is anything else, and a bare reply leading
 * the burst is its own turn, ahead of the rest.
 */
export function splitBurst(parts: BurstPart[]): { reply: BurstPart | null; rest: BurstPart[] } {
  const said = parts.filter((p) => p.media || !ACKNOWLEDGEMENT.test(p.body.trim()));
  const kept = said.length > 0 ? said : parts;
  const [first, ...others] = kept;
  if (first && !first.media && (BARE_REPLY.test(first.body.trim()) || shortReply(first.body.trim())) && others.length > 0) {
    return { reply: first, rest: others };
  }
  return { reply: null, rest: kept };
}

/**
 * A burst as the one message it is. The texts are its words — a picture's
 * caption, a voice note's lead — and of several media the one read is the one
 * `inboundMediaFrom` would have picked; the rest are `unused`, for the caller
 * to delete at Twilio.
 */
export function combineBurst(parts: BurstPart[]): {
  body: string;
  channel?: "rcs" | "sms";
  media?: InboundMedia;
  unused: string[];
} {
  const body = parts
    .map((p) => p.body.trim())
    .filter(Boolean)
    .join("\n");
  const media = parts.flatMap((p) => (p.media ? [p.media] : []));
  /* A picture Claude can open before one it cannot. */
  const rank = (m: InboundMedia) => MEDIA_RANK[m.kind] + (m.unsupported ? 0.5 : 0);
  const first = media.reduce<InboundMedia | undefined>((best, m) => (!best || rank(m) < rank(best) ? m : best), undefined);
  /* Pictures sent one per message are read together, as if sent in one (review,
     4 Nov: the second screenshot of a schedule was dropped). */
  const together =
    first && first.kind === "image" && !first.unsupported
      ? media.filter((m) => m !== first && m.kind === "image" && !m.unsupported)
      : [];
  const also = [...(first?.also ?? []), ...together.flatMap((m) => [{ url: m.url, contentType: m.contentType }, ...(m.also ?? [])])];
  const read = first ? { ...first, ...(also.length ? { also } : {}) } : undefined;
  const left = media.filter((m) => m !== first && !together.includes(m));
  return {
    body,
    channel: parts.findLast((p) => p.channel)?.channel,
    media: read,
    /* Everything not read, its own unread items included, to delete at Twilio. */
    unused: [
      ...left.flatMap((m) => [m.url, ...(m.also ?? []).map((x) => x.url), ...(m.unread ?? [])]),
      ...together.flatMap((m) => m.unread ?? []),
    ],
  };
}

const turns = new Map<string, Promise<unknown>>();
/* Bumped by `endTurns`: a turn queued before it does not run. */
const generation = new Map<string, number>();

/**
 * One turn at a time per number. A text that comes in after its burst closed
 * — typed slowly, while Pando was still answering the first — waits for that
 * answer to be stored, so it is read as the follow-up it is ("for my 6 year
 * old in South Pasadena" after "looking for a music class"), not beside it
 * with nothing to follow. A failed turn does not hold up the next.
 */
export async function oneAtATime<T>(from: string, run: () => Promise<T>): Promise<T | undefined> {
  const before = turns.get(from) ?? Promise.resolve();
  const gen = generation.get(from) ?? 0;
  const mine = before.catch(() => undefined).then(() => ((generation.get(from) ?? 0) === gen ? run() : undefined));
  const tail = mine.catch(() => undefined);
  turns.set(from, tail);
  try {
    return await mine;
  } finally {
    if (turns.get(from) === tail) turns.delete(from);
  }
}

/**
 * DELETE or STOP ends whatever that number still had in hand (review, 4 Nov):
 * a burst still gathering is dropped — its messages return null and are never
 * answered — and turns waiting in the queue do not run. Without it, "looking
 * for swim lessons" then "DELETE" two seconds later deleted the parent, and
 * the closing burst recreated them and stored the question. The media of a
 * dropped burst is handed back, for the caller to delete at Twilio.
 */
export function endTurns(from: string): string[] {
  generation.set(from, (generation.get(from) ?? 0) + 1);
  const burst = open.get(from);
  open.delete(from);
  return burst ? burst.parts.flatMap((p) => (p.media ? [p.media.url] : [])) : [];
}

type Open = { parts: BurstPart[]; seq: number; first: number };
const open = new Map<string, Open>();

/** Whether a burst from this number is still gathering. */
export function burstOpen(from: string): boolean {
  return open.has(from);
}

/**
 * Adds a message to its sender's burst and waits. Resolves with the whole
 * burst for the message that closes it, and with null for every other one —
 * the closing message carries it.
 */
export async function gatherBurst(
  from: string,
  part: BurstPart,
  timing: { quietMs: number; maxMs: number } = { quietMs: BURST_QUIET_MS, maxMs: BURST_MAX_MS },
): Promise<BurstPart[] | null> {
  let burst = open.get(from);
  if (!burst) {
    burst = { parts: [], seq: 0, first: Date.now() };
    open.set(from, burst);
  }
  burst.parts.push(part);
  const mine = ++burst.seq;
  const left = burst.first + timing.maxMs - Date.now();
  await new Promise((resolve) => setTimeout(resolve, Math.max(0, Math.min(timing.quietMs, left))));
  /* Already taken by a message that closed it at the cap. */
  if (open.get(from) !== burst) return null;
  const capped = Date.now() - burst.first >= timing.maxMs;
  if (burst.seq !== mine && !capped) return null;
  open.delete(from);
  return burst.parts;
}

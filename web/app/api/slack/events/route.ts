import { NextResponse } from "next/server";
import { toE164 } from "@/lib/phone";
import { readSlackMessage } from "@/lib/slack-text";
import { keywordOf } from "@/lib/sms-templates";
import { handleInboundMessage } from "@/lib/server/inbound";
import { personForThread } from "@/lib/server/repo/relay";
import {
  checkSlackSignature,
  isSlackRelayEnabled,
  slackBotUserId,
} from "@/lib/server/slack";

/**
 * The Slack relay's inbound door — the temporary stand-in for
 * `/api/sms/inbound`, so the whole conversation loop can be driven from one
 * channel before a real parent is texted.
 *
 * It does the two things a transport owns, and nothing else: **prove the request
 * is Slack's**, and work out **which parent** the message is from. Then
 * `handleInboundMessage` runs the same pipeline Twilio's door runs — same
 * keyword precedence, same capture, same blast attachment, same tie-break
 * between a freshness "yes" and a did-it-help "yes". A second copy of that logic
 * is the one duplication this codebase cannot afford.
 *
 * ## How a message in one channel becomes a message from one parent
 *
 * **A threaded reply is the normal case.** Every outbound relay post is
 * addressed to somebody and its Slack `ts` is stored as that message's
 * `provider_message_id`, so a reply inside the thread resolves through
 * `personForThread` to the phone number the pipeline works in. Threading is not
 * cosmetic here — it is the entire addressing scheme.
 *
 * **A top-level message can name a number.** `+16265550143: hello` is how a
 * *cold* inbound gets tested (5.9 — a stranger who was forwarded an answer and
 * texted the number). Without it that path would be unreachable from Slack,
 * because a stranger has no thread yet by definition. ⚠ Slack **linkifies** a
 * phone number, so what arrives is `<tel:+16265550143|+16265550143>: hello` and
 * the raw text never matched — `lib/slack-text.ts` undoes that, and its header
 * records what the silence looked like.
 *
 * Anything else in the channel is ignored, deliberately: a human talking to
 * another human is not an inbound text, and guessing would file somebody's aside
 * as a parent's answer.
 *
 * ## Three refusals worth keeping
 *
 * **The bot's own posts are ignored.** Without that, Pando answering a message
 * would see its own answer as a new inbound and answer that — an infinite loop
 * that would spend every contributor's monthly allowance in seconds.
 *
 * **Unconfigured refuses**, the same fail-closed rule as the Twilio signature:
 * an events endpoint that skips verification when the signing secret is missing
 * is unauthenticated the moment somebody mis-deploys, and behind it is the path
 * that can opt somebody out or write a contribution.
 *
 * **The relay being off is a 404, not a silent 200.** If this is reachable while
 * `MESSAGING_RELAY` is not `slack`, the deployment is in a state nobody chose,
 * and answering "fine" would hide it.
 *
 * ## Why it always answers 200 otherwise
 *
 * Slack retries a non-2xx, and a retry duplicates whatever the pipeline already
 * did — a second log row, a second capture answer. So every outcome the route
 * *understands* is a 200, including "I ignored that".
 */

/** Slack wants the challenge echoed verbatim when the URL is first configured. */
interface SlackEnvelope {
  type?: string;
  challenge?: string;
  event?: {
    type?: string;
    subtype?: string;
    text?: string;
    user?: string;
    bot_id?: string;
    channel?: string;
    ts?: string;
    thread_ts?: string;
  };
}

export async function POST(request: Request) {
  if (!isSlackRelayEnabled()) {
    return NextResponse.json({ error: "Relay is not enabled" }, { status: 404 });
  }

  /* The raw body, before any parsing: Slack signs the bytes it sent, and
     re-serialising a parsed object changes key order and breaks the signature. */
  const raw = await request.text();

  const verdict = checkSlackSignature({
    rawBody: raw,
    timestamp: request.headers.get("x-slack-request-timestamp"),
    signature: request.headers.get("x-slack-signature"),
  });
  if (!verdict.ok) {
    console.warn("[slack:events] refused", { reason: verdict.reason });
    return NextResponse.json({ error: "Unverified" }, { status: 403 });
  }

  const envelope = (() => {
    try {
      return JSON.parse(raw) as SlackEnvelope;
    } catch {
      return null;
    }
  })();
  if (!envelope) return NextResponse.json({ ok: true });

  /* The one-time handshake when the URL is saved in Slack's app config. */
  if (envelope.type === "url_verification" && envelope.challenge) {
    return NextResponse.json({ challenge: envelope.challenge });
  }

  const event = envelope.event;
  if (!event || event.type !== "message") return NextResponse.json({ ok: true });

  /* Our own posts, edits and joins — none of them is a parent saying something.
     The bot check is the one that matters: without it Pando answers itself. */
  const botId = slackBotUserId();
  if (event.bot_id || (botId && event.user === botId) || event.subtype) {
    return NextResponse.json({ ok: true });
  }

  /* Slack's own markup, undone before anything reads it — the address, the
     keyword and the parent's free text are all wrong without this. */
  const { text, addressed: named } = readSlackMessage(event.text ?? "");
  if (text === "") return NextResponse.json({ ok: true });

  /* A threaded reply belongs to whoever that thread was addressed to; a
     top-level message has to name its sender. `thread_ts === ts` is Slack's way
     of saying "this *is* the root", which is not a reply to anything of ours. */
  const inThread = event.thread_ts && event.thread_ts !== event.ts;
  const resolved = inThread ? await personForThread(event.thread_ts!) : null;
  /* `readSlackMessage` hands back the number as written; whether it *is* one is
     `toE164`'s answer, and it stays out of that module so the module stays
     importable by a plain-node test. */
  const addressedPhone = resolved || !named ? null : toE164(named.raw);
  const addressed = addressedPhone ? { phone: addressedPhone, body: named!.body } : null;

  const from = resolved?.phone ?? addressed?.phone ?? null;

  /**
   * ⚠ **The prefix is stripped inside a thread too, and this one reached the
   * database.** A threaded reply needs no address — the thread *is* the address
   * — so the whole message was taken as the body. A tester replying in-thread
   * out of habit typed `+16265550005: Sierra Madre Tumbling`, and the capture
   * stored that entire string as the record's **name**: a phone number one step
   * from `shares.name`, which is the one field published to other parents. It
   * got no further only because that capture never completed.
   *
   * Nothing a real parent texts begins with seven-to-twenty digits and a colon,
   * so stripping it costs nothing and the transport stops depending on the
   * tester remembering which kind of message they are writing.
   */
  const body = resolved ? (named?.body ?? text) : (addressed?.body ?? "");

  if (!from || body.trim() === "") {
    /* Counts and enums only. "Somebody said something in the channel" is not an
       event Pando has an opinion about. */
    console.info("[slack:events] ignored", {
      threaded: Boolean(inThread),
      resolved: Boolean(resolved),
      addressed: Boolean(addressed),
    });
    return NextResponse.json({ ok: true });
  }

  console.info("[slack:events]", {
    keyword: keywordOf(body) ?? "text",
    length: body.length,
    via: resolved ? "thread" : "addressed",
  });

  await handleInboundMessage({ from, body });
  return NextResponse.json({ ok: true });
}

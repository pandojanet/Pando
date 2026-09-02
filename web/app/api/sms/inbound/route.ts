import { NextResponse } from "next/server";
import {
  SMS_TEMPLATE_VERSION,
  keywordOf,
  helpSms,
  optInConfirmationSms,
} from "@/lib/sms-templates";
import { toE164 } from "@/lib/phone";
import { verifyTwilioSignature } from "@/lib/server/twilio-signature";
import { fallbackIntent } from "@/lib/intent";
import {
  isSettingsCommand,
  parseAllowanceChoice,
  settingsConfirmation,
  settingsPrompt,
} from "@/lib/outreach-policy";
import { attachResponse, recordPass } from "@/lib/server/repo/blast";
import { yesOrNo } from "@/lib/thanks";
import { readPingReply } from "@/lib/vouch";
import { applyPingReply, pendingPing } from "@/lib/server/repo/vouch";
import {
  CAPTURE_QUESTIONS,
  captureSavedSms,
  caregiverRedirectSms,
  isCaptureCancel,
  isCaptureStart,
  mentionsCaregiver,
  readAnswer,
} from "@/lib/capture";
import {
  cancelCapture,
  openCapture,
  saveAnswer,
  saveCapturedCard,
  startCapture,
} from "@/lib/server/repo/capture";
import { pendingHelpedAnswer, recordHelped } from "@/lib/server/repo/thanks";
import {
  SETTINGS_TEMPLATE,
  awaitingSettingsChoice,
  currentAllowance,
  ensureInboundPerson,
  marketAreas,
  pendingClarification,
  saveClarification,
  setAllowance,
} from "@/lib/server/repo/onboarding";
import { recordInbound, setOptOut } from "@/lib/server/repo/outreach";
import { sendSms } from "@/lib/server/sms";

/**
 * M13.2 — the inbound webhook, and M12.3/12.4's precedence.
 *
 * Twilio POSTs every inbound text here. What this route does *first* is the whole
 * of 12.3: **a keyword is handled before anything else looks at the message, and
 * never reaches the AI.** The estimate says so in 5.3's own description ("opt-out
 * keywords are handled before this step and never reach the AI"), and the reason
 * is that a classifier is a probabilistic thing: it will one day read STOP as a
 * conversational aside, and that is a compliance failure rather than a bad answer.
 *
 * ## The order, and why each step is where it is
 *
 * 1. **Signature.** Everything below acts on what the request claims, so nothing
 *    below may run on an unverified one.
 * 2. **Keyword.** STOP and friends, then START, then HELP.
 * 3. **Log.** The inbound row, with `responded_to` when it answers an outreach —
 *    which is what the response-rate governor counts.
 * 4. **Ordinary text** — the sender is ensured (5.9), the message is logged and
 *    linked, a settings command is answered (8.3), a reply to a Network Ask is
 *    attached (7.5), and an answer to a clarifying question is saved back (5.4).
 *
 * Nothing is answered *from this route*, and that has not changed now that 5.7
 * exists: an answer is composed, held by 5.8 and read by a person in the queue
 * (14.2) before it goes out. A route that replied here would be the unread
 * AI-adjacent answer the whole product promises never to send.
 *
 * ## Why it always answers 200 with empty TwiML
 *
 * A non-2xx makes Twilio retry, and a retry of a STOP is harmless while a retry
 * of anything else duplicates a log row. The one exception is a bad signature,
 * which is a 403: that request was not Twilio's, and it should not be encouraged.
 */

/** Empty TwiML — accepted, no auto-reply from the webhook itself. */
const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';

function twiml() {
  return new NextResponse(EMPTY_TWIML, {
    status: 200,
    headers: { "content-type": "text/xml; charset=utf-8" },
  });
}

export async function POST(request: Request) {
  const raw = await request.text();
  const params: Record<string, string> = {};
  for (const [key, value] of new URLSearchParams(raw)) params[key] = value;

  const verdict = verifyTwilioSignature(
    "/api/sms/inbound",
    params,
    request.headers.get("x-twilio-signature"),
  );
  if (!verdict.ok) {
    /* Counts and enums only — never the body, never the number (invariant 7). */
    console.warn("[sms:inbound] refused", { reason: verdict.reason });
    return NextResponse.json({ error: "Unverified" }, { status: 403 });
  }

  const from = toE164(params.From ?? "");
  const body = params.Body ?? "";
  if (!from) {
    console.warn("[sms:inbound] no usable sender");
    return twiml();
  }

  const keyword = keywordOf(body);
  console.info("[sms:inbound]", { keyword: keyword ?? "text", length: body.length });

  if (keyword === "opt_out") {
    /**
     * Before anything else, and with no reply.
     *
     * Twilio's Advanced Opt-Out sends the carrier-standard confirmation itself,
     * so a second message from us would be two goodbyes to somebody who just
     * asked for silence. The mirror row is what lets pools exclude them at the
     * query level rather than discovering it at send time.
     */
    await setOptOut(from, "out", body);
    await recordInbound({ phone: from, category: "outreach", keyword: "opt_out" });
    return twiml();
  }

  if (keyword === "opt_in") {
    await setOptOut(from, "in", body);
    await recordInbound({ phone: from, category: "outreach", keyword: "opt_in" });
    /* Through the single send layer like everything else — which re-checks the
       opt-out list, so this cannot go to somebody still opted out. */
    await sendSms({ to: from, body: optInConfirmationSms(), category: "transactional" });
    return twiml();
  }

  if (keyword === "help") {
    await recordInbound({ phone: from, category: "transactional", keyword: "help" });
    await sendSms({ to: from, body: helpSms(), category: "transactional" });
    return twiml();
  }

  if (keyword === "pass") {
    /**
     * Strategy §6 — the effortless exit.
     *
     * "The question moves to someone else immediately, with no follow-up, no
     * penalty, and nothing recorded against you." All three halves are here:
     * `recordPass` frees the seat at once, there is no reply, and `recordInbound`
     * **links it to the outreach it answers** so the governor counts it as a
     * response. Counting a polite decline as silence would lower the allowance of
     * somebody who was being helpful about it — the opposite of the promise.
     */
    await recordPass({ phone: from });
    await recordInbound({ phone: from, category: "outreach", keyword: "pass" });
    return twiml();
  }

  /**
   * Ordinary text, in five steps.
   *
   * They are separate because they answer separate questions: who is this (5.9),
   * does this count as a response (8.4), is it a settings command (8.3), is it an
   * answer to a Network Ask (7.5), and is it an answer to something Pando asked
   * them (5.4).
   */

  /**
   * 5.9 — the cold inbound.
   *
   * Before anything is logged against them, they have to exist. An inbound text
   * proves possession of the number in the same way an OTP does, so this creates
   * a **nameless** person with `phone_verified_at` set and records their first
   * text as the opt-in it is — under a consent version that says *that*, not the
   * seed wording they never saw.
   *
   * It runs for everybody, not only strangers: an existing contributor simply
   * comes back with their id, which is what the next two steps need anyway.
   */
  const person = await ensureInboundPerson({ phone: from });

  await recordInbound({ phone: from, category: "outreach", keyword: null });

  /**
   * 8.3 — the settings command, and the reply to it.
   *
   * Before the blast attachment, because a settings exchange is not an answer to
   * anybody's question and must not be filed as one — a parent who texts SETTINGS
   * while a Network Ask is open has not answered it.
   *
   * **The ambiguity this resolves is real.** A bare "5" means five a month here
   * and a five-year-old in the clarifying flow. Nothing in the words separates
   * them, so the records do: `awaitingSettingsChoice` asks which question was
   * actually last put to this person.
   */
  if (person) {
    if (isSettingsCommand(body)) {
      const current = await currentAllowance(person.person_id);
      await sendSms({
        to: from,
        body: settingsPrompt(current),
        category: "transactional",
        personId: person.person_id,
        template: SETTINGS_TEMPLATE,
      });
      return twiml();
    }

    if (await awaitingSettingsChoice(person.person_id)) {
      const choice = parseAllowanceChoice(body);
      if (choice) {
        await setAllowance({
          personId: person.person_id,
          allowance: choice.allowance,
          mode: choice.mode,
        });
        await sendSms({
          to: from,
          body: settingsConfirmation(choice),
          category: "transactional",
          personId: person.person_id,
          template: "settings_confirmed",
        });
        console.info("[sms:inbound] allowance changed", { mode: choice.mode });
        return twiml();
      }
      /* Unreadable: fall through and treat it as an ordinary message. Re-sending
         the menu at somebody who wrote something else is how a service starts
         arguing with a parent. */
    }
  }

  /**
   * 10.1 — adding a recommendation, one question at a time.
   *
   * **Before the blast attachment**, on the same reasoning as the settings
   * exchange: a capture is a conversation the *parent* started, and the message
   * in front of us is the answer to the question Pando asked them one text ago.
   * A Network Ask that lands mid-capture is unfortunate rather than ambiguous —
   * the parent can CANCEL, and the 48-hour gap makes the overlap rare.
   *
   * A caregiver is refused here and handed to the flow that can ask properly.
   * Invariants 14, 2 and 12 are three gates a text message cannot honestly pass,
   * and collecting the nomination badly would be worse than not collecting it.
   */
  if (person) {
    const capture = await openCapture(person.person_id);

    if (capture && isCaptureCancel(body)) {
      await cancelCapture(capture.capture_id);
      console.info("[sms:inbound] capture cancelled");
      return twiml();
    }

    if ((capture || isCaptureStart(body)) && mentionsCaregiver(body)) {
      if (capture) await cancelCapture(capture.capture_id);
      await sendSms({
        to: from,
        body: caregiverRedirectSms(),
        category: "transactional",
        personId: person.person_id,
        template: "capture_caregiver_redirect",
        templateVersion: SMS_TEMPLATE_VERSION,
      });
      return twiml();
    }

    if (capture) {
      const answer = readAnswer(capture.step, body);
      if (answer.ok) {
        const value = "skipped" in answer ? null : answer.value;
        const saved = await saveAnswer(capture, value);
        if (saved) {
          if (saved.next) {
            await sendSms({
              to: from,
              body: CAPTURE_QUESTIONS[saved.next].prompt,
              category: "transactional",
              personId: person.person_id,
              template: `capture_${saved.next}`,
              templateVersion: SMS_TEMPLATE_VERSION,
            });
          } else {
            const card = await saveCapturedCard(capture, saved.answers);
            if (card) {
              await sendSms({
                to: from,
                body: captureSavedSms(card.name),
                category: "transactional",
                personId: person.person_id,
                template: "capture_saved",
                templateVersion: SMS_TEMPLATE_VERSION,
              });
            }
            console.info("[sms:inbound] capture saved", { saved: card !== null });
          }
          return twiml();
        }
      } else {
        /* Unreadable on a closed step. The question is repeated **once, as
           itself** rather than rephrased or escalated — a parent who typed
           something the options do not contain has not made a mistake, and
           arguing about it is how a helpful service becomes a form. */
        await sendSms({
          to: from,
          body: CAPTURE_QUESTIONS[capture.step].prompt,
          category: "transactional",
          personId: person.person_id,
          template: `capture_${capture.step}`,
          templateVersion: SMS_TEMPLATE_VERSION,
        });
        return twiml();
      }
    }

    if (isCaptureStart(body)) {
      const started = await startCapture(person.person_id);
      if (started) {
        await sendSms({
          to: from,
          body: CAPTURE_QUESTIONS[started.step].prompt,
          category: "transactional",
          personId: person.person_id,
          template: `capture_${started.step}`,
          templateVersion: SMS_TEMPLATE_VERSION,
        });
        return twiml();
      }
    }
  }

  const attached = await attachResponse({ phone: from, text: body });

  /**
   * 10.2 — a reply to a freshness ping, and 9.1's "did it help?".
   *
   * **They are resolved together, by which question was asked more recently.**
   * Both are answered with the word "yes", and nothing in the message separates
   * them — the same collision as 8.3's bare "5", and the same answer: the
   * records decide, not the order of the code. Resolving these by whichever
   * `if` came first would silently refresh a record when the parent was grading
   * an answer, and both writes are invisible to whoever made the mistake.
   *
   * A confirmation is worth more than a grade when both are open, and that falls
   * out of the timestamp rather than being asserted: a ping sent this morning
   * beats a prompt from four days ago.
   */
  const pingReply = readPingReply(body);
  const helpedReply = yesOrNo(body);
  let answeredSomething = false;

  if (!attached.attached && (pingReply !== "unclear" || helpedReply !== null)) {
    const [ping, prompt] = await Promise.all([
      pingReply === "unclear" ? Promise.resolve(null) : pendingPing(from),
      helpedReply === null ? Promise.resolve(null) : pendingHelpedAnswer(from),
    ]);

    const at = (v: string | null) => (v ? new Date(v).getTime() : 0);
    const pingWins = ping !== null && (prompt === null || at(ping.asked_at) >= at(prompt.asked_at));

    if (pingWins && ping) {
      const outcome = await applyPingReply(ping, pingReply);
      /* Enums only — never the record's name or the parent's words. */
      console.info("[sms:inbound] freshness", {
        reply: pingReply,
        kind: outcome?.kind ?? "unknown",
        vouched: outcome?.vouched ?? false,
      });
      answeredSomething = true;
    } else if (prompt && helpedReply !== null) {
      await recordHelped(prompt.answer_id, helpedReply);
      console.info("[sms:inbound] helped", { helped: helpedReply });
      answeredSomething = true;
    }
  }

  /**
   * Both of the above run **after** the blast attachment, on the same reasoning
   * as the clarifying step: somebody answering a Network Ask is not also grading
   * last week's answer or confirming a record.
   *
   * And both refuse to guess. Anything that is not a plain yes or no leaves the
   * question open and falls through to ordinary handling — reading "it was
   * closed on Sunday" as a verdict would be a guess, and here a guess writes an
   * impact event and texts a third person.
   */

  /**
   * 5.4 — if Pando asked them something, this is the answer.
   *
   * Checked **after** the blast attachment, because a reply to a Network Ask is
   * the stronger claim on the message: somebody answering a question Pando put to
   * them is not also answering a clarifying question from last week.
   *
   * A reply that cannot be read stores nothing and is not asked again. One
   * refusal is a parent who did not want to answer, and asking twice is how a
   * helpful service becomes a form.
   */
  if (person && !attached.attached && !answeredSomething) {
    const pending = await pendingClarification(person.person_id);
    if (pending) {
      const saved = await saveClarification({
        personId: person.person_id,
        question: pending,
        text: body,
        areas: pending === "neighborhood" ? await marketAreas() : undefined,
      });
      console.info("[sms:inbound] clarification", { question: pending, saved });
    }
  }

  /**
   * 5.3 — a first reading, from the free half only.
   *
   * `fallbackIntent` is rules: context, then shape. **The model is deliberately
   * not called here yet**, because nothing consumes the answer — 5.7 is the
   * consumer and it does not exist. An API call per inbound message to produce a
   * log line is money for nothing, and the classifier is already tested
   * (`npm run test:intent`). When 5.7 lands, this becomes `classifyIntent` and
   * the fallback stays underneath it unchanged.
   *
   * `awaiting_blast_reply` comes from whether the reply actually attached to an
   * open blast, which is the records answering rather than the words — the
   * strongest signal there is, and free.
   *
   * Logged as an enum. Never the message (invariant 7).
   */
  const reading = fallbackIntent(body, {
    awaiting_blast_reply: attached.attached,
    /* Not hardcoded: `created` is true only for a number Pando had never seen,
       and the fallback treats a stranger's short message as unreadable rather
       than as small talk — guessing at a first message costs the most. */
    known_person: person !== null && !person.created,
  });
  console.info("[sms:inbound] read as", {
    intent: reading.intent,
    source: reading.source,
    attached: attached.attached,
  });

  return twiml();
}

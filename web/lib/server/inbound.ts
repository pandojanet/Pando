import "server-only";

import {
  SMS_TEMPLATE_VERSION,
  keywordOf,
  helpSms,
  optInConfirmationSms,
  caregiverDeletedSms,
  nothingToDeleteSms,
} from "@/lib/sms-templates";
import { classifyIntent } from "@/lib/server/intent";
import { composeAnswer, type AnswerCandidate } from "@/lib/answer";
import {
  heldReply,
  routeAnswer,
  mentionsCaregiver as answerMentionsCaregiver,
} from "@/lib/answer-routing";
import { classifyDemand } from "@/lib/demand";
import { bandsForBirthYears } from "@/lib/matching";
import { CLARIFYING_COPY, clarifyTemplate, nextQuestion } from "@/lib/onboarding";
import { retrieveFor } from "@/lib/server/repo/retrieval";
import { queueAnswer } from "@/lib/server/repo/answers";
import {
  isSettingsCommand,
  parseAllowanceChoice,
  settingsConfirmation,
  settingsPrompt,
} from "@/lib/outreach-policy";
import { attachResponse, recordPass } from "@/lib/server/repo/blast";
import { isCaregiverDeleteRequest } from "@/lib/consent";
import { looksLikePerson } from "@/lib/named-person";
import { deleteCaregiverByPhone } from "@/lib/server/repo/caregiver-delete";
import { yesOrNo } from "@/lib/thanks";
import { readPingReply } from "@/lib/vouch";
import { applyPingReply, pendingPing } from "@/lib/server/repo/vouch";
import {
  CAPTURE_QUESTIONS,
  captureSavedSms,
  caregiverRedirectSms,
  isCaptureCancel,
  isCaptureStart,
  isSkipWord,
  offersSomething,
  readsAsSkip,
  mentionsCaregiver,
  readAnswer,
} from "@/lib/capture";
import {
  cancelCapture,
  openCapture,
  openCaptureStep,
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
  type ColdPerson,
} from "@/lib/server/repo/onboarding";
import { recordInbound, setOptOut } from "@/lib/server/repo/outreach";
import { sendSms } from "@/lib/server/sms";

/**
 * What Pando does with an inbound message, whatever carried it.
 *
 * ## Why this is its own module
 *
 * It was the body of `/api/sms/inbound`, and it stopped being able to live there
 * on 2 Sep, when the Slack relay gave inbound messages a second door
 * (`/api/slack/events`). Two routes running two copies of this would be the
 * worst possible duplication in this codebase: it is the path that opts people
 * out, writes contributions, spends a contributor's monthly allowance and
 * decides whether a bare "yes" refreshed a record or graded an answer. A copy
 * that drifted would drift in exactly those places.
 *
 * So the transports keep only what is genuinely theirs — proving the request is
 * real, and working out which phone number it came from — and hand over
 * `(from, body)`. Everything below is transport-blind, which it always was in
 * shape: it works in phone numbers and calls `sendSms`, and `sendSms` is what
 * decides whether that means Twilio or the channel.
 *
 * ## The order, and why each step is where it is
 *
 * 1. **Keyword.** STOP and friends, then START, then HELP — before anything else
 *    reads the message, and never reaching the AI (12.3, and 5.3's own words:
 *    "opt-out keywords are handled before this step and never reach the AI").
 *    A classifier is probabilistic and will one day read STOP as an aside, which
 *    is a compliance failure rather than a bad answer.
 * 2. **The sender exists** (5.9) — an inbound text proves possession of the
 *    number the way an OTP does.
 * 3. **The inbound row**, with `responded_to` when it answers an outreach, which
 *    is what the response-rate governor counts.
 * 4. **Settings** (8.3), then **a capture** (10.1), then **a Network Ask reply**
 *    (7.5), then **freshness / did-it-help** (10.2, 9.1), then **a clarifying
 *    answer** (5.4). Each of those comments explains its own position.
 *
 * Nothing is *answered* here, and 5.7 existing has not changed that: an answer is
 * composed, held by 5.8 and read by a person (14.2) before it goes out. A reply
 * from this path would be the unread AI-adjacent answer the product promises
 * never to send.
 */
export async function handleInboundMessage(input: {
  /** E.164, already parsed by whichever transport received it. */
  from: string;
  body: string;
}): Promise<void> {
  const { from, body } = input;

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
    return;
  }

  if (keyword === "opt_in") {
    await setOptOut(from, "in", body);
    await recordInbound({ phone: from, category: "outreach", keyword: "opt_in" });
    /* Through the single send layer like everything else — which re-checks the
       opt-out list, so this cannot go to somebody still opted out. */
    await sendSms({ to: from, body: optInConfirmationSms(), category: "transactional" });
    return;
  }

  if (keyword === "help") {
    await recordInbound({ phone: from, category: "transactional", keyword: "help" });
    await sendSms({ to: from, body: helpSms(), category: "transactional" });
    return;
  }

  /**
   * Does this message belong to a capture rather than to somebody's Network Ask?
   *
   * Only `SKIP` can be both, so the phone is not queried for an ordinary PASS.
   * And the step has to accept a skip: at `name` the capture would store "SKIP"
   * as the record's name, which is a worse outcome than the PASS this diverts.
   */
  const step =
    keyword === "pass" && isSkipWord(body) ? await openCaptureStep(from) : null;
  const skipBelongsToCapture = step !== null && readsAsSkip(step, body);

  if (keyword === "pass" && !skipBelongsToCapture) {
    /**
     * Strategy §6 — the effortless exit.
     *
     * ⚠ **Guarded by the capture check, and that guard is a bug fix rather than
     * a refinement.** `SKIP` is one of the two PASS keywords *and* the word the
     * capture's last question asks for by name — so a parent doing exactly what
     * the screen told them had it read as a decline to a different question, the
     * card they had answered five questions for was never written, and PASS
     * sends no reply, so the whole exchange ended in silence. Worse, the capture
     * stayed `open`, so every later message from that person was swallowed as an
     * answer to a question they had already finished.
     *
     * The tie-break is the pipeline's own: the more recently asked question
     * wins. Nothing else changes — with no capture open, PASS behaves exactly as
     * it did, including for a number Pando has never seen.
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
    return;
  }

  /**
   * 11.3 — a caregiver removing themselves, and it goes here for one reason.
   *
   * **Before `ensureInboundPerson`.** That function *creates* a nameless person
   * for a number Pando has not seen (5.9), so running it first would mean
   * answering a request to delete records by creating one. A stranger who texts
   * DELETE must leave no trace of having done so.
   *
   * It sits with the keywords rather than below, because DELETE is a **decision
   * about Pando** and not an answer to anything — the same reasoning that puts
   * STOP first and keeps it away from the classifier. A caregiver mid-capture who
   * texts DELETE means it.
   *
   * The inbound row is written *first*, while the person still exists, so the
   * message is attributed. `message_log.person_id` is `on delete set null`, so
   * after the cascade the row survives without them: the counts that delivery
   * monitoring reads stay true, and the person is gone from them. That is the
   * right shape rather than a compromise — "the whole profile goes" is about the
   * profile, not about the arithmetic of how many messages Pando has sent.
   */
  if (isCaregiverDeleteRequest(body)) {
    await recordInbound({ phone: from, category: "transactional", keyword: "delete" });
    const outcome = await deleteCaregiverByPhone(from);
    /* Counts and enums only (invariant 7). */
    console.info("[sms:inbound] caregiver delete", {
      deleted: outcome.deleted,
      reason: outcome.deleted ? null : outcome.reason,
    });

    /**
     * The receipt. Three outcomes and three different true things to say —
     * "unavailable" is the one worth having: telling somebody who *does* have a
     * profile that they never had one would be a lie about their own data, which
     * is the single thing this feature exists not to do.
     *
     * On the Slack relay this reply is posted unthreaded and labelled "unknown
     * recipient", because by now there is no person to label it with. Cosmetic,
     * and correct in substance.
     */
    await sendSms({
      to: from,
      body: outcome.deleted
        ? caregiverDeletedSms()
        : outcome.reason === "no_claim"
          ? nothingToDeleteSms()
          : "Pando: something went wrong on our side and nothing was changed. Please try again in a few minutes. Reply STOP to opt out, HELP for help.",
      category: "transactional",
      template: outcome.deleted ? "caregiver_deleted" : "caregiver_delete_none",
      templateVersion: SMS_TEMPLATE_VERSION,
    });
    return;
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
      return;
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
        return;
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
      return;
    }

    /**
     * 10.1's caregiver refusal, and **11.4's extension of it to a name**.
     *
     * `mentionsCaregiver` catches the words — "nanny", "sitter", "au pair". It
     * cannot catch the case 11.4 is actually about: a parent who answers "class"
     * and then names *a person*. "Ms. Diane" or "Diane Kovalenko" entered as an
     * activity would become a `shares` row with a person's name in it, published
     * to strangers with none of the caregiver apparatus — no 18+ question, no
     * consent, no invariant 1. The estimate's phrase for closing that is
     * "protecting the person regardless of capture path", and this is the path
     * with no human in the loop at capture time.
     *
     * **Only the strong signals refuse.** `looksLikePerson`'s weak
     * `personal_name` signal flags 1% of this market's real records before the
     * place-name veto and 0% after it, but a lexical rule cannot tell "Diane
     * Kovalenko" from "Marshall Fundamental" in general — so refusing on it
     * would one day turn away a legitimate business over SMS, where the parent
     * has no way to argue. An honorific or a bare possessive is near-impossible
     * to trigger by accident, and the cost of being wrong about one is a link to
     * a form that can take the nomination properly.
     *
     * It reuses the **same** redirect message, deliberately: there is one right
     * answer to "you are describing a person", and a second wording of it would
     * be a second thing to keep true.
     */
    const named =
      capture?.step === "name" ? looksLikePerson(body) : { person: false as const };

    /**
     * ⚠ **And the same refusal for an offer made outside a capture**, which is
     * where it was missing until a walk of A4 found it.
     *
     * The gate above is `capture || isCaptureStart`, because the redirect was
     * written for 10.1's five-question script. So a parent who simply texted
     * *"I want to add our nanny Marisol, she is wonderful"* — no ADD first, no
     * capture open — sailed past it, was read as `ask_caregiver` (the rule-based
     * reading maps **any** caregiver word to that, with no notion of offering
     * versus asking), and came back as a **queued answer**. A nomination sitting
     * in the answers queue is a nomination nobody will process properly.
     *
     * `offersSomething` is what separates the two, and the asymmetry is worth
     * keeping: "any good nannies near Altadena?" and "we need a nanny three days
     * a week" carry no offer verb and are answered, held for a person because
     * `routeAnswer` treats anything caregiver-related as a permanent hold.
     */
    const offeringCaregiver =
      !capture && !isCaptureStart(body) && mentionsCaregiver(body) && offersSomething(body);

    if (
      ((capture || isCaptureStart(body)) &&
        (mentionsCaregiver(body) || (named.person && named.strong))) ||
      offeringCaregiver
    ) {
      if (capture) await cancelCapture(capture.capture_id);
      console.info("[sms:inbound] capture refused", {
        reason: offeringCaregiver
          ? "caregiver_offered"
          : named.person
            ? `named_person:${named.signal}`
            : "caregiver_words",
      });
      await sendSms({
        to: from,
        body: caregiverRedirectSms(),
        category: "transactional",
        personId: person.person_id,
        template: "capture_caregiver_redirect",
        templateVersion: SMS_TEMPLATE_VERSION,
      });
      return;
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
          return;
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
        return;
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
        return;
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
  let clarified = false;
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
      /* Only a reply that *was* an answer is spent. An unreadable one stores
         nothing and is not asked again — and it may well be a question, which is
         what the step below is for. */
      clarified = saved;
    }
  }

  /**
   * 5.3 — the reading, and it is the model's now.
   *
   * The comment this replaces said the model was deliberately not called
   * "because nothing consumes the answer — 5.7 is the consumer and it does not
   * exist", and promised that when 5.7 landed this would become
   * `classifyIntent` with the fallback unchanged underneath. That is exactly what
   * happened: `classifyIntent` answers from **context first and without a round
   * trip** when Pando is already waiting on this person, falls back to the same
   * rules when `ANTHROPIC_API_KEY` is unset, and `applyThreshold` drops a
   * low-confidence or invented intent back to them too.
   *
   * `awaiting_blast_reply` comes from whether the reply actually attached to an
   * open blast, which is the records answering rather than the words — the
   * strongest signal there is, and free.
   *
   * Logged as an enum. Never the message (invariant 7).
   */
  const reading = await classifyIntent({
    text: body,
    context: {
      awaiting_blast_reply: attached.attached,
      /* Not hardcoded: `created` is true only for a number Pando had never seen,
         and the fallback treats a stranger's short message as unreadable rather
         than as small talk — guessing at a first message costs the most. */
      known_person: person !== null && !person.created,
    },
  });
  console.info("[sms:inbound] read as", {
    intent: reading.intent,
    source: reading.source,
    attached: attached.attached,
  });

  /**
   * 5.5 → 5.6 → 5.7 → 5.8, finally joined to the door they come in through.
   *
   * Every one of those was built and tested and **reachable from nothing**: the
   * chain ended at the log line above, so a parent who texted Pando a question
   * was read, classified, and answered with silence. It was never a
   * Slack-versus-Twilio difference — both transports call this function, so
   * Twilio was exactly as quiet.
   *
   * Only a message nothing else has claimed gets here. A blast reply, a freshness
   * "yes", a settings choice and a clarifying answer were each a reply to
   * something Pando asked, and treating one as a fresh question is the mistake
   * the whole ordering above exists to prevent.
   */
  if (attached.attached || answeredSomething || clarified) return;
  if (reading.intent !== "ask_recommendation" && reading.intent !== "ask_caregiver") {
    return;
  }

  await answerQuestion({
    from,
    body,
    person,
    caregiverIntent: reading.intent === "ask_caregiver",
  });
}

/**
 * Compose an answer from records, put it in the queue, and say so.
 *
 * ## It never sends the answer itself, and that is the design rather than a stub
 *
 * `PILOT_HOLD_EVERYTHING` is true, so `routeAnswer` holds everything today and an
 * auto-send path would be a code path nothing exercises — this codebase's own
 * most expensive repeated lesson (`bands`, `area_slug`, the starter list: each
 * written, reviewed, and silently never run). The answer goes to
 * `/admin/answers`, where 14.2's approve-then-send already works and a person
 * decides. The day the flag comes off is a deliberate decision with somebody
 * watching, and wiring the send then is a small change.
 *
 * What the parent gets instead of silence is `heldReply`.
 *
 * ## The area and the ages come from the person, never from the message
 *
 * That is the 11 Aug rule that the graph is derived server-side, and here it is
 * also the difference between ranking Sierra Madre first and ranking whatever
 * somebody happened to type. `bandsForBirthYears` recomputes the band at query
 * time for the reason `matching.ts` gives: a stored band goes stale.
 *
 * A cold number has neither, and that is fine — `retrieveFor` ranks by area and
 * never filters by it, so a stranger gets the market's best-supported records
 * rather than nothing.
 */
async function answerQuestion(input: {
  from: string;
  body: string;
  person: ColdPerson | null;
  caregiverIntent: boolean;
}): Promise<void> {
  const { from, body, person } = input;
  const profile = person?.profile;

  /**
   * Which half of the graph may answer this, and it is the only narrowing that
   * can be drawn safely.
   *
   * A walk of A4 produced a nanny question answered with **Little Maestros and
   * Hahamongna Watershed Park** — a music class and a park — under the sentence
   * "local parents have shared something on this". `retrieveFor` reads no
   * subject at all (its header says so now), so without this it always returns
   * both halves and the composer writes about whatever ranked highest.
   *
   * ⚠ Narrowing **within** a kind is deliberately not attempted. A word list
   * mapping "birthday party venues" to `place` would exclude the record of that
   * exact name, which is a `tip` — so a guess at the kind can make an answer
   * worse than no guess. See `retrieveFor`'s header for what a real fix needs.
   */
  const aboutCare = input.caregiverIntent || answerMentionsCaregiver(body);

  const retrieved = await retrieveFor({
    area: profile?.neighborhood ?? null,
    bands: profile ? bandsForBirthYears(profile.child_birth_years, new Date()) : [],
    shares: !aboutCare,
    caregivers: true,
  });

  /* No database is not an empty answer. Saying "nothing from local parents yet"
     when the truth is that Pando could not look is the `persisted: false` rule
     one surface along. */
  if (!retrieved.configured) {
    console.warn("[sms:answer] not configured");
    return;
  }

  /**
   * A caregiver is a candidate like any other, and `display` is the only shape
   * `caregivers` can hold — a first name and a last initial, by CHECK. Invariant
   * 1's four conditions are already in `retrieveFor`'s WHERE clause, so anything
   * here has consented, is active, is discoverable and is an adult.
   */
  const candidates: AnswerCandidate[] = [
    ...retrieved.shares.map((share) => ({
      name: share.name,
      venue: share.venue,
      kind: share.kind,
      trust: share.trust,
      firsthand_count: share.firsthand_count,
      answer_ready: share.answer_ready,
    })),
    ...retrieved.caregivers.map((caregiver) => ({
      name: caregiver.display,
      kind: "caregiver",
      trust: caregiver.trust,
      firsthand_count: caregiver.firsthand_count,
    })),
  ];

  const composed = composeAnswer({ candidates, has_question: true });

  /**
   * Read three ways, and any one of them is enough: what the classifier decided,
   * what the words say, and whether a caregiver actually reached the answer. The
   * cost of missing it is the highest-stakes sentence Pando sends going out with
   * nobody having read it.
   */
  const caregiverRelated = aboutCare || retrieved.caregivers.length > 0;

  const verdict = routeAnswer({
    /* Rules only, and they may only ever escalate. There is no category tap on
       an SMS, so the text is all there is. */
    sensitivity: classifyDemand(body, null),
    caregiver_related: caregiverRelated,
    public_only: composed.public_only,
    used: composed.used,
    next_step: composed.next_step,
  });

  const answerId = await queueAnswer({
    personId: person?.person_id ?? null,
    phone: from,
    question: body,
    answerText: composed.text,
    nextStep: composed.next_step,
    labels: composed.labels,
    publicOnly: composed.public_only,
    holdReason: verdict.reason,
  });

  /* Counts and enums only (invariant 7) — never the question, never the answer. */
  console.info("[sms:answer] queued", {
    queued: answerId !== null,
    used: composed.used,
    next_step: composed.next_step,
    hold: verdict.reason,
    permanent: verdict.permanent,
  });

  if (answerId === null) return;

  /**
   * 5.4's question, finally sent.
   *
   * Asked **only when nothing is already pending**, which is the "one refusal is
   * a parent who did not want to answer" rule read forward: `pendingClarification`
   * is what `saveClarification` keys on, so asking again while one is open would
   * both nag and make the next reply ambiguous.
   *
   * The template is what makes the answer findable, so it is the clarify one
   * whenever a question rides along — otherwise `pendingClarification` could
   * never see it, which is precisely how this half stayed dead.
   */
  const asking =
    person && (await pendingClarification(person.person_id)) === null
      ? nextQuestion(person.profile)
      : null;

  await sendSms({
    to: from,
    body: heldReply(asking ? CLARIFYING_COPY[asking] : null),
    category: "transactional",
    personId: person?.person_id,
    template: asking ? clarifyTemplate(asking) : "answer_queued",
    templateVersion: SMS_TEMPLATE_VERSION,
  });
}

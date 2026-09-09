/**
 * What Pando says to a message that is not a question and not a script.
 *
 * ## Why this is its own file
 *
 * Three kinds of outbound copy already have a home and none of them fits these.
 * `sms-templates.ts` is **registered A2P sample copy**, where a reword is a
 * compliance event. `onboarding.ts`'s `CLARIFYING_COPY` is the one-question-at-a-
 * time onboarding. `capture.ts` is the five-question capture script and its
 * refusals. What was left over is the case that had no copy at all: somebody
 * texted, it was read, it was neither a question nor an answer to one — and
 * Pando said **nothing**.
 *
 * That silence is the 7 Sep review's first gap. `unclear` and a mid-exchange
 * `chitchat` were closed on 8 Sep by `pending_questions`; a **cold** `chitchat`
 * and **any** free-form `contribute` were still dropped, verified live on 9 Sep
 * against the built app — no reply, no queued answer, no pending question. The
 * contribute case is the worse of the two, because the parent is trying to give
 * Pando something.
 *
 * Pure and free of runtime imports, like every other copy module here, so
 * `npm run test:routing` can load it in plain node and pin the encoding. One
 * character outside GSM-7 halves a message's budget, and neither of these is
 * registered, so there is nothing stopping a future edit from adding an em dash
 * except a test that measures.
 *
 * ⚠ Both strings are new user-facing copy and are on the list for the client.
 */

/**
 * To a parent offering a recommendation in passing.
 *
 * The shape follows `capture.ts`'s caregiver redirect deliberately — name the
 * service, say why the form rather than the text, say how long, then the link —
 * because it is the same refusal for the same reason. A recommendation carries
 * an age at the time, a recency, a price band and whether they would recommend
 * it; a stray sentence carries none of them, so accepting it here would build a
 * record every trust label then has to be silent about.
 *
 * ⚠ **`/share`, never `/caregiver`** — the latter is where a caregiver signs
 * *themselves* up, and sending a nominating parent there is the wrong flow
 * entirely. The same trap `capture.ts` documents.
 */
export const SHARE_INVITE =
  "Pando: thanks! A few taps captures it properly - ages, cost, whether you'd recommend it: pando.is/share Reply STOP to opt out, HELP for help.";

/**
 * To small talk from somebody who has not asked anything yet.
 *
 * It says what the number is **for** rather than acknowledging the message: a
 * stranger's first text is their whole impression of Pando (5.9), and "thanks!"
 * back teaches them nothing about what to do next.
 *
 * **No question is asked**, deliberately. 5.4 owns the one-question-at-a-time
 * onboarding and fires on its own schedule; asking a second thing here would
 * make the next reply ambiguous, which is exactly what that design exists to
 * prevent.
 */
export const SMALL_TALK =
  "Pando: ask me about local classes, camps, activities or childcare and I'll tell you what nearby parents recommend. Reply STOP to opt out, HELP for help.";

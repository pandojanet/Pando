/**
 * SMS copy for the A2P 10DLC campaign. **Do not reword.**
 *
 * The client's instruction is explicit: "production must match" the registered
 * samples. A cheerful rewrite here is a compliance problem, not a copy change —
 * so the wording lives in one file, is used verbatim, and gets a version when it
 * ever has to change (a change means re-registering the sample).
 *
 * Carrier console settings that are *not* code, recorded here so they aren't lost:
 *  - opt-in keywords: START and UNSTOP only (YES must be removed — a parent
 *    answering "yes" to a Network Ask must never read as a re-subscribe);
 *  - opt-out: STOP, help: HELP, both handled by the messaging service;
 *  - sends go through the Pando Messaging Service SID, never a bare number.
 */

export const SMS_TEMPLATE_VERSION = "a2p-samples-2026-08" as const;

/**
 * The verification text. The code is the only variable part.
 *
 * ⚠️ **No OTP sample was submitted with the campaign.** "Pando — QC Answers +
 * A2P Prep" (Part 2) lists exactly three samples to register — an answer, a blast
 * request, and a thanks — and this is none of them. It is also the *only* message
 * Phase 1 ever sends, so the first real send would be traffic in a shape the
 * carriers were never shown. Janet needs to add a fourth sample matching this
 * string before the campaign is submitted; the structure here already follows the
 * registered ones ("Pando:" first, STOP and HELP last) so that is a paperwork fix
 * rather than a rewrite.
 */
export function verificationSms(code: string): string {
  return `Pando: Your verification code is ${code}. Welcome to the founding network! Msg & data rates may apply. Reply STOP to opt out, HELP for help.`;
}

/**
 * The OTP numbers, from spec §19 verbatim: "OTPs expire after 5 minutes; max 3
 * attempts then 15-minute lock."
 *
 * They were 10 minutes and 5 attempts with no lock, which was friendlier and
 * weaker: burning the code on the fifth wrong guess still left two more sends, so
 * a six-digit code could be guessed at fifteen times inside one session. The lock
 * is the part that actually closes it, and it is keyed to the *phone*, not to the
 * cookie a client can throw away.
 *
 * None of these numbers appears in the message, so changing them does not touch
 * the registered copy above.
 */
/**
 * M7.8 — the Network Ask itself. **Registered copy.**
 *
 * ⚠️ **Check this against the registered sample before the first live blast.**
 * "Pando — QC Answers + A2P Prep" (Part 2) lists a blast request as one of the
 * three samples submitted with the campaign, and that document is not in the
 * repo. The structure here follows the registered shape — "Pando:" first, the
 * ask, then STOP and HELP — so aligning the wording is a paperwork fix rather
 * than a rewrite, but the string a carrier was shown is the string that must go
 * out. Same treatment as the OTP sample above, and for the same reason.
 *
 * Three things the wording has to carry, and none is decoration:
 *
 *  - **why them**, because strategy §6's whole claim is that being asked should
 *    feel like a compliment — "you specifically, because your kid did this";
 *  - **PASS**, because §6 promises "an effortless exit" and an exit nobody was
 *    told about is not one;
 *  - **the anonymity of the asker**, since a Network Ask never reveals who asked.
 */
export function blastRequestSms(input: {
  /** The question, already trimmed by the caller. */
  question: string;
  /** Why this parent — one short clause from the matcher's reasons. */
  because: string;
}): string {
  return `Pando: a parent nearby asked — "${input.question}" We thought of you (${input.because}). Reply with anything useful, or PASS to skip. Msg & data rates may apply. Reply STOP to opt out, HELP for help.`;
}

/**
 * The one-clause reason, from the matcher's own reasons.
 *
 * Kept short and deliberately vague about *which* parent: the asker is anonymous,
 * so "same school" is sayable and "Sarah's school" is not. It also never names
 * the record itself — telling somebody they were picked because of a specific
 * class would leak what the asker is asking about more precisely than the
 * question already does.
 */
export function askReason(kinds: string[]): string {
  if (kinds.includes("school")) return "you're at the same school";
  if (kinds.includes("activity")) return "your kids do similar activities";
  if (kinds.includes("neighborhood")) return "you're in the same area";
  if (kinds.includes("adjacent_neighborhood")) return "you're just nearby";
  if (kinds.includes("faith_community")) return "you share a community";
  if (kinds.includes("social_group")) return "you're in the same group";
  if (kinds.some((k) => k.startsWith("age_range"))) return "your kids are a similar age";
  return "your experience looked relevant";
}

/**
 * M9.1 — "did it help?", a few days after an answer went out.
 *
 * ⚠️ Same registration caveat as the two above, and this one is **named**: "QC
 * Answers + A2P Prep" (Part 2) lists a thanks among the three samples submitted
 * with the campaign, so the string a carrier was shown is the string that must
 * go out. Check both this and `thanksSms` against it before the first run.
 *
 * **It has to be answerable in one word**, because that is the whole design: a
 * question that needs a sentence gets no reply, and the reply is the only
 * evidence Pando ever gets that a recommendation worked. YES and NO are read by
 * the inbound webhook — and note YES is deliberately *not* an opt-in keyword
 * (see the header), which is exactly why it is safe to ask for here.
 *
 * It also says what happens with the answer. A parent who does not know a "yes"
 * turns into a thank-you for a neighbour has been asked to rate something; one
 * who does has been asked to pass something on.
 */
export function thanksPromptSms(): string {
  return "Pando: a few days ago we sent you a recommendation from a local parent. Did it help? Reply YES or NO — a yes lets us thank whoever shared it. Reply STOP to opt out, HELP for help.";
}

/**
 * M9.2 — the thank-you itself, batched.
 *
 * ⚠️ Registered copy — see above.
 *
 * **It names what they did.** Strategy 13's impact receipts are the reason: a
 * bare "thanks for contributing" is a form letter, and the thing that makes a
 * contributor answer the next question is knowing that the last one reached
 * somebody. `thanksList` builds the clause; this wraps it.
 *
 * **It asks for nothing.** No question, no link, no "keep it up". A thank-you
 * that carries a request is a request wearing a thank-you, and it would spend a
 * message from an allowance the contributor agreed to for being *asked things*.
 */
export function thanksSms(what: string): string {
  return `Pando: a parent nearby used your recommendation — ${what}. Thank you. Msg & data rates may apply. Reply STOP to opt out, HELP for help.`;
}

/**
 * M11.3 — the receipt for a caregiver who texted DELETE.
 *
 * ⚠️ **Not among the registered A2P samples**, like the OTP text. It is a
 * transactional reply to a message the person just sent, which is the least
 * carrier-sensitive shape there is, but the campaign should carry a sample
 * matching it before the first live one goes out.
 *
 * **It confirms rather than asks.** The 2C flow promises the profile goes
 * "without asking why", so this says what happened and stops — no exit survey,
 * no "was it something we did", and no offer to come back. A parent who has just
 * removed themselves is the last person to sell to.
 *
 * It does say the door is open, in one clause, because that is a fact they would
 * otherwise have to ask about: signing up again is the same two minutes it was
 * the first time.
 */
/**
 * 10.3 — "is this still worth recommending?"
 *
 * Extracted here on 3 Sep because it was composed inline in `repo/jobs.ts`,
 * which made it the only outbound message in the app with no single definition.
 * The retry sweep (13.4) needs to rebuild *the same* message rather than a
 * paraphrase of it, and two call sites composing one text is how the second one
 * drifts.
 *
 * PASS is in the copy for the reason strategy §6 gives: "an effortless exit —
 * reply PASS and the question moves to someone else immediately, with no
 * follow-up, no penalty, and nothing recorded against you." An exit nobody was
 * told about is not one.
 */
export function freshnessPingSms(input: { name: string }): string {
  return `Quick one — is ${input.name} still worth recommending? Reply yes, no, or PASS to skip.`;
}

export function caregiverDeletedSms(): string {
  return "Pando: done — your profile and everything in it is deleted. Families can no longer see you. If you ever want to set one up again, it's pando.is/caregiver. Reply STOP to opt out, HELP for help.";
}

/**
 * The answer when DELETE arrives from a number with no caregiver profile.
 *
 * **It does not guess what they meant.** The likely sender is a parent who read
 * DELETE somewhere and wants their own data gone — a real request, and a
 * different one: there is no self-serve parent delete, a person handles it, and
 * inventing one in a keyword handler would be a product decision taken in the
 * wrong place. So this says what Pando could not find and where a person is,
 * rather than offering something that does not exist.
 */
export function nothingToDeleteSms(): string {
  return "Pando: there's no caregiver profile on this number to delete. If you'd like your own information removed, email hello@pando.is and a person will handle it. Reply STOP to opt out, HELP for help.";
}

export const VERIFICATION_CODE_LENGTH = 6;
/** Minutes a code stays valid. */
export const VERIFICATION_TTL_MINUTES = 5;
/** Sends per phone per window, the first one included. */
export const VERIFICATION_MAX_SENDS = 3;
/** Wrong guesses before the code is burned and the number is locked. */
export const VERIFICATION_MAX_ATTEMPTS = 3;
/** How long a number is locked out after that. */
export const VERIFICATION_LOCK_MINUTES = 15;

/**
 * How long a *confirmed* number stays confirmed.
 *
 * Not an OTP number and not in §19: the code expires in five minutes, but the
 * session it opens has to outlive the whole Seed Tool visit. Since 12 Aug the code
 * is asked for at the start, so this window has to cover a parent who verifies,
 * fills fifteen screens, shares four cards and gets interrupted by a toddler —
 * where an hour was plenty when the code was the last thing they did.
 *
 * Twelve hours rather than days because the store is in memory: it does not
 * survive a deploy, and a longer promise would be one we cannot keep. Running past
 * it is not a data loss — the write is refused, the session falls back to holding
 * everything on the phone, and the gate at the end asks for a fresh code.
 */
export const VERIFICATION_SESSION_HOURS = 12;

/**
 * 12.3 — the keywords, and the precedence they carry.
 *
 * The Messaging Service handles these at the carrier level, and Pando mirrors
 * them so an opted-out person can be excluded **at the query level** rather than
 * discovered at send time. Both halves are wanted: the carrier list is what a
 * regulator reads, ours is what stops a pool being built from people who left.
 *
 * The lists are the CTIA standard set. Two rules about them:
 *
 *  - **YES is not an opt-in.** It is on the carrier default list and was removed
 *    deliberately (see the header): a parent answering "yes" to a Network Ask
 *    must never read as a re-subscribe. START and UNSTOP only.
 *  - **Matching is exact, on the whole message.** "STOP" opts out; "stop by the
 *    park at 3" does not, and neither does "I'll stop asking". A substring test
 *    here would silence people who never asked to be silenced, which is a worse
 *    failure than missing a keyword — the carrier layer catches a real STOP
 *    anyway.
 */
export const OPT_OUT_KEYWORDS = [
  "STOP",
  "STOPALL",
  "UNSUBSCRIBE",
  "CANCEL",
  "END",
  "QUIT",
] as const;

export const OPT_IN_KEYWORDS = ["START", "UNSTOP"] as const;

export const HELP_KEYWORDS = ["HELP", "INFO"] as const;

/**
 * The effortless exit, strategy §6.
 *
 * "Every request carries an effortless exit — reply PASS and the question moves
 * to someone else immediately, with no follow-up, no penalty, and **nothing
 * recorded against you**."
 *
 * That last clause is the one with teeth, and it is why PASS is handled
 * differently from every other keyword here: a PASS **counts as a response**
 * for the response-rate governor. Treating it as silence would let a parent who
 * politely declines three questions have their monthly allowance lowered for
 * being helpful about it — the exact opposite of what the sentence promises.
 *
 * §6 also says a parent who passes often "is telling us our matching is wrong,
 * not that she's unhelpful", which is the same idea from the other side.
 */
export const PASS_KEYWORDS = ["PASS", "SKIP"] as const;

/**
 * What one inbound message is, before anything else looks at it.
 *
 * Returns `null` for ordinary text, which is what then reaches intent
 * classification (5.3). The estimate is explicit that "opt-out keywords are
 * handled before this step and never reach the AI", so this function is what
 * makes that true — and it is deliberately dumb: uppercase, trim, exact match.
 */
export function keywordOf(
  body: string,
): "opt_out" | "opt_in" | "help" | "pass" | null {
  const word = body.trim().toUpperCase().replace(/[.!]+$/, "");
  if ((OPT_OUT_KEYWORDS as readonly string[]).includes(word)) return "opt_out";
  if ((OPT_IN_KEYWORDS as readonly string[]).includes(word)) return "opt_in";
  if ((HELP_KEYWORDS as readonly string[]).includes(word)) return "help";
  if ((PASS_KEYWORDS as readonly string[]).includes(word)) return "pass";
  return null;
}

/**
 * 12.4 — the HELP reply. **Registered copy: verbatim, like everything else here.**
 *
 * The estimate asks for "the service name, contact email, and how to opt out",
 * which is also the CTIA requirement. It is one segment on purpose — a HELP reply
 * that runs to two messages reads as a company that cannot answer a simple
 * question about itself.
 */
export function helpSms(): string {
  return "Pando: local parenting recommendations from real parents near you. Questions? hello@pando.is. Msg & data rates may apply. Reply STOP to opt out.";
}

/**
 * The confirmation after START.
 *
 * Sent because a person who re-subscribes and hears nothing cannot tell whether
 * it worked. Carriers send their own confirmation for STOP, so there is
 * deliberately no opt-out reply here: two goodbyes to somebody who asked for
 * silence is exactly the wrong instinct.
 */
export function optInConfirmationSms(): string {
  return "Pando: you're back on the list. Msg & data rates may apply. Reply STOP to opt out, HELP for help.";
}

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

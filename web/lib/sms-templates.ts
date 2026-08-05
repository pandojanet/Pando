/**
 * Registered SMS copy. **Do not reword.**
 *
 * These strings were submitted to the carriers with the A2P 10DLC campaign. The
 * client's instruction is explicit: "production must match" the registered
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

/** Registered sample #3. The code is the only variable part. */
export function verificationSms(code: string): string {
  return `Pando: Your verification code is ${code}. Welcome to the founding network! Msg & data rates may apply. Reply STOP to opt out, HELP for help.`;
}

export const VERIFICATION_CODE_LENGTH = 6;
/** Minutes a code stays valid. */
export const VERIFICATION_TTL_MINUTES = 10;
/** Sends per phone per window, the first one included. */
export const VERIFICATION_MAX_SENDS = 3;
/** Wrong guesses before the code is burned. */
export const VERIFICATION_MAX_ATTEMPTS = 5;

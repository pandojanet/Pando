/**
 * The invite the *parent* sends (C11).
 *
 * Pando does not contact a nominated caregiver and does not store their details.
 * The only way in is this message, sent by the family who employed them — which is
 * also the version most likely to be trusted, because it arrives from a number
 * they know.
 *
 * Written to be forwarded as-is in a text: short, no links that look like spam,
 * and it says what happens next without promising work.
 *
 * ## The token (23 Sep)
 *
 * The link carries a token naming **the recommendation** it came from, so a
 * caregiver who follows it arrives already attached to the card that put her
 * forward, and an admin confirms rather than guesses (`drizzle/0049`). It is not a
 * way to reach anybody — Pando still holds no contact detail for her
 * (invariant 13) — and it is not authentication: she still proves her number with
 * a code. A message with no token keeps the bare `/caregiver` address, which is
 * still matched by hand.
 *
 * Imports nothing, so a plain node test can load it.
 */

export const CAREGIVER_INVITE_VERSION = "caregiver-invite-2026-09" as const;

/** The host the link is written with. The message is text, not a live anchor. */
const HOST = "pando.is";

const TOKEN_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const TOKEN_LENGTH = 16;

/**
 * A fresh token: 16 characters from [a-z0-9], ~82 bits.
 *
 * Generated in the browser when the card is finished, so the message can be shown
 * at once — a card on the founding path is held on the phone until the parent's
 * code is confirmed, and the invite must not wait for a round trip that may be
 * hours away. `crypto.getRandomValues` exists in every browser this app supports
 * and in Node, so the same function serves the test. Rejection sampling rather
 * than a modulo, so no character is likelier than another.
 */
export function newCaregiverInviteToken(): string {
  const out: string[] = [];
  const buf = new Uint8Array(32);
  while (out.length < TOKEN_LENGTH) {
    crypto.getRandomValues(buf);
    for (const byte of buf) {
      /* 252 is the largest multiple of 36 under 256. */
      if (byte < 252) out.push(TOKEN_ALPHABET[byte % 36]);
      if (out.length === TOKEN_LENGTH) break;
    }
  }
  return out.join("");
}

/** The one shape the database accepts (`caregiver_nominations_invite_token_shape`). */
export function isCaregiverInviteToken(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9]{16}$/.test(value);
}

/**
 * The address in the message. A **path** segment rather than `?t=`, because no
 * query parameter changes what this app does (4 Aug) — `?i=` and `?src=` are the
 * only two read, and they are the product's own link.
 */
export function caregiverInviteUrl(token?: string | null): string {
  return isCaregiverInviteToken(token)
    ? `${HOST}/caregiver/${token}`
    : `${HOST}/caregiver`;
}

interface InviteInput {
  /** The caregiver's first name, as the parent typed it. */
  caregiverFirstName?: string | null;
  /** The nominating parent's first name — the reason this gets read. */
  parentFirstName?: string | null;
  /** This recommendation's token. Without one the bare address is used. */
  token?: string | null;
}

export function caregiverInviteMessage({
  caregiverFirstName,
  parentFirstName,
  token,
}: InviteInput): string {
  const greeting = caregiverFirstName?.trim()
    ? `Hi ${caregiverFirstName.trim()} — `
    : "Hi — ";
  const signature = parentFirstName?.trim() ? `\n\n— ${parentFirstName.trim()}` : "";

  return (
    `${greeting}I recommended you on Pando, a private network parents here use to find people they can trust. ` +
    `Nothing about you is listed until you set up your own profile and say yes.\n\n` +
    `You decide what's visible, and you can delete it at any point. If you'd like to be findable by families near me: ${caregiverInviteUrl(token)}` +
    signature
  );
}

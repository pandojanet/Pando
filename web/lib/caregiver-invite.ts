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
 */

export const CAREGIVER_INVITE_VERSION = "caregiver-invite-2026-08" as const;

interface InviteInput {
  /** The caregiver's first name, as the parent typed it. */
  caregiverFirstName?: string | null;
  /** The nominating parent's first name — the reason this gets read. */
  parentFirstName?: string | null;
}

export function caregiverInviteMessage({
  caregiverFirstName,
  parentFirstName,
}: InviteInput): string {
  const greeting = caregiverFirstName?.trim()
    ? `Hi ${caregiverFirstName.trim()} — `
    : "Hi — ";
  const signature = parentFirstName?.trim() ? `\n\n— ${parentFirstName.trim()}` : "";

  return (
    `${greeting}I recommended you on Pando, a private network parents here use to find people they can trust. ` +
    `Nothing about you is listed until you set up your own profile and say yes.\n\n` +
    `You decide what's visible, and you can delete it at any point. If you'd like to be findable by families near me: pando.is/caregiver` +
    signature
  );
}

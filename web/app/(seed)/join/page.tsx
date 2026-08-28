import { InviteLanding } from "@/components/seed/InviteLanding";
import { recordInviteOpen, validateInviteCode } from "@/lib/server/invite";

/**
 * Estimate 1.1 — Landing / invite + QR entry.
 *
 * The invite code arrives as ?i=<code> on the one shared link (printed as a QR
 * for flyers, forwarded as a link in parent group chats). Validation happens on
 * the server so the code table never ships to the browser.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const first = (key: string) => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };

  const rawCode = first("i") ?? first("invite") ?? null;
  const invite = await validateInviteCode(rawCode);
  const source = first("src") === "qr" ? "qr" : invite.valid ? "link" : "direct";

  /**
   * The open half of estimate 2.2's per-link funnel — "opens vs completions per
   * channel". Completions were already countable from `people.invite_id`; this
   * is the denominator, and without it `/admin/invites` could say a group brought
   * four contributors but never whether that was four out of six or four out of
   * two hundred.
   *
   * Deliberately **not awaited**: it is a metric, and the first screen a parent
   * sees must not wait on a write to the pooler (~200ms warm, over a second
   * cold). `recordInviteOpen` swallows its own failures for the same reason.
   */
  void recordInviteOpen(rawCode);

  return <InviteLanding invite={invite} inviteCode={rawCode} source={source} />;
}

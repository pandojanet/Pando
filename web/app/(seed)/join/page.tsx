import { InviteLanding } from "@/components/seed/InviteLanding";
import { validateInviteCode } from "@/lib/server/invite";

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
  const invite = validateInviteCode(rawCode);
  const source = first("src") === "qr" ? "qr" : invite.valid ? "link" : "direct";

  return <InviteLanding invite={invite} inviteCode={rawCode} source={source} />;
}

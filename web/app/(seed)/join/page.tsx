import { redirect } from "next/navigation";
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

  /**
   * No valid code, no screen — the client's call, 4 Sep: **access is by link
   * only**.
   *
   * `/join` used to answer an arrival without a code by *asking* for one: its own
   * screen, with a field, a "Checking…" button and a manual-entry analytics path.
   * That screen is gone. It was the one place this address was useful to somebody
   * who had not been invited — it told them they had found the right door and
   * only lacked the key — while 1.1's rule is that the founding tool is "shared
   * privately inside parent groups, not published".
   *
   * So an arrival with no code, a retired one or an unknown one is sent to the
   * public site, which is what Pando has to say to somebody not in a parent group
   * yet. **Server-side**, so the seed flow never renders and there is no flash of
   * a form nobody may use.
   *
   * Two things this deliberately does not change. The gate stays *soft* at every
   * other layer — nothing here authenticates anybody, and the write routes still
   * accept a session whose `invite_code` is null, because a link forwarded last
   * week must not become a dead end mid-flow (12 Aug). And it cannot loop:
   * `next.config.ts` rewrites `/` → `/join` only when the request actually
   * carries `?i=`, and this redirect carries none.
   */
  if (!invite.valid) redirect("/");

  return <InviteLanding invite={invite} inviteCode={rawCode} source={source} />;
}

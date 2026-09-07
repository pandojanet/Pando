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
   * ## Entry is open again (7 Sep)
   *
   * This **reverses the 4 Sep decision** recorded in CLAUDE.md — *"access is by
   * link, and the code screen is gone"* — on the client's instruction: the
   * marketing page's "Join the founding network" button comes back and leads
   * straight here, to the name-and-number screen. An arrival with no code, an
   * unknown one or a retired one is a parent now, not an intruder.
   *
   * **What the reversal does not touch, and this is the part to keep straight.**
   * A code is still *resolved* server-side and still means exactly what it meant:
   * attribution. `people.invite_id` records which link somebody arrived on,
   * `invites.opens` counts the arrivals, PostHog carries the code as a
   * super-property, and **no affinity edge is ever written from a link** (12 and
   * 14 Aug) — a forwarded link is evidence somebody shared it, never that whoever
   * opened it belongs to the group or the school. What is gone is only the
   * *gate*: a link no longer decides who may see the screen.
   *
   * So `/admin/invites` keeps its whole job. It stopped being a door and stayed
   * a measurement, which is what estimate 2.2's per-link funnel actually needs.
   *
   * ⚠ The consequence to accept, stated plainly because it is the reason the
   * 4 Sep decision existed: the founding tool is now reachable by anybody who
   * types the address, so 1.1's *"shared privately inside parent groups, not
   * published"* no longer holds at the door. Everything behind it still does —
   * nothing about a named parent is stored before their phone is verified
   * (invariant 11), and founding status is still granted by a person on the
   * second approved contribution.
   */

  return <InviteLanding invite={invite} inviteCode={rawCode} source={source} />;
}

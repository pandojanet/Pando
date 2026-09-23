import { CaregiverFlow } from "@/components/caregiver/CaregiverFlow";
import { CaregiverInviteRequired } from "@/components/caregiver/CaregiverInviteRequired";
import { isCaregiverInviteToken } from "@/lib/caregiver-invite";
import { isDbConfigured, withDb } from "@/lib/server/db";
import { resolveCaregiverInvite } from "@/lib/server/repo/caregiver";
import type { MarketId } from "@/lib/types";

const MARKET: MarketId = "pasadena";

/**
 * `pando.is/caregiver/<token>` — the invite a parent sends, naming the
 * recommendation it came from (23 Sep, `drizzle/0049`), and since the same day
 * the **only** way into the caregiver's flow.
 *
 * Resolved here, on the server, so the only thing that reaches the browser is
 * the caregiver's own name for her to confirm — never an id, and nothing else
 * from the parent's card (invariant 12).
 *
 * ⚠ **A token that names no open recommendation is refused, not waved through.**
 * The first version rendered the ordinary flow for one, so a forwarded or
 * truncated link was not a dead end — and the developer then closed the bare
 * `/caregiver` address. Keeping the fallback would have left that address open
 * under any made-up sixteen characters, so it shows the same "ask for the
 * message again" screen instead. The write route refuses such a claim too.
 *
 * ⚠ With no database the flow renders anyway (the walkable-without-a-database
 * rule): nothing can resolve and nothing is stored.
 */
export default async function CaregiverInvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  if (!isDbConfigured()) return <CaregiverFlow market={MARKET} />;

  const resolved = isCaregiverInviteToken(token)
    ? await withDb((db) => resolveCaregiverInvite(db, token))
    : null;
  const invite = resolved?.persisted ? resolved.data : null;
  if (!invite) return <CaregiverInviteRequired reason="inactive" />;

  return (
    <CaregiverFlow
      market={MARKET}
      invite={{
        token,
        first_name: invite.first_name,
        last_initial: invite.last_initial ?? "",
      }}
    />
  );
}

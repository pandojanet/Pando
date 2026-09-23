import { CaregiverFlow } from "@/components/caregiver/CaregiverFlow";
import { isCaregiverInviteToken } from "@/lib/caregiver-invite";
import { withDb } from "@/lib/server/db";
import { resolveCaregiverInvite } from "@/lib/server/repo/caregiver";
import type { MarketId } from "@/lib/types";

const MARKET: MarketId = "pasadena";

/**
 * `pando.is/caregiver/<token>` — the invite a parent sends, naming the
 * recommendation it came from (23 Sep, `drizzle/0049`).
 *
 * Resolved here, on the server, so the only thing that reaches the browser is
 * the caregiver's own name for her to confirm — never an id, and nothing else
 * from the parent's card (invariant 12).
 *
 * **An unknown, used or malformed token is not a dead end.** It renders the same
 * flow as the bare `/caregiver` address, with nothing filled in: a link forwarded
 * twice, or opened after she was already matched, still lets a person sign up,
 * and an admin matches that sign-up by hand exactly as before. The token is kept
 * and sent with the claim either way — the write route resolves it again, so a
 * token that has since become valid (or invalid) is judged at the moment it
 * matters rather than when the page loaded.
 */
export default async function CaregiverInvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const valid = isCaregiverInviteToken(token);

  const resolved = valid
    ? await withDb((db) => resolveCaregiverInvite(db, token))
    : null;
  const invite =
    resolved && resolved.persisted && resolved.data
      ? {
          token,
          first_name: resolved.data.first_name,
          last_initial: resolved.data.last_initial ?? "",
        }
      : valid
        ? { token, first_name: "", last_initial: "" }
        : undefined;

  return <CaregiverFlow market={MARKET} invite={invite} />;
}

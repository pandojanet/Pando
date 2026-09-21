import { NextResponse } from "next/server";
import { verifyCookie } from "@/lib/server/gate";
import { verifiedPhone } from "@/lib/server/verify";
import { rateLimited } from "@/lib/server/rate-limit";
import { deleteParentByPhone } from "@/lib/server/repo/parent-delete";

/**
 * POST /api/seed/delete — a parent removes their own profile (client §1).
 *
 * ## The phone is never read from the request
 *
 * It comes from `verifiedPhone(verifyCookie(request))`, which is the same
 * server-side record `submitGate` demands before anything may be **written**
 * (invariant 11) and the same one `/api/seed/me` reads. A number in the body
 * would make this an endpoint for deleting *somebody else*, which is the worst
 * thing this app could offer — so there is no body at all.
 *
 * ## Three answers, and the third is why the second is not the fallback
 *
 * `deleted` · `no_profile` · `unavailable`. Telling somebody who has a profile
 * that they never did is the one wrong answer available here, so an unreachable
 * database says so rather than collapsing into "nothing to delete" — the
 * `persisted: false` rule applied to a destructive act.
 *
 * ## It is no longer the only door (14 Sep)
 *
 * `DELETE` over SMS runs the same `deleteParentByPhone`, because `/privacy`
 * had been promising every parent that word while only a caregiver could use
 * it. Nothing here changed except what that function now also takes down: a
 * linked caregiver listing, which `on delete set null` had been leaving
 * behind — latent in this route from the day it shipped.
 *
 * ## No confirmation step here
 *
 * The confirmation belongs on the screen, where the consequence can be read
 * before the tap; a route that required a second call would be a second place
 * to get the same decision wrong. This one acts. ⚠ That is the `claim.delete`
 * rule (11.3) and the reason is the copy: the screen states what goes and what
 * stays, so by the time this is called the decision is made.
 */
export async function POST(request: Request) {
  /* Its own bucket would be wrong — this is destructive, so it takes the
     tightest write limit the app has rather than a friendlier one sized for a
     roomful of parents signing up together. */
  const limited = rateLimited(request, "seed_write");
  if (limited) return limited;

  const verified = await verifiedPhone(verifyCookie(request));
  if (!verified) {
    return NextResponse.json(
      { error: "Confirm your number first" },
      { status: 401 },
    );
  }

  const outcome = await deleteParentByPhone(verified.phone, "web:profile_delete");

  /* Counts and enums only (invariant 7) — never the number, never a name. */
  console.info("[seed:delete]", {
    status: outcome.status,
    contributions_detached:
      outcome.status === "deleted" ? outcome.contributions : 0,
  });

  if (outcome.status === "unavailable") {
    return NextResponse.json(
      { error: "We could not reach the record just now. Nothing was deleted." },
      { status: 503 },
    );
  }

  return NextResponse.json({
    deleted: outcome.status === "deleted",
    /* What stayed, so the screen can say it rather than imply it. */
    contributions_kept:
      outcome.status === "deleted" ? outcome.contributions : 0,
  });
}

import { NextResponse } from "next/server";
import { withDb } from "@/lib/server/db";
import { sql } from "drizzle-orm";
import { verifyCookie } from "@/lib/server/gate";
import { verifiedPhone } from "@/lib/server/verify";
import { rateLimited } from "@/lib/server/rate-limit";
import { ensureReferralLink } from "@/lib/server/repo/referral";

/**
 * GET /api/seed/me — who the confirmed number belongs to.
 *
 * Her second instruction is that a parent can come back and authenticate again
 * with their number and a code. The OTP machinery for that already existed —
 * `/verify/start`, `/verify/check` and the 12-hour `pando_verify` cookie
 * (`VERIFICATION_SESSION_HOURS`) — and what was missing is this: a way for the
 * browser to learn *who* the confirmed number is, because the profile itself
 * lives in `localStorage` on the device that filled it in and a parent signing
 * in from a new phone has none of it.
 *
 * ## The phone is never read from the request
 *
 * It comes from `verifiedPhone(verifyCookie(request))`, which is the same
 * server-side record `submitGate` uses to decide whether anything may be
 * stored at all. A phone in the body would make this an endpoint that hands out
 * a stranger's name and referral link to anybody who can type ten digits —
 * which is the whole reason invariant 11 exists.
 *
 * ## What it will say about a number with no profile
 *
 * `found: false`, and nothing else. Not "no such parent" versus "that parent
 * has not finished" — the caller has proved they hold the number, so the
 * distinction is safe to *them*, but it is not information this endpoint needs
 * to produce and the sign-in screen reads the same either way.
 *
 * The anonymous path has no phone, so it can never reach this and can never be
 * signed back in to. That is what the entry screen promised: no name, no
 * number, no founding status, and nothing to come back to.
 */
export async function GET(request: Request) {
  /* Cheap and read-only, but it is an identity endpoint: the limit is what stops
     a stolen cookie being replayed in a loop while somebody enumerates. */
  const limited = rateLimited(request, "verify_check");
  if (limited) return limited;

  const verified = verifiedPhone(verifyCookie(request));
  if (!verified) {
    return NextResponse.json(
      { ok: false, reason: "verification_required" },
      { status: 401 },
    );
  }

  const result = await withDb(async (db) => {
    const rows = (await db.execute(
      sql`select p.id, p.first_name, p.market_id, p.wants_founding, p.founding,
                 p.profile_captured_at,
                 (select i.code from invites i where i.referrer_person_id = p.id limit 1)
                   as referral_code
            from people p
           where p.phone = ${verified.phone}
           limit 1`,
    )) as unknown as Array<{
      id: string;
      first_name: string | null;
      market_id: string;
      wants_founding: boolean;
      founding: string;
      profile_captured_at: string | null;
      referral_code: string | null;
    }>;
    const person = rows[0];
    if (!person) return null;

    /**
     * The one write on a GET, and it is deliberate.
     *
     * A parent who completed their profile *before* `drizzle/0034` has no
     * personal link, so the thank-you screen her third instruction describes
     * would be empty for exactly the people who have been here longest — and
     * the only other place a link is minted is the profile write, which a
     * returning parent is not going to run again.
     *
     * Safe as a GET because it is **bounded, not merely idempotent**:
     * `invites_referrer_person_uniq` is a partial unique index on
     * `referrer_person_id`, so this can create at most one row per person for
     * all time and a replayed request after the first creates nothing. A
     * failure is not fatal here — the panel is simply absent — so it never
     * turns "who am I" into an error.
     */
    if (!person.referral_code) {
      const minted = await ensureReferralLink(db, {
        id: person.id,
        first_name: person.first_name,
        market_id: person.market_id,
      }).catch(() => null);
      if (minted) return { ...person, referral_code: minted };
    }
    return person;
  });

  /**
   * `withDb` answers `configured: false` rather than pretending, and this
   * endpoint says so rather than reporting "no profile" — the same honesty rule
   * as `persisted: false`. Telling a parent who has a profile that they have
   * none is the one wrong answer here.
   */
  if (!result.persisted) {
    return NextResponse.json({ ok: false, reason: "not_configured" }, { status: 503 });
  }

  const person = result.data;
  if (!person) return NextResponse.json({ ok: true, found: false });

  return NextResponse.json({
    ok: true,
    found: true,
    /* Their own first name, their own link, and whether the profile is in.
       Nothing about anybody else, and no free text (invariant 7). */
    first_name: person.first_name,
    wants_founding: person.wants_founding !== false,
    founding: person.founding,
    profile_saved: person.profile_captured_at !== null,
    referral_code: person.referral_code,
  });
}

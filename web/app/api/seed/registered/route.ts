import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { withDb } from "@/lib/server/db";
import { toE164 } from "@/lib/phone";
import { rateLimited } from "@/lib/server/rate-limit";

/**
 * POST /api/seed/registered — does this number already have a profile?
 *
 * ## Read this before changing anything here, including "hardening" it
 *
 * ⚠ **This endpoint answers a question about somebody who has proved nothing,
 * and that is a decision the client took on 8 Sep with the cost named.** Her
 * instruction: when the basic details are filled in on `/join` and the parent
 * taps through, check the number and do not let a registered one into the
 * questionnaire — *"бо інформація затирається"*.
 *
 * She is right about the harm. The profile write is `onConflictDoUpdate` on
 * `people.phone` (invariant 10) and every derived set is **replaced rather than
 * merged**, deliberately, so a parent filling the form again from a second
 * device silently overwrote the richer profile they gave the first time. Until
 * now the only warning came *after* the code, i.e. after eighteen screens of
 * work — see `ProfileFlow.afterVerified`, which still runs and is now the second
 * line rather than the first.
 *
 * ⚠ **What it costs, and it is not recoverable once spent.** Anybody can type a
 * neighbour's number here and learn whether that neighbour is in Pando.
 * CLAUDE.md's own words are that who is in the network *"is the asset, and it is
 * exactly what this product does not publish"*, and the 8 Sep decision put the
 * check behind the code for precisely this reason. That reasoning has not
 * changed; the client has weighed it against the overwrite and chosen. What is
 * gathered through this door cannot be un-gathered, so the four rules below are
 * the whole of the mitigation and none of them is decoration.
 *
 * **(1) A boolean, and nothing else.** No name, no founding status, no
 * neighborhood, no "when". The answer says *a profile exists*, never *whose*.
 * Adding a field here to make a screen friendlier is how this becomes a
 * directory.
 *
 * **(2) `profile_captured_at`, not the row.** `people` gains a row for a cold
 * inbound text (5.9) and for anybody who verified and abandoned, and neither is
 * somebody with answers to overwrite. Keying on the row would refuse entry to a
 * stranger who once texted the number — and would leak a wider fact than the
 * one being asked about.
 *
 * **(3) It fails open.** No database, an unreachable pooler, an unparseable
 * number: `registered: false`, and the parent goes on into the flow. The
 * `persisted: false` rule applied to a read — turning a warning into a wall when
 * a query does not come back would take the tool offline for people who have
 * done nothing wrong, and the code at the end still catches the case.
 *
 * **(4) Rate-limited on its own bucket**, `phone_lookup`, which is sized in
 * `lib/rate-limits.ts` for a roomful of parents rather than for an attacker —
 * and whose comment says plainly that it makes enumeration slow rather than
 * impossible. Nothing keyed to the caller can do better; only asking for the
 * code first could, and that is the thing this replaces.
 *
 * **And it logs nothing.** Not the number, not the answer, not a count keyed to
 * either (invariant 7). A log line here would be the directory this is trying
 * not to be, written down.
 */
export async function POST(request: Request) {
  const limited = rateLimited(request, "phone_lookup");
  if (limited) return limited;

  const body = (await request.json().catch(() => null)) as {
    phone?: unknown;
  } | null;

  /* `toE164` is the same parser the write routes use, so "is this number
     registered" and "which row would this number write to" can never disagree
     about what the digits mean — the US/Ukraine rules in `lib/phone.ts` are not
     obvious enough to restate. */
  const phone = typeof body?.phone === "string" ? toE164(body.phone) : null;
  if (!phone) return NextResponse.json({ ok: true, registered: false });

  const result = await withDb(async (db) => {
    const rows = (await db.execute(
      sql`select 1 as hit
            from people
           where phone = ${phone}
             and profile_captured_at is not null
           limit 1`,
    )) as unknown as Array<{ hit: number }>;
    return rows.length > 0;
  });

  /* See rule 3: an unreachable store answers "no" rather than refusing. */
  return NextResponse.json({
    ok: true,
    registered: result.persisted ? result.data === true : false,
  });
}

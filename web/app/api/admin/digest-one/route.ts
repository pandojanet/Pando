import { NextResponse, after } from "next/server";
import { cookies } from "next/headers";
import { ADMIN_COOKIE } from "@/lib/admin/auth";
import { readAdminSession } from "@/lib/server/admin-auth";
import { refuseForeignAdminWrite } from "@/lib/admin/request-guard";
import { quietWindowPhrase } from "@/lib/markets";
import { toE164 } from "@/lib/phone";
import { getDb } from "@/lib/server/db";
import { auditDigestOne, digestFamilyByPhone } from "@/lib/server/repo/digest";
import { prepareDigestFor, sendDigestTo } from "@/lib/server/repo/jobs";

/**
 * POST /api/admin/digest-one — the weekly digest for one number (19 Nov).
 *
 * The developer, with every scheduled job paused while the product is tested:
 * prepare the digest job and its send for a number they give. Body
 * `{ step: "prepare" | "send", phone }`.
 *
 *  - `prepare` answers at once (`202`) and runs the agent after the response:
 *    a search takes minutes, and the edition it stores shows under Test on
 *    /admin/digests to approve like any other.
 *  - `send` sends that family's approved test edition to that number only.
 *
 * Not in `/api/admin/action`, which holds one transaction per press — the
 * agent's minutes must not. Behind the admin session (it spends money and
 * texts a person); each press is an audit row with the person, never the
 * phone (invariant 7). No digest consent is asked — the developer's choice for
 * testing; STOP and quiet hours still apply (`sendSms`).
 */
export const dynamic = "force-dynamic";

const REFUSALS: Record<string, string> = {
  no_person: "Nobody on Pando has that number.",
  not_prepared: "Prepare this number's digest first.",
  preparing: "The search for this number's group has not finished yet — try again in a few minutes.",
  not_approved: "Approve this number's group under Test on this page first.",
  nothing_suits: "Nothing in the approved digests suits this family's children.",
  not_sent: "Nothing went out.",
};

/** Why the send layer refused, said as itself rather than as a list of guesses. */
const SEND_REASONS: Record<string, string> = {
  quiet_hours: `Nothing went out — it is outside ${quietWindowPhrase()}. Send again then.`,
  opted_out: "Nothing went out — this number has texted STOP.",
  not_provisioned: "Nothing went out — no messaging provider is configured here.",
  provider_error: "Nothing went out — the messaging provider refused it. Try again in a minute.",
};

export async function POST(request: Request) {
  const refused = refuseForeignAdminWrite(request, "digest-one");
  if (refused) return refused;
  const session = await readAdminSession((await cookies()).get(ADMIN_COOKIE)?.value);
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { step?: unknown; phone?: unknown } | null;
  const step = body?.step === "prepare" || body?.step === "send" ? body.step : null;
  const phone = typeof body?.phone === "string" ? toE164(body.phone) : null;
  if (!step) return NextResponse.json({ error: "Unknown step" }, { status: 400 });
  if (!phone) return NextResponse.json({ error: "That is not a phone number" }, { status: 422 });
  if (!getDb()) return NextResponse.json({ ok: false, configured: false, reason: "no_database" });

  if (step === "prepare") {
    /* Found before answering, so a wrong number is said now rather than after the search. */
    const family = await digestFamilyByPhone(phone, new Date().toISOString().slice(0, 10));
    if (!family) return NextResponse.json({ error: REFUSALS.no_person, reason: "no_person" }, { status: 404 });
    await auditDigestOne(session.user, "digest.prepare_for", family.person_id, { step });
    after(async () => {
      try {
        const outcome = await prepareDigestFor(phone);
        console.info("[admin:digest-one] prepared", { ok: outcome.ok, reason: outcome.ok ? null : outcome.reason });
      } catch (err) {
        console.error("[admin:digest-one] prepare failed:", err instanceof Error ? err.constructor.name : "unknown");
      }
    });
    return NextResponse.json({ ok: true, step, preparing: true }, { status: 202 });
  }

  try {
    const outcome = await sendDigestTo(phone);
    const personId = (await digestFamilyByPhone(phone, new Date().toISOString().slice(0, 10)))?.person_id ?? null;
    await auditDigestOne(session.user, "digest.send_to", personId, {
      step,
      edition_date: outcome.edition_date ?? null,
      ...(outcome.ok ? { items: outcome.sent ?? 0 } : { refused: outcome.reason }),
    });
    if (!outcome.ok) {
      const said = (outcome.detail && SEND_REASONS[outcome.detail]) ?? REFUSALS[outcome.reason] ?? "Nothing went out.";
      return NextResponse.json({ error: said, reason: outcome.reason }, { status: 409 });
    }
    return NextResponse.json({ ok: true, step, edition_date: outcome.edition_date, sent: outcome.sent ?? 0 });
  } catch (err) {
    console.error("[admin:digest-one] send failed:", err instanceof Error ? err.constructor.name : "unknown");
    return NextResponse.json({ error: "The send didn't finish" }, { status: 502 });
  }
}

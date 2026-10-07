import { NextResponse } from "next/server";
import { demandFromBody } from "@/lib/server/demand-body";
import { verifyCookie } from "@/lib/server/gate";
import { verifiedPhone } from "@/lib/server/verify";
import { withDb } from "@/lib/server/db";
import { findPersonByPhone } from "@/lib/server/repo/profile";
import { writeDemandEdit } from "@/lib/server/repo/completion";
import { rateLimited } from "@/lib/server/rate-limit";

/**
 * POST /api/seed/demand — a parent edits their D1 after the completion (7 Oct).
 *
 * Body: `{ demand: { question_text, category, may_save } | null, is_test }`.
 * `null` (or a question with nothing to keep) withdraws it. See `writeDemandEdit`
 * for which row is "the same question" and what withdrawing deletes.
 *
 * ## Who is editing — the verification, never the body
 *
 * ⚠ It takes **no phone from the request**. The other seed writes accept one and
 * check it against the confirmed number — and with `SEED_REQUIRE_VERIFICATION=0`
 * they accept it unchecked, which for a write that *creates* a parent's own rows is
 * the pilot's known trade. This one *changes and deletes* rows that already exist,
 * so a body naming somebody else's number would rewrite their question. The person
 * is whoever the verification cookie confirmed, with the switch on or off, and
 * without one the answer is 401: the client asks for a fresh code and sends again.
 *
 * The anonymous path has no confirmed number and so cannot edit — its D1 was
 * stored without a person, and nothing could tell its owner from anybody else.
 */
export async function POST(request: Request) {
  const limited = rateLimited(request, "seed_write");
  if (limited) return limited;

  const raw = (await request.json().catch(() => null)) as {
    demand?: unknown;
    is_test?: unknown;
  } | null;
  if (!raw) {
    return NextResponse.json({ error: "Malformed body" }, { status: 400 });
  }

  const verified = await verifiedPhone(verifyCookie(request));
  if (!verified) {
    console.info("[seed:demand] blocked", { reason: "verification_required" });
    return NextResponse.json(
      { error: "Phone verification required", reason: "verification_required" },
      { status: 401 },
    );
  }

  const demand = demandFromBody(raw.demand);
  const isTest = raw.is_test === true;

  const result = await withDb(async (db) => {
    const person = await findPersonByPhone(db, verified.phone);
    if (!person) return null;
    return writeDemandEdit(db, { person_id: person.id, demand, is_test: isTest });
  });

  if (!result.persisted) {
    if (result.reason === "unconfigured") {
      return NextResponse.json({ ok: true, persisted: false });
    }
    return NextResponse.json(
      { error: "Could not record that right now" },
      { status: 502 },
    );
  }
  if (result.data === null) {
    /* Confirmed number, no person behind it: nothing of theirs to edit. */
    return NextResponse.json({ error: "No profile for this number" }, { status: 404 });
  }

  // Counts and enums only — never a phone number, name or the question (inv. 7).
  console.info("[seed:demand] stored", {
    outcome: result.data.outcome,
    sensitivity: demand?.sensitivity ?? null,
    escalated: result.data.flagged,
  });

  return NextResponse.json({ ok: true, persisted: true, outcome: result.data.outcome });
}

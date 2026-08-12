import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { toE164 } from "@/lib/phone";
import { cleanE164, cleanId, cleanName, cleanText } from "@/lib/sanitize";
import { submitGate } from "@/lib/server/gate";
import { withDb } from "@/lib/server/db";
import { saveCaregiverClaim } from "@/lib/server/repo/caregiver";
import {
  CAREGIVER_AGE_BANDS,
  CAREGIVER_AVAILABLE_FROM,
  CAREGIVER_DAYS,
  CAREGIVER_PAY_BANDS,
  CAREGIVER_STRENGTHS,
  CAREGIVER_TYPES,
} from "@/lib/caregiver-options";

/**
 * POST /api/caregiver/claim — 2C, a caregiver's own profile (G1–G10).
 *
 * Enforced here rather than trusted from the client:
 *
 *  - **the phone must be verified** (invariant 11). Same gate as the seed routes,
 *    same reason: a rule the UI alone keeps is not a rule. Nothing about a person
 *    is stored until they have proved the number is theirs.
 *  - **every tap is checked against the option list it came from.** A caregiver's
 *    strengths and ages are what matching keys on, so an unrecognised id would be a
 *    value nothing can ever match — silently unfindable rather than loudly wrong.
 *  - **only a last initial**, never a surname.
 *  - **being introduced cannot outlive appearing in answers.** The larger permission
 *    is dropped rather than the request refused (see the repo for why).
 *  - **nothing here can make the caregiver visible.** There is no field a client can
 *    send that reaches `caregivers.active`, `discoverable` or `consent_status` — a
 *    claim is not a listing, and only an admin linking it to a real nomination turns
 *    it into one.
 */

const MAX_NOTE = 300;

/** Ids only, and only from the list the screen actually offered. */
function only(values: unknown, allowed: ReadonlyArray<{ id: string }>): string[] {
  if (!Array.isArray(values)) return [];
  const ids = new Set(allowed.map((o) => o.id));
  return values
    .filter((v): v is string => typeof v === "string" && ids.has(v))
    .slice(0, 24);
}

function oneOf(
  value: unknown,
  allowed: ReadonlyArray<{ id: string }>,
): string | null {
  return typeof value === "string" && allowed.some((o) => o.id === value)
    ? value
    : null;
}

export async function POST(request: Request) {
  const raw = (await request.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  if (!raw) {
    return NextResponse.json({ error: "Nothing to save" }, { status: 400 });
  }

  const phone = cleanE164(
    typeof raw.phone === "string" ? (toE164(raw.phone) ?? raw.phone) : null,
  );
  if (!phone) {
    return NextResponse.json(
      { error: "A mobile number is needed so only you can set this up" },
      { status: 422 },
    );
  }

  /* G2 is the permission that lets any of this be stored. Without it there is
     nothing to write, and the flow does not offer a way past it. */
  if (raw.profile_consent !== true) {
    return NextResponse.json(
      { error: "Pando can only keep a profile you've agreed to" },
      { status: 422 },
    );
  }

  const firstName = cleanName(raw.first_name);
  if (!firstName) {
    return NextResponse.json(
      { error: "A first name is needed — families see that, and nothing more" },
      { status: 422 },
    );
  }

  const gate = submitGate(request, { phone });
  if (!gate.allowed) {
    console.info("[caregiver:claim] blocked", { reason: gate.reason });
    return NextResponse.json(
      { error: "Confirm the code we texted you first", reason: gate.reason },
      { status: 401 },
    );
  }

  const appearInAnswers = raw.appear_in_answers === true;
  const drives = oneOf(raw.drives, [{ id: "yes" }, { id: "no" }]);

  // Counts and enums only — never a name, a number or the free-text note.
  console.info("[caregiver:claim]", {
    roles: only(raw.roles_wanted, CAREGIVER_TYPES).length,
    ages: only(raw.age_experience, CAREGIVER_AGE_BANDS).length,
    strengths: only(raw.strengths, CAREGIVER_STRENGTHS).length,
    appear_in_answers: appearInAnswers,
    introductions: appearInAnswers && raw.open_to_introductions === true,
    references: raw.open_to_reference_intros === true,
  });

  const result = await withDb((db) =>
    saveCaregiverClaim(db, {
      phone,
      first_name: firstName,
      /* An initial, upper-cased. `char(1)` in the database would refuse more. */
      last_initial:
        (cleanText(raw.last_initial, 1) ?? "").toUpperCase() || null,
      market_id: cleanId(raw.market_id) ?? "pasadena",
      roles_wanted: only(raw.roles_wanted, CAREGIVER_TYPES),
      age_experience: only(raw.age_experience, CAREGIVER_AGE_BANDS),
      strengths: only(raw.strengths, CAREGIVER_STRENGTHS),
      /* Neighborhoods are market data rather than a fixed list, so these are
         sanitised as slugs instead of matched against an enum. An unknown one
         becomes a value nothing matches, which is the same failure mode as an
         "other" answer before promotion (invariant 9) — visible to an admin,
         inert everywhere else. */
      areas_served: Array.isArray(raw.areas_served)
        ? raw.areas_served
            .filter((v): v is string => typeof v === "string")
            .map((v) => cleanId(v))
            .filter((v): v is string => v !== null)
            .slice(0, 24)
        : [],
      drives: drives === null ? null : drives === "yes",
      days_available: only(raw.days_available, CAREGIVER_DAYS),
      available_from: oneOf(raw.available_from, CAREGIVER_AVAILABLE_FROM),
      hours_note: cleanText(raw.hours_note, MAX_NOTE),
      rate_band: oneOf(raw.rate_band, CAREGIVER_PAY_BANDS),
      open_to_reference_intros: raw.open_to_reference_intros === true,
      appear_in_answers: appearInAnswers,
      open_to_introductions: raw.open_to_introductions === true,
      /* Session-level only, and never accepted from the client body. */
      is_test: false,
    }),
  );

  if (!result.persisted) {
    if (result.reason === "unconfigured") {
      /* The same honesty rule as every other write path: with no database the
         flow completes and says so, rather than claiming a profile exists. */
      return NextResponse.json({
        ok: true,
        claim_id: randomUUID(),
        persisted: false,
      });
    }
    return NextResponse.json(
      { error: "We couldn't save that right now" },
      { status: 502 },
    );
  }

  console.info("[caregiver:claim] stored", { updated: result.data.updated });

  return NextResponse.json({
    ok: true,
    claim_id: result.data.claim_id,
    persisted: true,
    updated: result.data.updated,
  });
}

import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { toE164 } from "@/lib/phone";
import { cleanE164, cleanId, cleanName, cleanText } from "@/lib/sanitize";
import { validateInviteCode } from "@/lib/server/invite";
import { submitGate } from "@/lib/server/gate";
import { getDb, withDb } from "@/lib/server/db";
import { saveCard, type CardKind } from "@/lib/server/repo/cards";
import { scheduleExtraction } from "@/lib/server/repo/flags";
import { findPersonByPhone } from "@/lib/server/repo/profile";

/**
 * POST /api/seed/save — one finished capture card (spec §16.1).
 *
 * Enforced here rather than trusted from the client:
 *  - a caregiver nomination is rejected unless the 18-or-older gate says yes
 *    (spec §12, estimate 11.2 — minors are never listed);
 *  - a caregiver is always forwarded as consent_status "pending" and
 *    active false, whatever the client sends (spec §3.5 CRITICAL);
 *  - only a last *initial* is stored, never a surname;
 *  - free text is capped at 500 characters and stripped of control characters
 *    (spec §19).
 */

const KINDS = new Set(["activity", "caregiver", "place", "tip"]);
const MAX_TEXT = 500;
const TEXT_FIELDS = new Set([
  "name",
  "tip",
  "what_makes_it_great",
  "what_makes_special",
  "caveat",
  "private_note",
  "hesitation_reason",
]);

type RawFields = Record<string, unknown>;

/**
 * Never accepted from the client, whatever it sends: these are decided by Pando
 * (consent, activation, trust, moderation state). A contributor's device must not
 * be able to smuggle `consent_status: "consented"` into the record.
 */
const RESERVED_FIELDS = new Set([
  "is_test",
  /* A caregiver's contact details are not collected any more and must not arrive
     from an older client either: Pando never contacts them, the nominating parent
     sends the invite themselves (client's July question set, Part 2B). */
  "contact",
  "caregiver_phone",
  "caregiver_email",
  // The chat sets a hold to tell the parent what's happening; the record's hold is
  // re-derived from the answers below, so it can be added but never taken away.
  "review_hold",
  "hold_reason",
  "consent_status",
  "active",
  "trust_level",
  "status",
  "approved_at",
  "validated_count",
  "vouch_count",
  "last_validated",
  "freshness_date",
  "contributor_id",
  "user_id",
  "id",
]);

function cleanFields(fields: RawFields): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(fields)) {
    if (RESERVED_FIELDS.has(key)) continue;

    if (typeof value === "string") {
      out[key] = TEXT_FIELDS.has(key)
        ? cleanText(value, MAX_TEXT)
        : (cleanId(value) ?? cleanText(value, 80));
      continue;
    }
    if (Array.isArray(value)) {
      if (value.every((v) => typeof v === "number")) {
        out[key] = value
          .filter((n) => Number.isInteger(n) && n >= -1 && n <= 25)
          .slice(0, 12);
      } else {
        out[key] = value
          .filter((v): v is string => typeof v === "string")
          .map((v) => cleanId(v) ?? cleanText(v, 80))
          .filter((v): v is string => v !== null)
          .slice(0, 20);
      }
    }
  }

  return out;
}

export async function POST(request: Request) {
  const raw = (await request.json().catch(() => null)) as {
    invite_code?: unknown;
    source?: unknown;
    is_test?: unknown;
    contributor_name?: unknown;
    contributor_phone?: unknown;
    submission?: {
      id?: unknown;
      kind?: unknown;
      fields?: RawFields;
      created_at?: unknown;
    };
  } | null;

  const kind = typeof raw?.submission?.kind === "string" ? raw.submission.kind : "";
  if (!raw?.submission || !KINDS.has(kind)) {
    return NextResponse.json({ error: "Unknown share kind" }, { status: 400 });
  }

  const invite = await validateInviteCode(
    typeof raw.invite_code === "string" ? raw.invite_code : null,
  );

  const contributorPhone = cleanE164(
    typeof raw.contributor_phone === "string"
      ? (toE164(raw.contributor_phone) ?? raw.contributor_phone)
      : null,
  );

  /* A card belonging to a named contributor is only stored once that contributor's
     number is verified — the cards sit on their phone until then. An anonymous
     contribution has no number to verify and no founding status. */
  const gate = submitGate(request, { phone: contributorPhone });
  if (!gate.allowed) {
    console.info("[seed:save] blocked", { kind, reason: gate.reason });
    return NextResponse.json(
      { error: "Phone verification required", reason: gate.reason },
      { status: 401 },
    );
  }

  const fields = cleanFields(raw.submission.fields ?? {});

  const record: Record<string, unknown> = {
    kind,
    market_id: invite.market_id,
    invite_code: invite.valid ? raw.invite_code : null,
    source: cleanId(raw.source) ?? "direct",
    // Session-level flag only — never accepted from inside `fields` (see above).
    is_test: raw.is_test === true,
    contributor_name: cleanName(raw.contributor_name),
    contributor_phone: contributorPhone,
    contributor_phone_verified_at: gate.verified_at,
    client_id: cleanText(raw.submission.id, 64),
    fields,
    received_at: new Date().toISOString(),
  };

  if (kind === "caregiver") {
    if (fields.age_gate !== "yes") {
      return NextResponse.json(
        { error: "Caregiver nominations require confirmation of age 18+" },
        { status: 422 },
      );
    }

    /* C1 is a hard gate, not a preference: firsthand employment only. */
    if (fields.worked_for_you !== "yes") {
      return NextResponse.json(
        { error: "Caregiver nominations require firsthand employment" },
        { status: 422 },
      );
    }

    // The chat sends [first, initial]; store them apart and drop anything longer.
    const nameParts = Array.isArray(fields.name) ? (fields.name as string[]) : [];
    record.first_name = cleanText(nameParts[0], 30);
    record.last_initial = (cleanText(nameParts[1], 1) ?? "").toUpperCase() || null;
    delete (fields as RawFields).name;

    // Never activatable from the contributor side (spec §3.5, §12).
    record.consent_status = "pending";
    record.active = false;
    record.reference_willing = fields.reference_willing ?? null;

    /**
     * There is exactly one path in: the nominating parent sends the invite. Pando
     * never reaches out, so this records whether the parent took the invite step —
     * not who does the asking.
     */
    record.consent_outreach =
      fields.send_invite === "yes" ? "parent_sent_invite" : "not_invited";

    /**
     * Pay: stored either way, poolable only on an explicit yes. Two decisions, so
     * two fields — an unanswered consent step is a no.
     */
    record.pay_band = fields.pay_band ?? null;
    record.pay_benchmark_consent = fields.pay_benchmark_ok === "yes";

    /**
     * Held for a human. Derived from the answers, not from what the client claims:
     * "wouldn't hire again" and a private note about a named person are both things
     * no automated path should be able to release (invariant 8).
     */
    const privateNote =
      typeof fields.private_note === "string" ? fields.private_note.trim() : "";
    const hesitation =
      typeof fields.hesitation_reason === "string"
        ? fields.hesitation_reason.trim()
        : "";
    const holds: string[] = [];
    if (fields.hire_again === "no") holds.push("hire_again_no");
    if (fields.hire_again === "hesitant") holds.push("hire_again_hesitant");
    if (privateNote !== "") holds.push("private_note");
    if (hesitation !== "") holds.push("hesitation_reason");
    record.review_hold = holds.length > 0;
    record.hold_reasons = holds;
    /**
     * Restricted, both of them: never shown to a family, never shown to the
     * caregiver, never AI-summarized. They exist so a person can decide whether to
     * list someone at all.
     */
    record.private_note = privateNote || null;
    record.hesitation_reason = hesitation || null;
    delete (fields as RawFields).private_note;
    delete (fields as RawFields).hesitation_reason;
  }

  // Counts and enums only — no names, numbers or free text (spec §19).
  console.info("[seed:save]", {
    kind,
    market_id: record.market_id,
    invite_valid: invite.valid,
    is_test: record.is_test,
    fields: Object.keys(fields).length,
    caregiver_consent: kind === "caregiver" ? "pending" : undefined,
    consent_outreach: kind === "caregiver" ? record.consent_outreach : undefined,
    review_hold: kind === "caregiver" ? record.review_hold : undefined,
    hold_reasons: kind === "caregiver" ? record.hold_reasons : undefined,
    pay_benchmark_consent:
      kind === "caregiver" ? record.pay_benchmark_consent : undefined,
  });

  const result = await withDb(async (db) => {
    /**
     * A card is attached to its contributor by the phone the gate just verified.
     * The anonymous path has none, and its cards are stored with a null
     * person_id — welcome, labelled, and never qualifying for Founding.
     */
    const person = contributorPhone
      ? await findPersonByPhone(db, contributorPhone)
      : null;

    return saveCard(db, {
      kind: kind as CardKind,
      market_id: invite.market_id,
      is_test: raw.is_test === true,
      client_id: (record.client_id as string | null) ?? null,
      person_id: person?.id ?? null,
      fields,
      first_name: (record.first_name as string | null) ?? null,
      last_initial: (record.last_initial as string | null) ?? null,
      review_hold: record.review_hold === true,
      hold_reasons: (record.hold_reasons as string[] | undefined) ?? [],
      private_note: (record.private_note as string | null) ?? null,
      hesitation_reason: (record.hesitation_reason as string | null) ?? null,
      pay_band: (record.pay_band as string | null) ?? null,
      pay_benchmark_consent: record.pay_benchmark_consent === true,
      reference_willing: (record.reference_willing as string | null) ?? null,
      consent_outreach: (record.consent_outreach as string | undefined) ?? undefined,
    });
  });

  if (!result.persisted) {
    if (result.reason === "unconfigured") {
      return NextResponse.json({
        ok: true,
        record_id: randomUUID(),
        persisted: false,
      });
    }
    return NextResponse.json(
      { error: "Could not save that right now" },
      { status: 502 },
    );
  }

  console.info("[seed:save] stored", {
    kind,
    updated: result.data.updated,
  });

  /**
   * Extraction and flagging (1.8/1.9) run after this response, never before it.
   * They are a network call to another API, and a parent tapping "save" should
   * not wait on our metadata — if it fails or the process restarts mid-flight,
   * `sweepExtraction` picks the card up later.
   *
   * Caregiver cards are excluded on purpose: their free text is the restricted
   * note, and a restricted note is never AI-summarized (invariant 12).
   */
  if (kind !== "caregiver") {
    const db = getDb();
    if (db) scheduleExtraction(db, result.data.record_id);
  }

  return NextResponse.json({
    ok: true,
    record_id: result.data.record_id,
    persisted: true,
  });
}

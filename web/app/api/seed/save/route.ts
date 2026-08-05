import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { toE164 } from "@/lib/phone";
import { cleanE164, cleanId, cleanName, cleanText } from "@/lib/sanitize";
import { validateInviteCode } from "@/lib/server/invite";
import { submitGate } from "@/lib/server/gate";
import { forwardToN8n, isHookConfigured } from "@/lib/server/n8n";

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

  const invite = validateInviteCode(
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

  if (!isHookConfigured("save")) {
    return NextResponse.json({ ok: true, record_id: randomUUID(), persisted: false });
  }

  const result = await forwardToN8n<{
    record_id?: string;
    /**
     * A capture workflow may validate and shape without storing — the 1.5/1.6
     * scenario runs that way before Supabase exists. Report what it says about
     * itself rather than assuming a write happened.
     */
    persisted?: boolean;
    would_write?: Record<string, number>;
    review_queue?: unknown[];
    invariants?: Record<string, unknown>;
  }>("save", record);

  if (!result.forwarded) {
    console.error("[seed:save] n8n forward failed", result.error ?? result.reason);
    return NextResponse.json(
      { error: "Could not save that right now" },
      { status: 502 },
    );
  }

  const persisted = result.data.persisted !== false;

  if (result.data.would_write || result.data.invariants) {
    console.info("[seed:save] workflow", {
      kind,
      persisted,
      would_write: result.data.would_write ?? null,
      review_queued: Array.isArray(result.data.review_queue)
        ? result.data.review_queue.length
        : null,
      // Echoed by the workflow so a broken safety rule is visible in the log,
      // not only in whatever ends up in the database.
      invariants_ok:
        result.data.invariants === undefined
          ? null
          : Object.values(result.data.invariants).every((v) => v !== false),
    });
  }

  return NextResponse.json({
    ok: true,
    record_id: result.data.record_id ?? null,
    persisted,
  });
}

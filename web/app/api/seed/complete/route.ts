import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { CONSENT_TEXT_VERSION, SMS_CONSENT_TEXT_VERSION } from "@/lib/consent";
import { classifyDemand, needsHumanReview } from "@/lib/demand";
import { toE164 } from "@/lib/phone";
import { cleanE164, cleanId, cleanName, cleanText } from "@/lib/sanitize";
import { validateInviteCode } from "@/lib/server/invite";
import { submitGate } from "@/lib/server/gate";
import { forwardToN8n, isHookConfigured } from "@/lib/server/n8n";

/**
 * POST /api/seed/complete — the parent finished the Seed Tool (estimate 1.7).
 *
 * Three things are recorded here, and two of them are decided by us, not by the
 * browser:
 *
 *  - `follow_up_opt_in` + its consent record. The client sends the answer; the
 *    server stamps status/source/timestamp and the text version it must have
 *    seen, so an opt-in can always be traced to real wording (TCPA / spec v3.2
 *    consent capture). An opt-in without a consent record is treated as declined.
 *  - `contributor_status: "pending_founding"`. Founding is granted by a human in
 *    the admin approval queue, never by finishing a form — the completion screen
 *    promises confirmation, not the badge.
 *  - counts of what was shared, so the workflow can log the funnel without the
 *    client asserting anything about stored rows.
 */

const KINDS = ["activity", "caregiver", "place", "tip"] as const;
type Kind = (typeof KINDS)[number];

export async function POST(request: Request) {
  const raw = (await request.json().catch(() => null)) as {
    invite_code?: unknown;
    source?: unknown;
    name?: unknown;
    phone?: unknown;
    is_test?: unknown;
    follow_up_opt_in?: unknown;
    monthly_contact_allowance?: unknown;
    demand?: unknown;
    shared?: unknown;
    profile_saved_at?: unknown;
    started_at?: unknown;
  } | null;

  if (!raw) {
    return NextResponse.json({ error: "Malformed body" }, { status: 400 });
  }

  const invite = validateInviteCode(
    typeof raw.invite_code === "string" ? raw.invite_code : null,
  );
  const optedIn = raw.follow_up_opt_in === true;
  const phone = cleanE164(
    typeof raw.phone === "string" ? (toE164(raw.phone) ?? raw.phone) : null,
  );

  /* Same gate as the other two writes: a completion record naming a phone is only
     stored after that phone confirmed a code. */
  const gate = submitGate(request, { phone, wants_founding: phone !== null });
  if (!gate.allowed) {
    console.info("[seed:complete] blocked", { reason: gate.reason });
    return NextResponse.json(
      { error: "Phone verification required", reason: gate.reason },
      { status: 401 },
    );
  }

  const sharedIn = (raw.shared ?? {}) as Record<string, unknown>;
  const shared = Object.fromEntries(
    KINDS.map((kind) => [
      kind,
      typeof sharedIn[kind] === "number" && Number.isInteger(sharedIn[kind])
        ? Math.max(0, Math.min(sharedIn[kind] as number, 200))
        : 0,
    ]),
  ) as Record<Kind, number>;

  const now = new Date().toISOString();

  const record = {
    invite_code:
      invite.valid && typeof raw.invite_code === "string" ? raw.invite_code : null,
    market_id: invite.market_id,
    source: cleanId(raw.source) ?? "direct",
    is_test: raw.is_test === true,
    name: cleanName(raw.name),
    phone,
    phone_verified: gate.verified_at !== null,
    phone_verified_at: gate.verified_at,
    sms_consent_text_version: SMS_CONSENT_TEXT_VERSION,
    // Founding is a human decision (admin approval queue), never self-granted.
    contributor_status: "pending_founding" as const,
    follow_up_opt_in: optedIn,
    consent: {
      scope: "follow_up" as const,
      status: optedIn ? ("opted_in" as const) : ("declined" as const),
      source: "seed_completion_screen",
      text_version: CONSENT_TEXT_VERSION,
      captured_at: now,
      // No phone, no channel: an opt-in we can't message is still recorded, but
      // the workflow must not treat it as reachable.
      reachable: optedIn && phone !== null,
    },
    /** The cap Pando must honour, not a preference. */
    monthly_contact_allowance:
      typeof raw.monthly_contact_allowance === "number" &&
      [1, 3, 5].includes(raw.monthly_contact_allowance)
        ? raw.monthly_contact_allowance
        : 3,
    /**
     * D1. Three things the client asked for, none of which the browser is trusted
     * with: the classification is re-derived here, a peer-support question is only
     * stored when the parent agreed, and anything not ordinary is flagged for a
     * person rather than entering the knowledge base.
     */
    demand: (() => {
      const d = raw.demand as {
        question_text?: unknown;
        category?: unknown;
        may_save?: unknown;
      } | null;
      const text = cleanText(d?.question_text, 300);
      if (!text) return null;

      const category = cleanId(d?.category);
      const sensitivity = classifyDemand(text, category);

      // "No — just needed to say it" means exactly that: nothing is stored.
      if (sensitivity !== "ordinary" && d?.may_save !== true) return null;

      return {
        question_text: text,
        category,
        sensitivity,
        status: "open" as const,
        /** Sensitive questions never enter the knowledge base automatically. */
        requires_human_review: needsHumanReview(sensitivity),
      };
    })(),
    shared,
    shared_total: Object.values(shared).reduce((a, b) => a + b, 0),
    client_profile_saved_at:
      typeof raw.profile_saved_at === "string" ? raw.profile_saved_at : null,
    client_started_at: typeof raw.started_at === "string" ? raw.started_at : null,
    completed_at: now,
  };

  // Counts and flags only — never a phone number, name or free text (spec §19).
  console.info("[seed:complete]", {
    market_id: record.market_id,
    source: record.source,
    invite_valid: invite.valid,
    follow_up_opt_in: record.follow_up_opt_in,
    reachable: record.consent.reachable,
    consent_version: CONSENT_TEXT_VERSION,
    allowance: record.monthly_contact_allowance,
    has_demand_signal: record.demand !== null,
    demand_sensitivity: record.demand?.sensitivity ?? null,
    demand_needs_review: record.demand?.requires_human_review ?? null,
    shared_total: record.shared_total,
  });

  if (!isHookConfigured("complete")) {
    return NextResponse.json({
      ok: true,
      contributor_id: randomUUID(),
      contributor_status: record.contributor_status,
      persisted: false,
    });
  }

  const result = await forwardToN8n<{ contributor_id?: string }>(
    "complete",
    record,
  );

  if (!result.forwarded) {
    console.error(
      "[seed:complete] n8n forward failed",
      result.error ?? result.reason,
    );
    return NextResponse.json(
      { error: "Could not record that right now" },
      { status: 502 },
    );
  }

  return NextResponse.json({
    ok: true,
    contributor_id: result.data.contributor_id ?? null,
    contributor_status: record.contributor_status,
    persisted: true,
  });
}

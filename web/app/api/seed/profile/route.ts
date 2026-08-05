import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import {
  cleanAges,
  cleanE164,
  cleanId,
  cleanName,
  cleanOptionValue,
} from "@/lib/sanitize";
import { toE164 } from "@/lib/phone";
import { submitGate } from "@/lib/server/gate";
import { forwardToN8n, isHookConfigured } from "@/lib/server/n8n";
import { validateInviteCode } from "@/lib/server/invite";
import type { ProfilePayload, QuestionId } from "@/lib/types";

/**
 * POST /api/seed/profile — save the tap-first profile (spec §16.1).
 *
 * Everything user-typed is sanitized here, before the payload leaves the app.
 * The write itself belongs to the n8n workflow (contributors + social_affinities
 * + life_relevance + pending_options, estimate 1.3); until that webhook exists
 * we answer `persisted: false` rather than pretend.
 *
 * Not yet here, and deliberately: rate limiting and Supabase RLS land with the
 * Phase 3 hardening pass (estimate 19.3).
 */

type ListKey = Extract<
  QuestionId,
  | "budget"
  | "logistics"
  | "family_structure"
  | "childcare_now"
  | "trust_circles"
  | "topics"
  | "topics_lived"
  | "schools"
  | "classes"
  | "faith"
  | "clubs"
  | "parent_groups"
>;

const ID_LIST_KEYS: ListKey[] = [
  "budget",
  "logistics",
  "family_structure",
  "childcare_now",
  "trust_circles",
  "topics",
  "topics_lived",
  "schools",
  "classes",
  "faith",
  "clubs",
  "parent_groups",
];

const MAX_PER_LIST = 30;
const SCHOOL_STATUSES = ["current", "former", "not_yet", "homeschool"] as const;
const MAX_OTHER_PER_QUESTION = 10;

export async function POST(request: Request) {
  const raw = (await request.json().catch(() => null)) as Partial<ProfilePayload> | null;
  if (!raw) {
    return NextResponse.json({ error: "Malformed body" }, { status: 400 });
  }

  const invite = validateInviteCode(raw.invite_code ?? null);
  const neighborhood = cleanId(raw.answers?.neighborhood ?? raw.neighborhood);
  const childAges = cleanAges(
    raw.answers?.child_ages ?? raw.child_ages_at_capture,
  );

  // The only two required answers in the whole flow (spec §8.5).
  if (!neighborhood || childAges.length === 0) {
    return NextResponse.json(
      { error: "Neighborhood and child age are required" },
      { status: 422 },
    );
  }

  const answersIn = raw.answers;
  const lists = Object.fromEntries(
    ID_LIST_KEYS.map((key) => [
      key,
      (Array.isArray(answersIn?.[key]) ? answersIn[key] : [])
        .map(cleanId)
        .filter((v): v is string => v !== null)
        .slice(0, MAX_PER_LIST),
    ]),
  ) as Record<ListKey, string[]>;

  const other: Partial<Record<QuestionId, string[]>> = {};
  for (const [key, values] of Object.entries(answersIn?.other ?? {})) {
    if (!Array.isArray(values)) continue;
    const cleaned = values
      .map(cleanOptionValue)
      .filter((v): v is string => v !== null)
      .slice(0, MAX_OTHER_PER_QUESTION);
    if (cleaned.length > 0) other[key as QuestionId] = cleaned;
  }

  const claimedPhone = cleanE164(
    typeof raw.phone === "string" ? (toE164(raw.phone) ?? raw.phone) : null,
  );

  /**
   * Nothing is stored until the phone is confirmed (client's v3.2 round). The
   * browser holds the profile until then; this is the half of that rule the
   * browser can't be trusted with.
   */
  const gate = submitGate(request, {
    phone: claimedPhone,
    wants_founding: raw.wants_founding !== false,
  });
  if (!gate.allowed) {
    console.info("[seed:profile] blocked", { reason: gate.reason });
    return NextResponse.json(
      { error: "Phone verification required", reason: gate.reason },
      { status: 401 },
    );
  }

  const payload = {
    invite_code: invite.valid ? (raw.invite_code ?? null) : null,
    market_id: invite.market_id,
    source: cleanId(raw.source) ?? "direct",
    // QA walkthrough, not a contributor — the workflow must keep these out of the
    // graph and out of pilot metrics.
    is_test: raw.is_test === true,
    name: cleanName(raw.name),
    first_name: cleanName(raw.first_name),
    last_name: cleanName(raw.last_name),
    // The client sends E.164; normalize anyway so a bare 10-digit US number from
    // a future caller isn't silently dropped.
    phone: claimedPhone,
    /**
     * Verification is a server fact, never a client claim: it comes from the
     * verification the gate just checked, not from the body.
     */
    phone_verified: gate.verified_at !== null,
    phone_verified_at: gate.verified_at,
    sms_consent: raw.sms_consent ?? null,
    wants_founding: raw.wants_founding !== false,
    neighborhood,
    /** Birth years, not ages — plus the date the ages were taken. */
    children: Array.isArray(raw.children) ? raw.children.slice(0, 12) : [],
    child_ages_at_capture: childAges,
    profile_captured_at:
      typeof raw.profile_captured_at === "string"
        ? raw.profile_captured_at
        : new Date().toISOString(),
    /**
     * P14. "As many as are genuinely relevant" has no number, and the send layer
     * must not invent one — it falls back to spacing and relevance rules alone.
     */
    allowance_mode: raw.allowance_mode === "as_relevant" ? "as_relevant" : "fixed",
    monthly_contact_allowance:
      raw.allowance_mode === "as_relevant"
        ? null
        : typeof raw.monthly_contact_allowance === "number" &&
            [1, 3, 5].includes(raw.monthly_contact_allowance)
          ? raw.monthly_contact_allowance
          : 3,
    /**
     * P13. One of two values or nothing — an unrecognised attribution must fail
     * closed to anonymous, never to a name.
     */
    attribution:
      raw.attribution === "first_name_safe" || raw.attribution === "anonymous_verified"
        ? raw.attribution
        : null,
    /** Disclosed at capture, so it starts true; texting PRIVACY turns it off. */
    aggregate_display: raw.aggregate_display !== false,
    topic_preferences: (raw.topic_preferences ?? [])
      .map(cleanId)
      .filter((v): v is string => v !== null)
      .slice(0, 40),
    topics_lived_experience: (raw.topics_lived_experience ?? [])
      .map(cleanId)
      .filter((v): v is string => v !== null)
      .slice(0, 20),
    /** P5 — only statuses we recognise, only for schools that were selected. */
    school_status: Object.fromEntries(
      Object.entries(raw.school_status ?? {})
        .map(([id, status]) => [cleanId(id), cleanId(status)])
        .filter(
          (pair): pair is [string, string] =>
            pair[0] !== null &&
            pair[1] !== null &&
            SCHOOL_STATUSES.includes(pair[1] as (typeof SCHOOL_STATUSES)[number]),
        )
        .slice(0, MAX_PER_LIST),
    ),
    time_in_area: cleanId(raw.time_in_area),
    moved_from: cleanId(raw.moved_from),
    invited_via_group: cleanId(raw.invited_via_group),
    answers: {
      neighborhood,
      child_ages: childAges,
      allowance: cleanId(answersIn?.allowance),
      invite_group: cleanId(answersIn?.invite_group),
      attribution: cleanId(answersIn?.attribution),
      time_in_area: cleanId(answersIn?.time_in_area),
      moved_from: cleanId(answersIn?.moved_from),
      ...lists,
      other,
      skipped: (Array.isArray(answersIn?.skipped) ? answersIn.skipped : [])
        .map(cleanId)
        .filter((v): v is string => v !== null)
        .slice(0, 20),
    },
    // Derived rows come from the client for convenience; the workflow is free to
    // re-derive them from `answers`, which is the authoritative part.
    social_affinities: (raw.social_affinities ?? []).slice(0, 200),
    life_relevance: (raw.life_relevance ?? []).slice(0, 100),
    pending_options: (raw.pending_options ?? []).slice(0, 60),
    profile_completeness:
      typeof raw.profile_completeness === "number" ? raw.profile_completeness : 0,
    client_started_at: raw.client_started_at ?? null,
    client_submitted_at: new Date().toISOString(),
    received_at: new Date().toISOString(),
  };

  // Counts only — never phone numbers, names or free text (spec §19).
  console.info("[seed:profile]", {
    market_id: payload.market_id,
    source: payload.source,
    invite_valid: invite.valid,
    affinities: payload.social_affinities.length,
    relevance: payload.life_relevance.length,
    pending_options: payload.pending_options.length,
    completeness: payload.profile_completeness,
    has_phone: payload.phone !== null,
    phone_verified: payload.phone_verified,
    sms_consent: payload.sms_consent?.status ?? "none",
    wants_founding: payload.wants_founding,
    children: payload.children.length,
    allowance: payload.monthly_contact_allowance,
    allowance_mode: payload.allowance_mode,
    attribution: payload.attribution ?? "unset",
    schools_with_status: Object.keys(payload.school_status).length,
  });

  if (!isHookConfigured("profile")) {
    return NextResponse.json({
      ok: true,
      contributor_id: randomUUID(),
      persisted: false,
    });
  }

  const result = await forwardToN8n<{
    contributor_id?: string;
    /**
     * A workflow may answer without storing anything — the 1.3 derivation
     * scenario runs without a database on purpose (see n8n/1.3-profile-derive.md).
     * Trust what it reports about itself; only assume a write when it says so.
     */
    persisted?: boolean;
    /** Row counts the workflow would write. Counts only, never rows. */
    would_write?: Record<string, number>;
    /** Whether the workflow's derivation matched ours. */
    crosscheck?: { agrees?: boolean };
  }>("profile", payload);

  if (!result.forwarded) {
    console.error("[seed:profile] n8n forward failed", result.error ?? result.reason);
    return NextResponse.json(
      { error: "Could not save the profile right now" },
      { status: 502 },
    );
  }

  const persisted = result.data.persisted !== false;

  if (result.data.would_write || result.data.crosscheck) {
    console.info("[seed:profile] workflow", {
      persisted,
      would_write: result.data.would_write ?? null,
      // False here means the workflow's derivation rules and lib/derive.ts have
      // drifted apart — a real bug on one of the two sides.
      derivation_agrees: result.data.crosscheck?.agrees ?? null,
    });
  }

  return NextResponse.json({
    ok: true,
    contributor_id: result.data.contributor_id ?? null,
    persisted,
  });
}

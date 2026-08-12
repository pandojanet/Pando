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
import { withDb } from "@/lib/server/db";
import { writeProfile } from "@/lib/server/repo/profile";
import { validateInviteCode } from "@/lib/server/invite";
import { SMS_CONSENT_TEXT_VERSION } from "@/lib/consent";
import {
  deriveAffinities,
  deriveLifeRelevance,
  derivePendingOptions,
} from "@/lib/derive";
import { EMPTY_ANSWERS } from "@/lib/questions";
import type { ProfilePayload, QuestionId } from "@/lib/types";

/**
 * POST /api/seed/profile — save the tap-first profile (spec §16.1).
 *
 * Everything user-typed is sanitized here, before it reaches the database. The
 * write itself is one transaction in `lib/server/repo/profile.ts` (person +
 * children + affinities + relevance + schools + pending options, estimate 1.3).
 *
 * With `DATABASE_URL` unset the route still answers 200 with
 * `persisted: false` — the same honesty rule the n8n seam had, and what keeps
 * the whole flow walkable before there is a database.
 *
 * Not yet here, and deliberately: rate limiting lands with the Phase 3
 * hardening pass (estimate 19.3).
 */

/**
 * The SMS consent, whatever shape the client sent it in.
 *
 * This used to be `raw.sms_consent ?? null`, forwarded straight into a row with a
 * `NOT NULL` text_version — so a client sending the older `sms_consent: true`
 * shape lost **the entire profile** to a 502, not just the consent record. That is
 * not hypothetical: `lib/storage.ts` exists because a stored session is written by
 * whatever build the parent last opened, and mid-pilot they meet several.
 *
 * A boolean is honoured rather than refused: the parent did tick the box, and the
 * wording is a constant we already hold. Anything else is dropped — a consent we
 * cannot describe is worse than no consent record, because the version *is* the
 * artefact (see lib/consent.ts).
 */
function normaliseSmsConsent(
  value: unknown,
): { status: string; text_version: string; source?: string } | null {
  if (value === true) {
    return { status: "opted_in", text_version: SMS_CONSENT_TEXT_VERSION };
  }
  if (value === false) {
    return { status: "declined", text_version: SMS_CONSENT_TEXT_VERSION };
  }
  if (typeof value !== "object" || value === null) return null;

  const record = value as Record<string, unknown>;
  const status = record.status === "opted_in" ? "opted_in" : "declined";
  return {
    status,
    /* A record without a version is still a real decision the parent made, so it
       is kept and stamped with the wording currently on screen rather than
       thrown away. */
    text_version:
      typeof record.text_version === "string" && record.text_version !== ""
        ? record.text_version
        : SMS_CONSENT_TEXT_VERSION,
    source: typeof record.source === "string" ? record.source : undefined,
  };
}

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
  | "camps"
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
  "camps",
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

  const invite = await validateInviteCode(raw.invite_code ?? null);
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

  /**
   * The sanitised answers, and the only thing the derivation below reads.
   *
   * `EMPTY_ANSWERS` is the base rather than a convenience: the derivation walks
   * every question in `SCREENS`, so a key the client simply omitted has to be an
   * empty list and not `undefined`. Every value spread over it here is
   * server-cleaned, so this is not the "stored session overwrites a default with
   * null" trap that `lib/storage.ts` exists to prevent — nothing here can be null.
   */
  const answers = {
    ...EMPTY_ANSWERS,
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
  };

  /** Answers plus the market from the validated invite — nothing from the body. */
  const derivationInput = { answers, market_id: invite.market_id };

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
    sms_consent: normaliseSmsConsent(raw.sms_consent),
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
    answers,
    /**
     * **Derived here, from the answers above — not taken from the body.**
     *
     * These rows are the matching graph: which schools, groups and neighborhoods
     * this parent is an edge to, and therefore whose questions reach them and
     * whose answers they see. CLAUDE.md calls that graph the long-term asset, so
     * a client deciding its own edges was the wrong shape twice over — a stale
     * build writes stale weights, and a crafted request could assert an affinity
     * with a school the parent has nothing to do with.
     *
     * `lib/derive.ts` is pure and has no browser dependency, so the server runs
     * the *same* functions the client does, over answers it has already
     * sanitised. The client still sends its own copy; we ignore it. That keeps
     * every existing build working — the payload contract only got narrower —
     * and `raw_answers` remains the record of what was actually tapped.
     */
    social_affinities: deriveAffinities(derivationInput),
    life_relevance: deriveLifeRelevance(derivationInput),
    /**
     * The market comes from the **validated invite**, never the body: which
     * market an "other" answer belongs to decides where it can ever be promoted
     * to (invariant 9), and that is not the client's call either.
     */
    pending_options: derivePendingOptions(derivationInput),
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

  const result = await withDb((db) =>
    writeProfile(db, {
      invite_code: payload.invite_code,
      /* The resolved group, from the code the server validated — never from the
         body. Undefined for an env-var code or an unknown one, which is the same
         "no attribution" state as arriving with no code at all. */
      invite_id: invite.invite_id ?? null,
      market_id: payload.market_id,
      source: payload.source,
      is_test: payload.is_test,
      first_name: payload.first_name,
      last_name: payload.last_name,
      phone: payload.phone,
      phone_verified_at: payload.phone_verified_at,
      sms_consent: payload.sms_consent as ProfileConsent,
      wants_founding: payload.wants_founding,
      neighborhood,
      children: payload.children as never,
      child_ages_at_capture: payload.child_ages_at_capture,
      profile_captured_at: payload.profile_captured_at,
      allowance_mode: payload.allowance_mode as "fixed" | "as_relevant",
      monthly_contact_allowance: payload.monthly_contact_allowance,
      attribution: payload.attribution,
      aggregate_display: payload.aggregate_display,
      topic_preferences: payload.topic_preferences,
      topics_lived_experience: payload.topics_lived_experience,
      school_status: payload.school_status,
      time_in_area: payload.time_in_area,
      moved_from: payload.moved_from,
      invited_via_group: payload.invited_via_group,
      answers: payload.answers,
      social_affinities: payload.social_affinities as never,
      life_relevance: payload.life_relevance as never,
      pending_options: payload.pending_options as never,
      profile_completeness: payload.profile_completeness,
    }),
  );

  if (!result.persisted) {
    /**
     * `unconfigured` is the honest no-backend answer and must stay a 200: the
     * parent's answers are safe on their phone and the flow continues. A real
     * failure is a 502 — the screen tells them to try again rather than moving
     * on as though the profile were saved.
     */
    if (result.reason === "unconfigured") {
      return NextResponse.json({
        ok: true,
        contributor_id: randomUUID(),
        persisted: false,
      });
    }
    return NextResponse.json(
      { error: "Could not save the profile right now" },
      { status: 502 },
    );
  }

  console.info("[seed:profile] stored", result.data.counts);

  return NextResponse.json({
    ok: true,
    contributor_id: result.data.person_id,
    persisted: true,
  });
}

/** The shape `lib/consent.ts` produces, narrowed for the repository. */
type ProfileConsent = { status: string; text_version: string; source?: string } | null;

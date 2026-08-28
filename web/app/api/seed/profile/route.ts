import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import {
  cleanAffiliationRef,
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
import { LISTENING_EAR_CONSENT_TEXT_VERSION, SMS_CONSENT_TEXT_VERSION } from "@/lib/consent";
import {
  deriveAffinities,
  deriveLifeRelevance,
  derivePendingOptions,
} from "@/lib/derive";
import { EMPTY_ANSWERS } from "@/lib/questions";
import type { ProfileAnswers, ProfilePayload, QuestionId } from "@/lib/types";

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

/**
 * The listening-ear opt-in. No legacy shape to accommodate — this consent
 * scope did not exist before 18 Aug — so this only guards against a stale or
 * corrupted stored session, not a prior client build's shape.
 */
function normaliseListeningEarConsent(
  value: unknown,
): { status: string; text_version: string; source?: string } | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  if (record.status !== "opted_in" && record.status !== "declined") return null;
  return {
    status: record.status,
    text_version:
      typeof record.text_version === "string" && record.text_version !== ""
        ? record.text_version
        : LISTENING_EAR_CONSENT_TEXT_VERSION,
    source: typeof record.source === "string" ? record.source : undefined,
  };
}

type ListKey = Extract<
  QuestionId,
  | "budget"
  | "travel_time"
  | "logistics"
  | "family_structure"
  | "work_setup"
  | "childcare_now"
  | "childcare_backup"
  | "previous_places"
  | "shared_affiliations"
  | "trust_circles"
  | "topics"
  | "topics_lived"
  | "schools"
  | "classes"
  | "camps"
  | "faith"
  | "clubs"
>;

const ID_LIST_KEYS: ListKey[] = [
  "budget",
  "travel_time",
  "logistics",
  "family_structure",
  "work_setup",
  "childcare_now",
  "childcare_backup",
  "previous_places",
  "shared_affiliations",
  "trust_circles",
  "topics",
  "topics_lived",
  "schools",
  "classes",
  "camps",
  "faith",
  "clubs",
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

  /**
   * A neighborhood the parent **typed** rather than tapped.
   *
   * P3 sets `allowOther`, and `isQuestionAnswered` counts a typed entry — so
   * the screen lets them past, the review screen prints what they wrote, and the
   * flow tells them it is saved. The route then asked `cleanId` for a canonical
   * id, got null, and refused the entire profile with "Neighborhood and child age
   * are required" — for a question the parent had plainly answered.
   *
   * That is how a real founding contributor lost a completed session: they added
   * their own neighborhood, verified their phone with a correct code, and every
   * save came back 422. Nothing on screen could suggest the fix, because from
   * where they sat the answer was right there.
   *
   * A typed answer **is** an answer for the purpose of §8.5's two required
   * questions. Where it is not enough is matching — invariant 9: an "other"
   * answer is not matchable until an admin promotes it — and that is already
   * handled without this route's help. `derivePendingOptions` files the text
   * under `neighborhoods` for `/admin/options`, `people.neighborhood` is
   * nullable and stays null, and promoting it writes the affinity rows for
   * everyone who typed it (the 12 Aug decision). So the hole closes itself.
   *
   * Only the presence check is relaxed. Nothing invents an id from the text —
   * storing their words as a neighborhood would be the unmatchable state that
   * promotion exists to end, and would put a value in the record that no
   * taxonomy contains.
   */
  const typedNeighborhood = (
    Array.isArray(raw.answers?.other?.neighborhood)
      ? raw.answers.other.neighborhood
      : []
  ).some((v) => typeof v === "string" && v.trim().length > 0);

  /**
   * The only two required answers in the whole flow (spec §8.5).
   *
   * **Named individually, and it matters.** One message for two failures is what
   * made a real 422 undiagnosable: the client finished the whole flow, entered a
   * correct code, and got "Neighborhood and child age are required" for a review
   * screen that plainly showed both — and neither we nor they could tell which
   * of the two the server had rejected, or that it had rejected a *value* rather
   * than an absence. `cleanAges` takes ages in -1..25, so a session carrying a
   * birth year (2025) is refused exactly like an empty one.
   *
   * `reason` is a machine-readable code so the client can act on it; the
   * offending value is deliberately **not** echoed, because it is a stored
   * answer and this response is a log line somewhere.
   */
  if ((!neighborhood && !typedNeighborhood) || childAges.length === 0) {
    const missing = [
      !neighborhood && !typedNeighborhood ? "neighborhood" : null,
      childAges.length === 0 ? "child_ages" : null,
    ].filter(Boolean);
    return NextResponse.json(
      {
        error:
          missing.length === 2
            ? "Neighborhood and child age are required"
            : missing[0] === "neighborhood"
              ? "The neighborhood is missing or is not one Pando recognises"
              : "The children's ages are missing, or are not ages Pando recognises",
        reason: "invalid_required_answers",
        fields: missing,
      },
      { status: 422 },
    );
  }

  const answersIn = raw.answers;
  const lists = Object.fromEntries(
    ID_LIST_KEYS.map((key) => [
      key,
      (Array.isArray(answersIn?.[key]) ? answersIn[key] : [])
        /* One list holds `type:value` refs rather than plain ids, and `cleanId`
           refuses a colon — so routing it through the default cleaner dropped
           every privacy grant a parent made, silently. */
        .map(key === "shared_affiliations" ? cleanAffiliationRef : cleanId)
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
  /**
   * "Whose is it" — question id → option id → the ages this answer belongs to.
   *
   * Cleaned against `childAges` rather than trusted: an age nobody tapped would
   * put a child in the graph who does not exist, and the whole point of this
   * field is that a "same school" edge means two children of a similar age.
   */
  const childOf: Record<string, Record<string, number[]>> = {};
  for (const [questionId, perOption] of Object.entries(
    (answersIn?.child_of ?? {}) as Record<string, unknown>,
  )) {
    const key = cleanId(questionId);
    if (!key || typeof perOption !== "object" || perOption === null) continue;
    const cleaned: Record<string, number[]> = {};
    for (const [optionId, ages] of Object.entries(
      perOption as Record<string, unknown>,
    )) {
      const option = cleanId(optionId);
      if (!option || !Array.isArray(ages)) continue;
      const kept = ages
        .filter((a): a is number => typeof a === "number" && childAges.includes(a))
        .slice(0, 12);
      if (kept.length > 0) cleaned[option] = kept;
    }
    if (Object.keys(cleaned).length > 0) childOf[key] = cleaned;
  }

  const answers = {
    ...EMPTY_ANSWERS,
    neighborhood,
    child_ages: childAges,
    child_of: childOf as ProfileAnswers["child_of"],
    allowance: cleanId(answersIn?.allowance),
    attribution: cleanId(answersIn?.attribution),
    /* Item 18's second half. Sanitised like every other scalar id: a value the
       server does not name never reaches the database, so leaving this out would
       have silently dropped the answer. */
    shared_connections: cleanId(answersIn?.shared_connections),
    time_in_area: cleanId(answersIn?.time_in_area),
    grew_up_here: cleanId(answersIn?.grew_up_here),
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
    listening_ear_consent: normaliseListeningEarConsent(raw.listening_ear_consent),
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
     *
     * The allow-list is 5/10 (18 Aug — supersedes the 1/3/5 scheme; "Just 1 ·
     * Basic access" is gone, not renumbered, so 1 and 3 are no longer valid
     * values here either, not only off the tap list). The fallback is 5, the
     * new default, for the same reason 3 was the fallback under the old scheme:
     * an unrecognised value must land on the client's own default, never on
     * whichever number happens to be lowest.
     */
    allowance_mode: raw.allowance_mode === "as_relevant" ? "as_relevant" : "fixed",
    monthly_contact_allowance:
      raw.allowance_mode === "as_relevant"
        ? null
        : typeof raw.monthly_contact_allowance === "number" &&
            [5, 10].includes(raw.monthly_contact_allowance)
          ? raw.monthly_contact_allowance
          : 5,
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
    /**
     * Where the link reached this parent — **from the invite the server just
     * validated, never from the body** (12 Aug). Until then it came from a
     * question in the profile ("Where this link reached you"), which asked a
     * parent to re-enter something the code already knew and produced a second,
     * weaker copy of it. The question is gone.
     *
     * Attribution only. It is deliberately *not* an affinity edge: a link
     * forwarded out of a group says somebody shared it, not that whoever opened it
     * belongs there.
     *
     * Since 14 Aug the "Parent groups" question is gone too, so **nothing writes a
     * parent-group membership edge any more** — a real hole in the matching graph,
     * recorded in CLAUDE.md rather than closed here. Closing it means deciding that
     * an invite *does* assert membership, which is the sentence above reversed.
     */
    invited_via_group: invite.group_option_value ?? null,
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
    listening_ear_consent: payload.listening_ear_consent?.status ?? "none",
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
      listening_ear_consent: payload.listening_ear_consent as ProfileConsent,
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
      /**
       * The privacy grants, taken from the **server-sanitised** answers rather
       * than from anywhere in the payload the client shapes.
       *
       * Same rule as the affinity graph (11 Aug): a permission decides who may be
       * told something about this parent, so the browser does not get to assert
       * one. `answers.shared_affiliations` has already been through
       * `cleanAffiliationRef`, and `resolveAffiliations` drops any ref that does
       * not name a real connection type.
       */
      shared_affiliations: answers.shared_affiliations,
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

/**
 * Shapes the admin pages read and write. These are the contract for the two
 * endpoints (`/api/admin/query` and `/api/admin/action`) — one switch on
 * `resource`, one on `action`, rather than a dozen routes.
 *
 * Every field here mirrors a column in `supabase/migrations/0001_schema.sql` or one
 * of the views in `0002_views.sql`, so a page never reshapes data it was given and a
 * workflow never has to invent a name. When the schema changes, this file changes in
 * the same commit.
 */

export type AdminResource =
  | "overview"
  | "contributors"
  | "contributor"
  | "contributions"
  | "caregivers"
  | "caregiver_claims"
  | "restricted_note"
  | "duplicates"
  | "options"
  | "flags"
  | "demand"
  | "founding"
  | "invites"
  | "consents"
  | "audit";

/** Where a record came from. A parent-trust label is only ever allowed on the first. */
export type Provenance = "parent_submitted" | "admin_entered" | "migrated";

/** `review_status` in the database. "needs_detail" is a kind follow-up, not a reject. */
export type ReviewStatus =
  | "pending_review"
  | "needs_detail"
  | "approved"
  | "rejected";

/**
 * The caregiver visibility ladder (2C). It only ever increases, and only by the
 * caregiver's own action — a parent's nomination reaches `invited` and no further.
 */
export type ConsentStatus =
  | "mentioned"
  | "invited"
  | "consented"
  | "declined"
  | "revoked";

export type FoundingStatus =
  | "none"
  | "pending_founding"
  | "founding"
  | "request_invite";

export interface Overview {
  contributors: { total: number; completed: number; with_two_plus: number };
  submissions: { activities: number; caregivers: number; places: number; tips: number };
  consent: { follow_up_opt_in: number; reference_willing: number };
  /** The ladder, not a contact funnel — Pando never contacts a nominee. */
  caregivers: {
    mentioned: number;
    invited: number;
    consented: number;
    declined: number;
  };
  quality: {
    low_confidence: number;
    open_flags: number;
    pending_options: number;
    /** Caregiver cards a human has to read before they can be used at all. */
    review_holds: number;
    /**
     * Contributions still waiting on a first decision. Distinct from
     * `low_confidence`, which is about *which* of them to read first — this is the
     * size of the queue, and it is what the sidebar counts.
     */
    pending_contributions: number;
    /**
     * Open flags at `escalation` severity — the subset owed a person today, as
     * opposed to the `note`-severity ones that are simply a reading order.
     *
     * Separate from `open_flags` because the sidebar paints one badge red, and a
     * low-confidence note turning the section red would make red mean "there are
     * flags", which is what the count already says.
     */
    escalations: number;
    /** 2C — caregivers who registered themselves and are waiting to be matched. */
    pending_claims: number;
  };
  founding: { pending: number; approved: number };
  /**
   * The client's reward gate, which is deliberately *not* the Founding one. On the
   * kickoff call: "I'm only going to pay them if they give me seed information…
   * the minimum should be one activity or one caregiver." Founding needs two
   * approved contributions; this needs one. `none` is the number that call asked
   * for by name — parents who arrived and left nothing.
   */
  reward: { eligible: number; started: number; none: number };
  /** Open D1 questions, split by what Pando said back. */
  demand: {
    ordinary: number;
    peer_support: number;
    high_stakes: number;
    /** Claims about a named person. Human review only, never circulated. */
    named_allegation: number;
  };
  /** §17.1 — records an admin has marked good enough to answer with. */
  answer_ready: number;
  drop_off: Array<{ step: string; reached: number }>;
  /** PostHog dashboard to embed or link. Funnels are configured there, not here. */
  posthog_url: string | null;
}

export interface ContributorRow {
  id: string;
  name: string | null;
  phone_masked: string | null;
  neighborhood: string | null;
  /** Birth years now — ages go stale, years don't. */
  child_birth_years: number[];
  submissions: number;
  /** Approved contributions that meet every Founding criterion. */
  qualifying_approved: number;
  /** Approved caregiver nominations that are not on hold. */
  caregiver_approved: number;
  /**
   * Whether this parent has earned the client's seed reward. One qualifying
   * contribution *or* one approved caregiver is the whole bar — the call set it at
   * "one activity or one caregiver", against Founding's two. Kept as its own field
   * so raising one threshold can never silently raise the other.
   *
   * `none` is the case the client asked to be able to see: arrived, left nothing.
   */
  reward_status: "none" | "started" | "eligible";
  founding_status: FoundingStatus;
  follow_up_opt_in: boolean | null;
  /** False = the anonymous path: contributions welcome, no founding status. */
  wants_founding: boolean;
  is_test: boolean;
  created_at: string;
}

export interface ContributorDetail extends ContributorRow {
  invite_code: string | null;
  source: string | null;
  profile_completeness: number;
  time_in_area: string | null;
  moved_from: string | null;
  /** P13. How this parent may be named in an answer — the only control over it. */
  attribution: "anonymous_verified" | "first_name_safe" | null;
  /** Anonymous group mentions. Disclosed rather than asked, so it starts true. */
  aggregate_display: boolean;
  /** P14. Null with mode `as_relevant` — the send layer must not invent a number. */
  monthly_contact_allowance: number | null;
  allowance_mode: "fixed" | "as_relevant";
  /** P12, both clusters. The lived-experience half is the sensitive one. */
  topic_preferences: string[];
  topics_lived_experience: string[];
  /** P5 — option value → current | former | not_yet | homeschool. */
  school_status: Record<string, string>;
  affinities: Array<{
    affinity_type: string;
    affinity_value: string;
    weight: number | null;
  }>;
  relevance: Array<{ dimension: string; value: string }>;
  cards: Array<{
    id: string;
    kind: "activity" | "caregiver" | "place" | "tip";
    title: string;
    status: ReviewStatus;
    /** Secondhand cards are welcome and labelled, but never qualifying. */
    firsthand: boolean;
    created_at: string;
  }>;
  /** Every consent this person gave, newest first, with the wording version. */
  consents: Array<{
    scope: string;
    status: string;
    text_version: string;
    captured_at: string;
  }>;
  /** seed_conversations.messages — empty until sending transcripts is a decision. */
  transcript: Array<{ role: "pando" | "parent"; text: string; at: string | null }>;
  notes: Array<{ id: string; author: string; body: string; at: string }>;
  /**
   * D2 — who brought this parent in, and who they brought.
   *
   * Recorded by an admin, not derived: with **one shared invite link** (31 Jul)
   * there is no code in the URL to attribute, and `invited_via_group` names a
   * group rather than a person. So the link is a human judgement — the same one
   * the founding queue already asks for — and this is where it is written down.
   * If the client ever flips to unique links, this becomes automatic and the
   * shape does not change.
   */
  referral: {
    referred_by: { id: string; name: string | null } | null;
    referred: Array<{
      referral_id: string;
      id: string;
      name: string | null;
      status: "pending" | "profile_complete" | "credited" | "void";
    }>;
  };
}

/**
 * One parent's experience of one place (R1–R11) — the row an admin actually reviews.
 * Replaces the old `ActivityRow`: activities, places and tips differ by `kind`, not
 * by shape, so they share one queue.
 */
export interface ContributionRow {
  id: string;
  kind: "activity" | "place" | "tip";
  /** The subject. Five parents recommending one class is five rows, one place. */
  share: {
    id: string;
    name: string;
    venue: string | null;
    neighborhoods: string[];
    age_bands: string[];
    freshness_state: "fresh" | "ageing" | "stale";
    last_confirmed_at: string | null;
    validated_count: number;
    /**
     * §17.1 — marked by an admin as complete enough to answer a real question with
     * no Blast behind it. Only ever true on an approved place (DB CHECK).
     */
    answer_ready: boolean;
  };
  /** R2 — decides the label, and whether this can ever count toward Founding. */
  firsthand: boolean;
  child_age_at_time: number[];
  last_there: string | null;
  how_much: string | null;
  recommendation: string | null;
  what_makes_it_great: string | null;
  caveat: string | null;
  /** True when the caveat step was answered — "nothing comes to mind" counts. */
  caveat_answered: boolean;
  who_for: string | null;
  who_not_for: string | null;
  price_band: string | null;
  price_unit: string | null;
  worth_it: string | null;
  /** Per-recommendation permission (R11), and it costs one monthly question. */
  follow_up_ok: boolean;
  tip_text: string | null;
  status: ReviewStatus;
  /** 0–1, from the review pass. Null until it has run, and after an edit. */
  confidence: number | null;
  /**
   * Why the score is what it is, in the reviewer's words rather than the
   * parent's — written by the same pass, cleared with the score.
   */
  confidence_note: string | null;
  provenance: Provenance;
  contributor: { id: string; name: string | null } | null;
  is_test: boolean;
  created_at: string;
}

/**
 * A caregiver and their newest nomination. No contact details exist anywhere in this
 * shape, deliberately: Pando never contacts a nominated caregiver (invariant 13).
 */
export interface CaregiverRow {
  id: string;
  first_name: string;
  last_initial: string | null;
  /** C2 — the kind of care, not a job title. */
  type: string | null;
  /** The ages they actually cared for. Evidence, not an opinion. */
  good_with_bands: string[];
  strengths: string[];
  good_fit_for: string[];
  consent_status: ConsentStatus;
  active: boolean;
  discoverable: boolean;
  introducible: boolean;
  /** What we recorded as proof, and how. Required to reach "consented". */
  consent_evidence: { method: string; note: string | null; at: string } | null;
  /** C11 — the parent sent the invite themselves. The only path in. */
  invite_sent_by_parent: boolean;
  /** C7 — yes | hesitant | no. Anything but yes holds the card. */
  hire_again: string | null;
  /** Held for a human. Derived from the answers, and never cleared by a re-save. */
  review_hold: boolean;
  hold_reasons: string[];
  /**
   * Whether C6b / the hesitant "why" exist — never their text. Bodies come from the
   * `restricted_note` resource, so a list view cannot leak them (invariant 12).
   */
  has_restricted_notes: boolean;
  caveat: string | null;
  nomination_status: ReviewStatus;
  contributor_reference_opt_in: string | null;
  /** C10 — when their childcare needs change, and whether we may check back. */
  needs_horizon: string | null;
  needs_change_type: string | null;
  recontact_ok: boolean;
  pay_band: string | null;
  pay_benchmark_consent: boolean;
  /**
   * Stage 1 employment context. Shown next to the band because that is the only way
   * a band means anything — 22–26/hr for a guaranteed 40 hours with paid holidays
   * and 22–26/hr for occasional date nights are not the same market rate.
   */
  schedule_pattern: string[];
  hours_per_week: string | null;
  benefits: string[];
  nominations: number;
  provenance: Provenance;
  is_test: boolean;
  created_at: string;
}

/**
 * 2C — a caregiver's own self-registration, waiting to be matched to a nomination.
 *
 * Carries nothing a parent said about them, and nothing that could identify which
 * family put them forward: this row is only what the caregiver claimed about
 * themselves. The admin's job is to decide *which* nomination it belongs to, which
 * is a judgement about identity, not a lookup — with one shared invite link and no
 * contact detail held for a nominee, there is nothing to match on automatically.
 */
export interface CaregiverClaimRow {
  id: string;
  first_name: string;
  last_initial: string | null;
  phone_masked: string | null;
  roles_wanted: string[];
  age_experience: string[];
  strengths: string[];
  areas_served: string[];
  drives: boolean | null;
  days_available: string[];
  available_from: string | null;
  hours_note: string | null;
  rate_band: string | null;
  /** G8–G10, as the three separate answers they were asked as. */
  appear_in_answers: boolean;
  open_to_introductions: boolean;
  open_to_reference_intros: boolean;
  consent_text_version: string;
  status: "pending" | "linked" | "declined";
  linked_caregiver: { id: string; first_name: string; last_initial: string | null } | null;
  /**
   * Nominations that look like they could be this person — same first name and
   * initial in the same market, whose invite a parent has actually sent. A
   * shortlist to choose from, never a match: two people called Maria G. are two
   * people, and folding them together would blend their reviews and their consent.
   */
  candidates: Array<{
    id: string;
    first_name: string;
    last_initial: string | null;
    nominations: number;
    consent_status: string;
    invite_sent_by_parent: boolean;
  }>;
  created_at: string;
}

/** Fetched one at a time, on purpose, and every fetch lands in the audit log. */
export interface RestrictedNote {
  id: string;
  nomination_id: string;
  kind: "private_note" | "hesitation_reason";
  body: string;
  created_at: string;
}

export interface DuplicateCandidate {
  key: string;
  score: number;
  reason: string[];
  members: Array<{
    id: string;
    first_name: string;
    last_initial: string | null;
    type: string | null;
    neighborhood: string | null;
  }>;
}

export interface PendingOptionRow {
  id: string;
  market_id: string;
  category: string;
  submitted_value: string;
  submitted_by: { id: string; name: string | null } | null;
  occurrences: number;
  status: "pending" | "approved" | "rejected";
  created_at: string;
}

export interface MarketOptionRow {
  id: string;
  category: string;
  option_value: string;
  active: boolean;
}

export interface FlagRow {
  id: string;
  severity: "escalation" | "review" | "note";
  reason: string;
  /** Free text is shown only here, never in a parent-facing answer. */
  excerpt: string;
  field: string | null;
  subject: { kind: string; id: string; title: string } | null;
  contributor: { id: string; name: string | null } | null;
  status: "open" | "resolved" | "escalated";
  confidence: number | null;
  created_at: string;
}

/**
 * D1. What a parent asked for at the end. `sensitivity` decides what Pando said back;
 * anything not ordinary waits for a person before it can be used.
 */
export interface DemandRow {
  id: string;
  question_text: string;
  category: string | null;
  /**
   * The asker's own neighborhood, from their profile. Category × neighborhood is
   * the market-expansion signal (spec §9, QC Answers Q7); null on the anonymous
   * path, which has no profile to read it from.
   */
  neighborhood: string | null;
  sensitivity: "ordinary" | "peer_support" | "high_stakes" | "named_allegation";
  requires_human_review: boolean;
  status: "open" | "matched" | "answered" | "closed";
  contributor: { id: string; name: string | null } | null;
  is_test: boolean;
  created_at: string;
}

/**
 * The founding queue reads the checklist rather than a submission count, so the admin
 * sees *why* somebody is or is not eligible.
 */
export interface FoundingRow {
  id: string;
  name: string | null;
  phone_masked: string | null;
  neighborhood: string | null;
  child_birth_years: number[];
  school: string | null;
  invited_by: string | null;
  arrived_via: string | null;
  submissions: { activities: number; caregivers: number; places: number; tips: number };
  /** The client's rule, as facts rather than a verdict. */
  checklist: {
    verified: boolean;
    has_neighborhood: boolean;
    has_children: boolean;
    allowance_ok: boolean;
    qualifying_approved: number;
    caregiver_approved: number;
  };
  status: FoundingStatus;
  created_at: string;
}

export interface AuditRow {
  id: string;
  at: string;
  user: string;
  action: string;
  resource: string;
  resource_id: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}

/** Every write goes through one endpoint so nothing can skip the audit log. */
export type AdminAction =
  /* Contributions — 2.4 */
  | { action: "contribution.approve"; id: string }
  | { action: "contribution.needs_detail"; id: string; question: string }
  | { action: "contribution.reject"; id: string; reason: string }
  | { action: "contribution.edit"; id: string; patch: Partial<ContributionRow> }
  /**
   * §17.1 golden answers. Keyed by *place* id, not contribution id: the flag says
   * "this record could answer a question", and the record is the place.
   */
  | { action: "share.answer_ready"; id: string; to: boolean }
  /* Caregivers — 2.5 */
  | { action: "nomination.approve"; id: string }
  | { action: "nomination.reject"; id: string; reason: string }
  /** Releasing a hold is a decision, so it needs a name and a note attached. */
  | { action: "nomination.release_hold"; id: string; note: string }
  | {
      action: "caregiver.consent";
      id: string;
      to: ConsentStatus;
      method: string;
      note: string | null;
    }
  | {
      action: "caregiver.visibility";
      id: string;
      /**
       * The consent state the page was showing. Sent so the endpoint can refuse a
       * raise it shouldn't allow — a check that cannot fail is not a check.
       */
      consent_status: ConsentStatus;
      active?: boolean;
      discoverable?: boolean;
      introducible?: boolean;
    }
  | { action: "caregiver.merge"; keep: string; merge: string[] }
  /* Invites — one per group, never per parent */
  | {
      action: "invite.create";
      code: string;
      label: string;
      market_id: string;
      group_option_value?: string | null;
      note?: string | null;
    }
  /** Stops it being offered. Never deletes: people already point at it, and a
      parent who got the link last week must still be able to walk in. */
  | { action: "invite.retire"; id: string }
  | { action: "invite.restore"; id: string }
  /* Tap lists — 2.6 */
  | { action: "option.promote"; id: string; option_value: string; label: string }
  | { action: "option.reject"; id: string }
  | { action: "option.retire"; id: string }
  /* Flags + demand — 2.7 */
  | { action: "flag.resolve"; id: string; note: string | null }
  | { action: "flag.escalate"; id: string; note: string | null }
  | { action: "demand.status"; id: string; to: DemandRow["status"]; note: string | null }
  /* Founding — 2.2 */
  | { action: "founding.approve"; ids: string[]; override_reason?: string }
  | { action: "founding.request_invite"; ids: string[] }
  /* Contributors — 2.3 */
  | { action: "contributor.note"; id: string; body: string }
  /* 2C caregiver claims */
  /** Says this claim is that nominated caregiver. Moves the ladder to consented. */
  | { action: "claim.link"; id: string; caregiver_id: string }
  /** Not who they say they are, or not one of ours. Kept, marked, not deleted. */
  | { action: "claim.decline"; id: string; reason: string }
  /**
   * The caregiver asked to be removed. This one really does delete — the flow
   * promises "text DELETE and everything goes", and a soft-delete would make that
   * sentence false. What survives is the audit row saying it happened.
   */
  | { action: "claim.delete"; id: string; requested_via: string }
  /* Referrals — D2 */
  /** Records that `referrer` brought `referred` in. Admin judgement, not a URL. */
  | { action: "referral.link"; referrer: string; referred: string }
  /** Withdraws a link that turned out to be wrong. The row stays, marked void. */
  | { action: "referral.void"; id: string };

/**
 * One invite — a **group**, never a person (see `lib/server/invite.ts`).
 *
 * The counts are the reason the table exists: "which group was sent a link" was
 * always knowable, "which group actually delivered contributors" never was.
 */
export interface InviteRow {
  id: string;
  code: string;
  label: string;
  market_id: string;
  /** The `parent_groups` option this maps to, when the admin linked one. */
  group_option_value: string | null;
  active: boolean;
  note: string | null;
  /** Everyone who arrived on this code. */
  contributors: number;
  /** Of those, how many gave at least one approved contribution. */
  delivered: number;
  created_at: string;
  created_by: string | null;
}

/**
 * One consent decision, for the export A2P §3.3 requires: "consent records must be
 * exportable — if there's ever a TCPA complaint, this table is the defense."
 *
 * The phone is unmasked here, and that is the point: a defence file that cannot
 * say *which number* agreed proves nothing. It is the one admin read whose whole
 * purpose is to leave the building, so it carries no free text of any kind —
 * identity, scope, decision, wording version, timestamp, nothing else.
 */
export interface ConsentRow {
  id: string;
  person_id: string | null;
  name: string | null;
  phone: string | null;
  scope: string;
  status: "opted_in" | "declined" | "revoked";
  source: string;
  text_version: string;
  captured_at: string;
  /** From `sms_opt_outs` — a later STOP overrides an earlier yes. */
  opted_out_at: string | null;
  /** Labelled rather than filtered: a complaint is about a number, not a flag. */
  is_test: boolean;
}

export interface AdminQueryResult<T> {
  /** False when DATABASE_URL isn't set — pages say so instead of faking rows. */
  configured: boolean;
  rows: T;
  total?: number;
}

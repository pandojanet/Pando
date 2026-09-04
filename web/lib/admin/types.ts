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
  | "matching"
  | "blast_responses"
  | "blasts"
  | "blast_pool"
  | "payments"
  | "answers"
  | "delivery"
  | "conversations"
  | "conversation"
  | "freshness"
  | "standing"
  | "impact"
  | "audit";

/**
 * 6.7 — the matching harness.
 *
 * The estimate's reason for it, verbatim: "so matching quality can be validated
 * before any live outreach … the cheap way to de-risk matching early without
 * building a consumer web channel". So the shape is built for *reading a
 * ranking*, not for acting on one — there is no write action, and there is
 * deliberately no way to send anything from this page.
 */
export interface MatchCandidateRow {
  person_id: string;
  name: string | null;
  neighborhood: string | null;
  phone_masked: string | null;
  score: number;
  affinity: number;
  relevance: number;
  /** Every contribution to the score, so a ranking can be argued with. */
  reasons: Array<{ kind: string; value: string; points: number }>;
  approved_contributions: number;
}

export interface MatchingResult {
  /** Null when the id was not a person, or when there is no database. */
  asker: {
    person_id: string;
    name: string | null;
    neighborhood: string | null;
    child_birth_years: number[];
    edges: number;
    relevance: number;
  } | null;
  /** Who could be asked, best first. */
  ranked: MatchCandidateRow[];
  /** 6.6 — reported rather than left to be inferred from a short list. */
  cold: boolean;
  wanted: number;
  found: number;
  /**
   * The weights the run used, from `affinity_weights` at query time.
   *
   * On screen on purpose, and since 2 Sep **editable there** (see
   * `matching.weight`): the harness exists to answer "did my weight change do
   * anything", which needs the page to say what it scored with *and* to be
   * where the change is made. Returned even with no asker chosen, because the
   * coefficients are configuration rather than a property of one run.
   */
  weights: Array<{ affinity_type: string; weight: number }>;
  /** Contributors to choose between, so the page needs no second request. */
  people: Array<{ person_id: string; name: string | null; neighborhood: string | null }>;
}

/**
 * 7.6 — a blast response waiting to be read.
 *
 * The reply, who wrote it, what was asked, and — the part that matters most —
 * **records it might already be about**. 7.9 asks for "likely-duplicate
 * candidates surfaced so it can be merged as a validation instead of creating a
 * second copy of the same place", and a merge that is one click harder than
 * creating is a merge that stops happening.
 */
export interface BlastResponseRow {
  blast_id: string;
  person_id: string;
  /** What the parent asked, so the reply can be judged against it. */
  question: string;
  tier: string;
  category: string | null;
  neighborhood: string | null;
  responder: string | null;
  responder_phone_masked: string | null;
  /** How many approved contributions they already have — a track record. */
  responder_contributions: number;
  response_text: string;
  responded_at: string | null;
  quality: number | null;
  review_status: string;
  /** Existing shares this reply might be about, best guess first. */
  merge_candidates: Array<{
    share_id: string;
    name: string;
    kind: string;
    firsthand_count: number;
  }>;
}

/** 14.2 — one answer waiting for a person. */
export interface AnswerRow {
  id: string;
  question: string;
  answer_text: string;
  /** Why it is in the queue — the specific rule, not "because everything is". */
  hold_reason: string;
  /** The trust labels it carries, so the reviewer checks the claim not the prose. */
  labels: string[];
  public_only: boolean;
  next_step: string;
  status: string;
  asker: string | null;
  asker_phone_masked: string | null;
  /** Null for a cold inbound — 5.9's subject, and they still get an answer. */
  known_person: boolean;
  created_at: string;
  sent_at: string | null;
}

/**
 * 12.5 — delivery health.
 *
 * The estimate asks for "a daily delivery-rate check surfacing anything below
 * 95%, and an admin view of delivery health". This is that view's payload:
 * the rate, what is still in flight, and the carrier errors that carry an
 * action rather than a number.
 */
export interface DeliveryHealthRow {
  /** False with no database — the page then says so rather than showing 0%. */
  configured: boolean;
  window_days: number;
  /** Null when nothing has settled yet: 0 out of 0 is not a failure. */
  rate: number | null;
  below_floor: boolean;
  settled: number;
  delivered: number;
  /** Accepted and not yet reported on. Neither a success nor a failure. */
  in_flight: number;
  alerts: Array<{
    code: number;
    count: number;
    severity: "alert" | "warn";
    title: string;
    action: string;
  }>;
}

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
    /**
     * 14.9 — records a contributor withdrew, awaiting a retire-or-keep call.
     *
     * A **subset of `open_flags`**, so the two sidebar badges overlap on
     * purpose — exactly as the flags row and the escalation row already do. What
     * would have been wrong is leaving these countable only in the flags total,
     * where "resolve" means "I have read this" and leaves the record answering.
     */
    withdrawn_records: number;
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
  /**
   * 14.3 / 14.5 — the two numbers the nav needs about Network Asks.
   *
   * `open` is Asks a parent is still waiting on, which is what makes the blast
   * manager a queue rather than a ledger. `refunds_owed` is the subset that
   * involves money and is somebody's outstanding task — the only count in this
   * payload that is deliberately shown in red on two different links, because
   * it is one fact and both pages clear it.
   */
  blasts: { open: number; refunds_owed: number };
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
  /**
   * Privacy Guidance §A — which of their connections may be mentioned, one
   * decision each.
   *
   * Revoked rows are included on purpose. The question this record answers is
   * "what was allowed, and when", and a permission that has been withdrawn is
   * part of that answer — §G asks for the effective time of the change rather
   * than for the row to disappear.
   */
  affiliation_visibility: Array<{
    affiliation_type: string;
    affiliation_value: string;
    visibility: string;
    consent_text_version: string | null;
    consented_at: string | null;
    revoked_at: string | null;
  }>;
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
  /**
   * What an admin asked for via `contribution.needs_detail` — only meaningful
   * when `status === "needs_detail"`. There is no channel to send it yet; this
   * is what keeps the question in front of whoever reopens the queue instead of
   * only inside the audit log.
   */
  needs_detail_note: string | null;
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
  /**
   * **Why it was raised** — the review pass's own sentence, never the parent's.
   * The two are kept apart deliberately (invariant 8); see `subject.text` for
   * what the parent actually wrote.
   */
  excerpt: string;
  field: string | null;
  subject: {
    kind: string;
    id: string;
    /** The class or place this is about. Empty for a question, which is its own text. */
    title: string;
    /**
     * What the parent wrote, **field by field** — shown to the person doing the
     * review and nowhere else. Separate entries rather than one string because
     * two different answers run together read as one sentence, and the admin
     * then cannot tell which of them named somebody. Empty when the flag came
     * from taps alone.
     */
    wrote: Array<{ field: string; body: string }>;
  } | null;
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
  /**
   * **Which group, not which person.** Read from `people.invited_via_group`,
   * which the server sets from the invite code it validated — so it names a
   * parent group ("mops"), never an individual.
   *
   * The name is a leftover from the profile question "who invited you?", which
   * was removed on 12 Aug when one invite per group started carrying the
   * attribution instead. Nothing asks for a person's name any more, so a screen
   * labelling this "Invited by" is claiming a fact that is no longer collected.
   */
  invited_by: string | null;
  /** The invite code they arrived on, or the bare `source` when there was none. */
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
  /**
   * 14.9 — the two ways out of the freshness queue.
   *
   * `share.retire` sets the record to `rejected`, which takes it out of
   * `shares_answerable` and so out of every answer. No new column and no
   * migration: "not answerable" already had a name.
   *
   * `share.keep` clears the withdrawal flag and **leaves the record stale**.
   * That is the honest middle: one parent withdrawing is evidence, others may
   * still stand behind it, and the spec's answer to old knowledge is to *mark*
   * it — so the record keeps answering while wearing its stale label rather
   * than being quietly restored to fresh, which would assert the opposite of
   * what the contributor said.
   *
   * Both carry the flag id as well as the record: clearing the queue and
   * clearing the flag are one act, or the Flags page keeps insisting on
   * something this page has dealt with.
   */
  | { action: "share.retire"; id: string; reason: string }
  | { action: "share.keep"; id: string; reason: string }
  /**
   * 7.6 — the admin rates a blast response, 1–5.
   *
   * Separate from approving it, because they are different judgements: a reply
   * can be genuinely useful and still be about something Pando already knows, and
   * a rating that only ever accompanied an approval could never say so. The
   * rating is what feeds credits and tiers (M9).
   */
  | { action: "blast_response.rate"; blast_id: string; person_id: string; quality: number }
  /**
   * 7.9 — approve a blast response, and let it into the graph.
   *
   * "Every paid question permanently enriches the free answer base." Approving
   * creates a **pending** share pre-filled from the reply, carrying who said it,
   * when, and which blast — or, when `merge_into` names an existing record, adds
   * this parent's experience to that one instead of making a second copy.
   */
  | {
      action: "blast_response.approve";
      blast_id: string;
      person_id: string;
      /** What the reply recommends, as the admin read it. */
      share_name?: string;
      share_kind?: string;
      /** Merge rather than create: this reply is about a record Pando already has. */
      merge_into?: string;
    }
  | { action: "blast_response.reject"; blast_id: string; person_id: string; reason: string }
  /**
   * 14.2 — the answer queue.
   *
   * **Approving and sending are two actions on purpose.** They are different
   * events: the first is a judgement, durable and audited; the second is a
   * delivery attempt that can fail transiently and be retried. Folding them
   * together would mean a carrier hiccup either lost the approval or wrote a
   * second one, and would hold the audit transaction open across an HTTP call.
   */
  /**
   * 7.8 — send a blast to its matched pool.
   *
   * An admin action rather than an automatic step, because the pilot reads
   * everything (19) and because this is the one path that reaches five
   * strangers' phones unprompted. It refuses a blast still marked for review.
   */
  /**
   * 6.7 — one matching weight, changed from the harness.
   *
   * The page still cannot send anything, and that separation is the point: this
   * writes configuration, never an outreach. Weights are read from
   * `affinity_weights` on every scoring run (§18.1 over §8.1), so a change lands
   * on the next question with no deploy and no backfill — which also means it
   * changes who gets asked for real, hence an audited action rather than a knob.
   *
   * `affinity_type` names an existing row: the update is conditional and creates
   * nothing, so a weight for a kind of connection the scorer does not read
   * cannot be invented from a screen.
   */
  | { action: "matching.weight"; affinity_type: string; weight: number }
  | { action: "blast.send"; id: string }
  /**
   * 14.3 / 13.5 — open a Stripe checkout for a paid Ask.
   *
   * An admin action rather than something the parent's own flow does, for the
   * pilot's duration: there is no consumer web channel for a Network Ask yet
   * (that is M5's SMS path), so today a paid Ask is set up by a person who then
   * sends the link on. The action returns the URL rather than redirecting,
   * because the admin is not the one paying.
   */
  | { action: "blast.checkout"; id: string }
  /**
   * 14.3 — mark an Ask fulfilled, which is a judgement rather than a count.
   *
   * 7.7's guarantee turns on whether an answer was *useful*, and no query can
   * decide that: three replies that all say "no idea, sorry" leave the guarantee
   * owed. So the fulfillment flag the estimate asks for is a person's decision,
   * and it carries a note for the same reason every other decision here does.
   */
  | { action: "blast.fulfil"; id: string; note: string }
  /**
   * 14.5 / 13.7 — the two halves of a refund, kept apart on purpose.
   *
   * `refund_due` is "somebody should refund this"; `refund` is "I have". They
   * happen at different times and often by different people — whoever works the
   * blast queue can see the window closed with nothing approved, and whoever
   * handles money does the rest. One button would mean the person noticing has
   * to also be the person authorised.
   */
  | { action: "blast.refund_due"; id: string; reason: string }
  | { action: "blast.refund"; id: string; reason: string }
  | { action: "answer.approve"; id: string }
  | { action: "answer.send"; id: string }
  | { action: "answer.reject"; id: string; reason: string }
  /** The labels are never editable — see `repo/answers.ts`. Only the prose. */
  | { action: "answer.edit"; id: string; text: string }
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
  /**
   * How many times the link was opened — estimate 2.2's per-link funnel needs a
   * denominator, or "four contributors" cannot be read as good or bad.
   *
   * Not a headcount: it counts server renders of the join page, so it includes
   * bots, link previews and a parent reopening the link. De-duplicating would
   * need an identifier before consent, and nothing about a person may be stored
   * before their number is verified (invariant 11). The inflation is roughly
   * uniform across channels, which is what makes comparing them usable.
   */
  opens: number;
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

/**
 * 14.1 — one parent's message history.
 *
 * ## What this page can and cannot show, and why that is not a gap
 *
 * The estimate says *"all conversations, inbound and outbound"*, which reads as
 * a transcript. **`message_log` stores no message body**, on purpose: its
 * columns are direction, category, template, the provider's id, the delivery
 * status and the time. So this shows the *shape* of a conversation — who, when,
 * which way, what kind of message, and whether it arrived — and never the text.
 *
 * That is invariant 7 holding at the schema level rather than at a log line, and
 * storing bodies to fill this page would be a privacy decision dressed as a
 * feature. The page says so out loud rather than looking broken.
 *
 * It is still the answer to the questions an admin actually has: did Pando text
 * her, did it arrive, did she reply, and how often has she been asked lately —
 * which is the same arithmetic the response-rate governor acts on.
 */
export interface ConversationRow {
  person_id: string;
  name: string | null;
  phone_masked: string | null;
  /** Newest activity in either direction — what the list is ordered by. */
  last_at: string;
  /** Which way the newest message went, so a list of waiting replies reads. */
  last_direction: "in" | "out";
  last_template: string | null;
  sent: number;
  received: number;
  /** Proactive messages in the last 30 days — the window the governor uses. */
  outreach_30: number;
  /** Replies that named an outbound message, over the same window. */
  answered_30: number;
  /** Anything the carrier reported as failed. Zero is the ordinary case. */
  failed: number;
  is_test: boolean;
}

export interface ConversationsResult {
  rows: ConversationRow[];
  /** Messages with no person attached — a cold inbound, or a deleted profile. */
  unattributed: number;
}

/** One message in the history. No body, per the note above. */
export interface ConversationMessage {
  id: string;
  direction: "in" | "out";
  category: string;
  template: string | null;
  sent_at: string;
  /** 12.5's delivery status, for an outbound one. */
  status: string | null;
  error_code: number | null;
  /** True when this inbound message answered an outbound one (8.4's signal). */
  answered_something: boolean;
}

export interface ConversationDetail {
  person_id: string;
  name: string | null;
  phone_masked: string | null;
  /** Their own agreement, so the history can be read against what they allowed. */
  monthly_contact_allowance: number | null;
  allowance_mode: "fixed" | "as_relevant";
  opted_out: boolean;
  messages: ConversationMessage[];
}

/**
 * 14.9 — a record a contributor said is no longer worth recommending.
 *
 * 10.2 has been raising `recommendation_withdrawn` since 1 Sep and marking the
 * record stale, deliberately **without** rejecting it: one parent's changed mind
 * is evidence, and three others may still stand behind it. That left a decision
 * nobody had a screen for, which is this row's whole subject — the estimate's
 * words are "for retire-or-re-blast decisions".
 */
export interface FreshnessOutcomeRow {
  share_id: string;
  name: string;
  kind: string;
  neighborhoods: string[];
  /** Who said no, and when they were asked. */
  said_no_by: string | null;
  said_no_at: string | null;
  /** How many parents still stand behind it — the reason this is a decision. */
  firsthand_count: number;
  /** Whether any of them would still recommend it (`yes` / `yes_with_caveats`). */
  recommending_count: number;
  last_confirmed_at: string | null;
  freshness_state: string;
  status: string;
  is_test: boolean;
}

/**
 * 14.4 — a contributor's standing: counters, response rate, tier and limits.
 *
 * The four things the row names, and each comes from somewhere different: the
 * counters from `impact_events` (9.3), the response rate from `message_log`
 * (8.4), the tier from `tierFor` over those events (9.4), and the limits from
 * what the parent themselves agreed to (P14). Until this existed `standingsFor`
 * had **no consumer at all** — the ladder was computed and shown nowhere.
 */
export interface StandingRow {
  person_id: string;
  name: string | null;
  phone_masked: string | null;
  /** `member` … `founding`. Computed every read, never stored — see `tiers.ts`. */
  tier: string;
  /** The next rung, for the admin only. Null at the top, or when founding. */
  next_tier: string | null;
  /** Lifetime quality responses. Admin-side; never shown to a contributor. */
  equivalents: number;
  contributions_approved: number;
  asks_answered: number;
  freshness_confirmed: number;
  /** Times a recommendation of theirs reached a parent. Worth 0 toward a tier. */
  answers_used: number;
  /** 8.4's window: proactive messages in 30 days, and how many they answered. */
  asked_30: number;
  answered_30: number;
  /** Null until there are enough requests to mean anything (`RESPONSE_MIN_SAMPLE`). */
  response_rate: number | null;
  monthly_contact_allowance: number | null;
  allowance_mode: "fixed" | "as_relevant";
  /** True when the governor would lower what they are asked. */
  governed: boolean;
  is_test: boolean;
}

/**
 * 14.6 — one thank-you loop, end to end.
 *
 * 9.1 asks the parent who received an answer whether it helped; 9.2 thanks the
 * contributors whose recommendation it was. This is the pair as one row, because
 * reading them apart is what makes the loop impossible to audit: a "yes" with no
 * thank-you sent is the interesting case, and it is invisible from either half.
 */
export interface ImpactEventRow {
  answer_id: string;
  question: string;
  asker: string | null;
  sent_at: string | null;
  /** When 9.1's prompt went out. Null means it has not been asked yet. */
  helped_asked_at: string | null;
  /** Null is **not** no — it is a parent who did not reply. */
  helped: boolean | null;
  /** The records the answer was composed from, and who is behind them. */
  records: Array<{ share_id: string; name: string }>;
  /** Contributors owed or paid a thank-you for this answer. */
  contributors: Array<{
    person_id: string;
    name: string | null;
    /** When they were last thanked at all — 9.2's week is measured from this. */
    last_thanked_at: string | null;
  }>;
  is_test: boolean;
}

export interface ImpactResult {
  rows: ImpactEventRow[];
  /** Counts for the filter tabs, computed once in SQL rather than per render. */
  totals: {
    answered_yes: number;
    answered_no: number;
    /** Asked and still silent. A silence is never recorded as a no (9.1). */
    awaiting: number;
    /** Sent, in window, and never asked — the thing worth noticing. */
    unasked: number;
  };
}

/**
 * 14.3 — one Network Ask, as the blast manager needs to see it.
 *
 * The estimate's row is the fullest in M14: "preview the selected recipient
 * pool, read the responses, rate their quality, pick the best, and manage
 * fulfillment and refund flags." Three of those already had a home — the
 * responses, their ratings and the promotion decision are `/admin/responses`
 * (7.6/7.9, and 14.8 under its own number). What had **no** home was the blast
 * itself: there was no list of them, no way to see the pool before it was sent,
 * and no way to say "this one was fulfilled" or "this one owes a refund".
 *
 * So this row is the blast, its money, its pool and its replies in one shape,
 * and the page is where the three verbs that were missing live.
 */
export interface BlastRow {
  id: string;
  question_text: string;
  category: string | null;
  neighborhood: string | null;
  /** `passive` | `board` | `targeted` | `last_minute` — the 8.18 four. */
  tier: string;
  /** The state of the *question*. See `payment_status` for the money. */
  status: string;
  /** Set at creation for Last-Minute Care, and by `needsHumanReview`. */
  human_review: boolean;
  pool_target: number;
  expires_at: string | null;
  fulfilled_at: string | null;
  created_at: string;
  asker: { id: string; name: string | null; phone_masked: string | null } | null;
  /**
   * The state of the money, deliberately separate from `status`: a blast can be
   * `fulfilled` and `refund_due` at once, because the guarantee is about whether
   * an answer was *useful* rather than whether one arrived.
   */
  payment_status: string;
  /** What was actually charged, frozen at checkout (`drizzle/0029`). */
  price_cents: number;
  paid_at: string | null;
  refunded_at: string | null;
  refund_reason: string | null;
  /** Whether a credit paid for it. The guarantee is then a credit, not money. */
  credit_funded: boolean;
  /** How many were asked, how many answered, and how many answers were kept. */
  recipients: number;
  responded: number;
  passed: number;
  approved_responses: number;
  is_test: boolean;
}

/**
 * 14.3's pool preview — who Pando *would* ask, before anybody is asked.
 *
 * The same shape the 6.7 harness shows, and for the same reason: a pool that
 * cannot be argued with is a pool nobody checks. It is read through
 * `selectPool`, so what is previewed is what would actually be contacted —
 * matcher first, then the opt-out list, then the M8 protection rules per person.
 *
 * **Previewing sends nothing**, which is why it is a read resource rather than
 * an action: the estimate asks to "preview the selected recipient pool", and a
 * preview with a side effect is not one.
 */
export interface BlastPoolResult {
  blast_id: string;
  wanted: number;
  /** Everyone who would be contacted, best match first. */
  chosen: Array<{
    person_id: string;
    name: string | null;
    phone_masked: string | null;
    score: number;
    reasons: Array<{ kind: string; value: string; points: number }>;
  }>;
  /**
   * Ranked but not asked, with the rule that stopped each one. Called `held` to
   * match `PoolResult` rather than renamed to something friendlier: two names
   * for one list is how a page and the pool it previews start disagreeing.
   *
   * A row here is the system working — a contributor inside their 48-hour gap,
   * or over their monthly allowance — which is why the page says so in words.
   */
  held: Array<{ person_id: string; name: string | null; score: number; reason: string }>;
  /** 6.6 — fewer than the tier promised. */
  cold: boolean;
  /** Set when the pool is short or the requirements are stacked (7.3). */
  human_review: { required: boolean; reason: string | null };
}

/**
 * 14.5 — "paid blasts, credit-funded blasts, status, and refund needs."
 *
 * Its own page rather than a column on 14.3, because it answers a different
 * question: 14.3 asks "how is this Ask going", and this asks "what does Pando
 * owe, and to whom". The rows overlap; the reading does not.
 *
 * `owed` is computed by `refundOwed` in `lib/payments.ts` rather than here, so
 * the page and the action cannot disagree about whether a refund is due.
 */
export interface PaymentRow {
  blast_id: string;
  question_text: string;
  tier: string;
  status: string;
  payment_status: string;
  price_cents: number;
  paid_at: string | null;
  refunded_at: string | null;
  refund_reason: string | null;
  credit_funded: boolean;
  asker: { id: string; name: string | null } | null;
  approved_responses: number;
  expires_at: string | null;
  /** Days since payment, for the ~60-day manual window (13.7). */
  age_days: number | null;
  is_test: boolean;
}

export interface PaymentsResult {
  rows: PaymentRow[];
  /**
   * Whether Stripe is switched on at all, and in which mode.
   *
   * Booleans and an enum only — never a key or a prefix, which is the sort of
   * thing that ends up in a screenshot. The page needs it to avoid offering a
   * refund button that could only ever fail.
   */
  stripe: {
    provisioned: boolean;
    webhook_configured: boolean;
    mode: "live" | "test" | null;
    prices: Array<{ tier: string; label: string; price: string }>;
  };
  /** Cents, over the rows shown. Reported rather than recomputed per page. */
  totals: { paid_cents: number; refunded_cents: number; refund_due_cents: number };
}

/**
 * How many audit entries a read returns.
 *
 * Shared because it was two numbers that disagreed: the page sent
 * `{ limit: 200 }` and `auditRows` is a hard `limit 500` that never read the
 * param — so the number on the client was fiction, and the reader was never told
 * the list ends at all. That is the dead-payload fault CLAUDE.md already records
 * costing us once (estimate 2.2).
 *
 * A client page cannot import from `lib/server/*`, so the constant lives here,
 * where both sides already import their types from.
 */
export const AUDIT_PAGE_SIZE = 500;

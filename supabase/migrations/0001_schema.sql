-- ═══════════════════════════════════════════════════════════════════════════
-- Pando — 0001 schema
--
-- Built from: Janet Estimate (rows 1.1–1.10, 2.1–2.8, M3), QC Eng Spec v3.1,
-- the v3.2 additions in опис.pdf, and "Pando Seed Conversation — Question Set"
-- (July 2026). Column names follow the payloads the app already sends, so the
-- n8n workflows need no translation layer — see web/README.md and
-- docs/n8n-supabase-plan.md.
--
-- The principle throughout: **an invariant that can be a constraint is a
-- constraint.** A CHECK cannot be forgotten by a workflow, and the workflows are
-- edited in a browser UI. Every rule marked (invariant N) is from CLAUDE.md.
--
-- Apply with:  supabase db reset      (or psql -f, in file order)
-- ═══════════════════════════════════════════════════════════════════════════

create extension if not exists pg_trgm;      -- duplicate detection (2.5)

-- ── Types ─────────────────────────────────────────────────────────────────
-- Enums only where the value set is safety-critical. Everything that Janet may
-- want to extend later (care_type, price_band, category) stays `text` + CHECK or
-- free text, so adding a value is not a migration.

create type founding_status  as enum ('none','pending_founding','founding','request_invite');
create type allowance_mode   as enum ('fixed','as_relevant');
create type attribution_mode as enum ('anonymous_verified','first_name_safe');
create type provenance       as enum ('parent_submitted','admin_entered','migrated');
create type review_status    as enum ('pending_review','needs_detail','approved','rejected');
create type consent_status   as enum ('mentioned','invited','consented','declined','revoked');
create type share_kind       as enum ('activity','caregiver','place','tip');

-- ── 1. Identity (estimate 1.1, 1.10 · invariants 10, 11) ──────────────────

-- One person, one row, keyed by phone. "Contributor" is a derived status from
-- approved contributions, never a second table (invariant 10).
create table people (
  id                uuid primary key default gen_random_uuid(),
  phone             text unique,              -- E.164. Null = anonymous path.
  first_name        text,
  last_name         text,
  market_id         text not null default 'pasadena',
  neighborhood      text,
  invite_code       text,
  invited_via_group text,                     -- P6: which group the link came from
  source            text,                     -- 'link' | 'qr' | 'direct'
  time_in_area      text,                     -- P8a
  moved_from        text,                     -- P8b

  -- P13 + the disclosed aggregate rule. Display only: matching always uses the
  -- full profile (client's design rule 7).
  attribution       attribution_mode,
  aggregate_display boolean not null default true,

  -- P14. Null allowance with mode 'as_relevant' means spacing and relevance
  -- rules alone decide — the send layer must not invent a number.
  monthly_contact_allowance int,
  allowance_mode    allowance_mode not null default 'fixed',
  constraint allowance_shape check (
    (allowance_mode = 'as_relevant' and monthly_contact_allowance is null) or
    (allowance_mode = 'fixed' and monthly_contact_allowance in (1,3,5))
  ),

  /**
   * P12 — what this parent is willing to be asked about. It decides which questions
   * Pando brings them, so it is a first-class column, not something to re-derive
   * from `raw_answers` later. The lived-experience half is kept separately because
   * it is the sensitive one: it is about willingness to help, never about whether
   * they went through it.
   */
  topic_preferences       text[] not null default '{}',
  topics_lived_experience text[] not null default '{}',

  -- Which path they took at the entry screen. `founding = 'none'` implies it, but
  -- the funnel question "how many chose anonymous" deserves a real answer.
  wants_founding boolean not null default true,

  /**
   * Every tap, as captured. Not a substitute for the derived tables — matching
   * never reads this — but it is the answer to "what did the parent actually
   * choose", including their skipped list and their free-text "other" entries.
   */
  raw_answers          jsonb,
  child_ages_at_capture int[],

  -- A server fact from a completed OTP, never a claim from a browser.
  phone_verified_at    timestamptz,
  founding             founding_status not null default 'none',
  profile_completeness int not null default 0,
  profile_captured_at  timestamptz,
  is_test              boolean not null default false,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  -- Nothing about a named parent is stored before verification (invariant 11).
  constraint verified_if_named check (phone is null or phone_verified_at is not null)
);

create index people_market_idx    on people (market_id) where not is_test;
create index people_founding_idx  on people (founding)  where not is_test;
create index people_created_idx   on people (created_at desc);

-- Consents are append-only records, never booleans: the wording version and the
-- timestamp are the artefact. Bumping wording means a new text_version, never an
-- edit (web/lib/consent.ts).
create table consents (
  id           uuid primary key default gen_random_uuid(),
  person_id    uuid not null references people(id) on delete cascade,
  scope        text not null check (scope in
                 ('sms','follow_up','blast','reference','caregiver_profile')),
  status       text not null check (status in ('opted_in','declined','revoked')),
  source       text not null,
  text_version text not null,
  captured_at  timestamptz not null default now()
);
create index consents_person_idx on consents (person_id, scope, captured_at desc);

-- The list the send layer reads first (invariant 6, step 1). STOP writes here;
-- START and UNSTOP are the only keywords that clear it — never YES, because
-- "yes" is an answer to a Network Ask.
create table sms_opt_outs (
  phone        text primary key,
  keyword      text not null,
  opted_out_at timestamptz not null default now()
);

-- ── 2. Children and matching (estimate 1.3) ───────────────────────────────

-- Birth years, not ages (client, explicit). due_year_precision records that an
-- expecting parent's year was assumed from the capture date, not asked.
create table children (
  id        uuid primary key default gen_random_uuid(),
  person_id uuid not null references people(id) on delete cascade,
  birth_year int,
  expecting  boolean not null default false,
  due_year   int,
  due_year_precision text check (due_year_precision in ('assumed_capture_year','stated')),
  constraint year_shape check (
    (expecting and birth_year is null and due_year is not null) or
    (not expecting and birth_year is not null)
  )
);
create index children_person_idx on children (person_id);

-- Weights are resolved from config at query time (spec §18.1 wins over §8.1), so
-- weight_at_capture is informational: nothing may join on it.
create table social_affinities (
  person_id      uuid not null references people(id) on delete cascade,
  affinity_type  text not null,
  affinity_value text not null,
  weight_at_capture int,
  primary key (person_id, affinity_type, affinity_value)
);
create index social_affinities_lookup_idx on social_affinities (affinity_type, affinity_value);

create table life_relevance (
  person_id uuid not null references people(id) on delete cascade,
  dimension text not null check (dimension in
    ('budget','logistics','family_setup','childcare','tenure','trust_circle')),
  value     text not null,
  primary key (person_id, dimension, value)
);

-- Weights as data, so a change is a config edit and not a migration.
create table affinity_weights (
  affinity_type text primary key,
  weight        int not null check (weight > 0)
);

-- P5: a former school is a different signal from a current one, and both matter.
create table person_schools (
  person_id    uuid not null references people(id) on delete cascade,
  option_value text not null,
  status       text not null check (status in ('current','former','not_yet','homeschool')),
  primary key (person_id, option_value)
);

-- ── 3. Taxonomy (estimate 2.6) ────────────────────────────────────────────

create table market_options (
  id           uuid primary key default gen_random_uuid(),
  market_id    text not null,
  category     text not null,
  option_value text not null,
  label        text not null,
  bands        text[],
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  unique (market_id, category, option_value)
);
create index market_options_lookup_idx on market_options (market_id, category) where active;

-- "Other" answers are not matchable until an admin promotes them (invariant 9).
-- Nothing in a matching or answering path may read this table.
create table pending_options (
  id              uuid primary key default gen_random_uuid(),
  market_id       text not null,
  category        text not null,
  submitted_value text not null,
  submitted_by    uuid references people(id) on delete set null,
  occurrences     int not null default 1,
  status          text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_at      timestamptz not null default now(),
  unique (market_id, category, submitted_value)
);

-- ── 4. Contributions (estimate 1.4–1.6, 1.8, 2.4) ─────────────────────────

-- The card exactly as captured, never edited. Corrections re-send the same
-- client_id and overwrite `fields`; the curated rows below are what an admin
-- edits. This is the answer to "did the parent actually say that".
create table submissions (
  id          uuid primary key default gen_random_uuid(),
  client_id   text not null unique,           -- the idempotency key
  person_id   uuid references people(id) on delete set null,
  kind        share_kind not null,
  fields      jsonb not null,
  is_test     boolean not null default false,
  received_at timestamptz not null default now()
);
create index submissions_person_idx on submissions (person_id, received_at desc);

-- Activities, camps, places and tips share one subject table: they differ by
-- `kind`, not by shape, and an admin reviews them in one queue.
create table places (
  id            uuid primary key default gen_random_uuid(),
  market_id     text not null,
  kind          share_kind not null check (kind <> 'caregiver'),
  name          text not null,
  venue         text,
  neighborhoods text[],
  age_bands     text[],
  place_type    text,                          -- park | library | … (place cards)
  topic         text,                          -- tip cards
  status        review_status not null default 'pending_review',
  provenance    provenance not null default 'parent_submitted',
  confidence    numeric(3,2) check (confidence is null or (confidence >= 0 and confidence <= 1)),

  -- Freshness (v3.2 pings). last_confirmed_at is what a ping refreshes.
  last_confirmed_at timestamptz,
  last_pinged_at    timestamptz,
  freshness_state   text not null default 'fresh'
                    check (freshness_state in ('fresh','ageing','stale')),
  validated_count int not null default 0,
  is_test    boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index places_market_idx on places (market_id, kind, status) where not is_test;
create index places_name_trgm_idx on places using gin (lower(name) gin_trgm_ops);

-- One parent's experience of one place. R1–R11 land here, so five parents
-- recommending the same class is five rows and one place.
create table place_contributions (
  id            uuid primary key default gen_random_uuid(),
  place_id      uuid not null references places(id) on delete cascade,
  person_id     uuid references people(id) on delete set null,
  submission_id uuid references submissions(id) on delete set null,

  -- R2. The label system and Founding eligibility both rest on this column: a
  -- secondhand contribution is welcome, labelled, and never qualifying.
  firsthand         boolean not null,
  child_age_at_time int[],
  last_there        text,     -- current | recent | over_year | unsure
  how_much          text,
  recommendation    text,     -- yes | yes_with_caveats | probably_not | no
  what_makes_it_great text,
  caveat            text,
  -- R7: "nothing comes to mind" counts as answered, and Founding depends on the
  -- distinction between answered-and-empty and never-asked.
  caveat_answered   boolean not null default false,
  who_for           text,
  who_not_for       text,
  price_band        text,
  price_unit        text,     -- per_class | per_session | per_month | per_term | per_camp_week
  worth_it          text,     -- great_value | fair | pricey_worth_it | pricey_not_worth_it | free
  follow_up_ok      boolean not null default false,
  tip_text          text,     -- tip cards keep their one sentence here

  status      review_status not null default 'pending_review',
  approved_at timestamptz,
  approved_by text,
  is_test     boolean not null default false,
  created_at  timestamptz not null default now(),

  -- A band without a unit is unusable: $100/month and $100/term are different
  -- recommendations.
  constraint price_shape check (
    price_band is null or price_band in ('free','prefer_not_to_say') or price_unit is not null
  ),
  -- One parent, one contribution per place. A correction upserts, never doubles.
  unique (place_id, submission_id)
);
create index place_contributions_place_idx  on place_contributions (place_id);
create index place_contributions_person_idx on place_contributions (person_id, status);
create index place_contributions_review_idx on place_contributions (status, created_at)
  where not is_test;

-- ── 5. Caregivers (estimate 1.6, 2.5, 2C · invariants 1, 2, 12, 13, 14) ────

-- The visibility ladder: mentioned → invited → consented → discoverable →
-- introducible. It only ever increases, and only by the caregiver's own action.
-- Note what is absent: no phone, no email, no address. Pando does not contact a
-- nominated caregiver and stores no way to (invariant 13).
create table caregivers (
  id             uuid primary key default gen_random_uuid(),
  market_id      text not null,
  first_name     text not null,
  last_initial   char(1),
  is_adult       boolean not null,
  consent_status consent_status not null default 'mentioned',
  active         boolean not null default false,
  discoverable   boolean not null default false,
  introducible   boolean not null default false,
  -- Set only by the caregiver's own flow (2C), when she creates her profile.
  profile_person_id uuid references people(id) on delete set null,
  consent_evidence  jsonb,     -- { method, note, at } — required to reach 'consented'
  provenance     provenance not null default 'parent_submitted',
  is_test        boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  -- No minors, ever. Not "stored as pending" — refused (invariant 2).
  constraint adults_only check (is_adult),
  -- Invariant 1 as a constraint, not a hope.
  constraint visibility_requires_consent check (
    (not active and not discoverable and not introducible)
    or consent_status = 'consented'
  ),
  constraint ladder_order check (not introducible or discoverable),
  -- Recording consent requires evidence (31 Jul decision).
  constraint consent_needs_evidence check (
    consent_status <> 'consented' or consent_evidence is not null
  )
);
create index caregivers_market_idx on caregivers (market_id, consent_status) where not is_test;
create index caregivers_name_trgm_idx on caregivers using gin (lower(first_name) gin_trgm_ops);

-- One nomination by one parent (C1–C11).
create table caregiver_nominations (
  id            uuid primary key default gen_random_uuid(),
  caregiver_id  uuid not null references caregivers(id) on delete cascade,
  person_id     uuid references people(id) on delete set null,
  submission_id uuid references submissions(id) on delete set null,

  worked_for_family boolean not null,          -- C1, the hard gate
  care_type         text,                      -- C2
  how_known         text,
  how_long          text,
  last_worked       text,                      -- C3
  cared_for_ages    text[],                    -- C4
  strengths         text[],                    -- C5, closed
  in_their_words    text,
  good_fit_for      text[],                    -- C6a
  caveat            text,                      -- C6a, shareable after review
  hire_again        text check (hire_again in ('yes','hesitant','no')),   -- C7
  needs_horizon     text,                      -- C10
  needs_change_type text,
  recontact_ok      boolean not null default false,
  pay_band          text,                      -- C9
  pay_benchmark_consent boolean not null default false,   -- a separate decision
  reference_willing text,                      -- C8, from the parent not the caregiver
  invite_sent_by_parent boolean not null default false,   -- C11

  review_hold  boolean not null default false,
  hold_reasons text[] not null default '{}',
  status       review_status not null default 'pending_review',
  approved_at  timestamptz,
  approved_by  text,
  is_test      boolean not null default false,
  created_at   timestamptz not null default now(),

  -- Firsthand only. A secondhand nomination is refused, not stored weaker
  -- (invariant 14).
  constraint firsthand_only check (worked_for_family),
  -- Anything short of a clear yes cannot be released automatically.
  constraint hold_when_hesitant check (hire_again is null or hire_again = 'yes' or review_hold),
  unique (caregiver_id, submission_id)
);
create index caregiver_nominations_cg_idx     on caregiver_nominations (caregiver_id);
create index caregiver_nominations_review_idx on caregiver_nominations (status, review_hold, created_at)
  where not is_test;

-- C6b, and the reason behind a hesitant C7. Never shown to a family, never shown
-- to the caregiver, never AI-summarized — and in its own table so that
-- `select * from caregiver_nominations` cannot leak it (invariant 12).
create table restricted_notes (
  id            uuid primary key default gen_random_uuid(),
  nomination_id uuid not null references caregiver_nominations(id) on delete cascade,
  kind          text not null check (kind in ('private_note','hesitation_reason')),
  body          text not null,
  created_at    timestamptz not null default now()
);
create index restricted_notes_nom_idx on restricted_notes (nomination_id);

-- 2C, G3–G7. Created by the caregiver herself, after G2 consent.
create table caregiver_profiles (
  caregiver_id  uuid primary key references caregivers(id) on delete cascade,
  roles_wanted  text[],
  age_experience text[],
  areas_served  text[],
  drives        boolean,
  days_available text[],
  hours_note    text,
  rate_band     text,
  open_to_reference_intros boolean not null default false,
  updated_at    timestamptz not null default now()
);

-- ── 6. Review, demand, audit (estimate 1.9, 2.7, 2.8 · v3.2) ──────────────

create table flags (
  id              uuid primary key default gen_random_uuid(),
  severity        text not null check (severity in ('escalation','review','note')),
  reason          text not null,
  subject_kind    text,
  subject_id      uuid,
  person_id       uuid references people(id) on delete set null,
  field           text,
  excerpt         text,                        -- shown on the admin surface only
  confidence      numeric(3,2),
  status          text not null default 'open' check (status in ('open','resolved','escalated')),
  created_at      timestamptz not null default now(),
  resolved_at     timestamptz,
  resolved_by     text,
  resolution_note text
);
create index flags_open_idx on flags (status, severity, created_at desc);

-- D1. `sensitivity` decides what Pando said back; `requires_human_review` keeps a
-- sensitive question out of the knowledge base until a person has read it.
create table demand_signals (
  id            uuid primary key default gen_random_uuid(),
  person_id     uuid references people(id) on delete set null,
  question_text text not null,
  category      text,
  sensitivity   text not null check (sensitivity in ('ordinary','peer_support','high_stakes')),
  requires_human_review boolean not null default false,
  status        text not null default 'open' check (status in ('open','matched','answered','closed')),
  is_test       boolean not null default false,
  created_at    timestamptz not null default now()
);
create index demand_signals_queue_idx on demand_signals (status, sensitivity, created_at desc)
  where not is_test;

-- Written by one path only, so it cannot be forgotten (admin_write, §3.7).
create table audit_log (
  id          uuid primary key default gen_random_uuid(),
  at          timestamptz not null default now(),
  actor       text not null,
  action      text not null,
  resource    text not null,
  resource_id text,
  before      jsonb,
  after       jsonb
);
create index audit_log_at_idx on audit_log (at desc);

-- ── 7. Messaging + entitlements (Phase 2, estimate 1.7 D2/D3) ─────────────

-- Every message, because the frequency rules are computed from it, and the
-- response-rate governor needs the inbound half.
create table message_log (
  id                  uuid primary key default gen_random_uuid(),
  person_id           uuid references people(id) on delete set null,
  direction           text not null check (direction in ('out','in')),
  category            text not null check (category in ('transactional','outreach')),
  template            text,
  template_version    text,
  provider_message_id text,
  responded_to        uuid references message_log(id) on delete set null,
  sent_at             timestamptz not null default now()
);
create index message_log_person_idx on message_log (person_id, sent_at desc);

-- Per-category freshness thresholds, as data: camps are seasonal, playgrounds
-- are not, and Janet changes these without a deploy.
create table freshness_policy (
  kind         share_kind primary key,
  stale_days   int not null check (stale_days > 0),
  ageing_days  int not null check (ageing_days > 0)
);

-- D2/D3. Credits are earned on approval, never on submission.
create table referrals (
  id             uuid primary key default gen_random_uuid(),
  referrer_id    uuid references people(id) on delete set null,
  referred_id    uuid references people(id) on delete set null,
  status         text not null default 'pending'
                 check (status in ('pending','profile_complete','credited','void')),
  created_at     timestamptz not null default now(),
  credited_at    timestamptz,
  unique (referrer_id, referred_id)
);

create table credits (
  id         uuid primary key default gen_random_uuid(),
  person_id  uuid not null references people(id) on delete cascade,
  kind       text not null check (kind in ('network_ask','targeted_network_ask')),
  reason     text not null,
  spent_at   timestamptz,
  created_at timestamptz not null default now()
);
create index credits_person_idx on credits (person_id) where spent_at is null;

-- Kept for the admin's data-quality review (2.3 contributor detail). The app does
-- not send transcripts yet — the chat stays on the device — so this stays empty
-- until that is a deliberate decision.
create table seed_conversations (
  id         uuid primary key default gen_random_uuid(),
  person_id  uuid references people(id) on delete cascade,
  messages   jsonb not null,
  created_at timestamptz not null default now()
);

-- ── 8. updated_at ─────────────────────────────────────────────────────────

create or replace function touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger people_touch      before update on people
  for each row execute function touch_updated_at();
create trigger places_touch      before update on places
  for each row execute function touch_updated_at();
create trigger caregivers_touch  before update on caregivers
  for each row execute function touch_updated_at();
create trigger cg_profiles_touch before update on caregiver_profiles
  for each row execute function touch_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- Pando — 0003 write operations
--
-- **The business logic is not in this file. It is in n8n.**
--
-- Everything here is a thin, decision-free operation: it takes values a workflow
-- has already decided and writes them. No branching on product rules, no
-- derivation, no classification. To learn why a caregiver card was held, or which
-- place a recommendation attached to, you open the n8n canvas — not this SQL.
--
-- What stays in the database, and why each one has to:
--
--  1. **CHECK constraints** (0001). A workflow is edited in a browser UI without
--     review. "No minors", "firsthand only", "never active without consent" must be
--     impossible to write, not merely unlikely — so if a workflow's logic is ever
--     wrong, the database refuses the row rather than storing something unsafe.
--  2. **Atomicity, in exactly one place.** `write_caregiver_nomination` writes the
--     nomination *and* its restricted notes together, because a failure between
--     them would leave a card that reads as clean while the parent's private
--     concern went missing. Every other write is a single row and needs no bundle.
--  3. **Views** (0002). Read paths, so no query can compose its own trust label or
--     reach an unconsented caregiver.
--  4. **One audit row per setter.** Bookkeeping, not a decision, so a workflow that
--     grows a new branch cannot forget it.
--
-- The facts a workflow branches on are views and lookup functions at the bottom of
-- this file — duplicate candidates, the Founding checklist, outreach eligibility.
-- n8n reads those and decides visibly.
--
-- **One calling convention: every operation takes a single `jsonb`.** So every
-- Postgres node in every workflow is the same shape —
--
--     select write_person($1::jsonb)
--     Query Parameters: {{ JSON.stringify($json.body) }}
--
-- — and there is no per-node argument order to get wrong at 11pm. The keys each
-- one reads are named in its comment.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Helpers ───────────────────────────────────────────────────────────────

create or replace function jsonb_text_array(src jsonb)
returns text[] language sql immutable as $$
  select coalesce(
    (select array_agg(v) from jsonb_array_elements_text(src) as v
      where jsonb_typeof(src) = 'array'),
    '{}'::text[])
$$;

create or replace function jsonb_int_array(src jsonb)
returns int[] language sql immutable as $$
  select coalesce(
    (select array_agg(v::int) from jsonb_array_elements_text(src) as v
      where jsonb_typeof(src) = 'array' and v ~ '^-?\d+$'),
    '{}'::int[])
$$;

/**
 * Resolve a person by phone. Never creates one — only `write_person` does — so a
 * workflow that skipped the profile save gets a null and can decide what that means.
 */
create or replace function person_by_phone(p_phone text)
returns uuid language sql stable as $$
  select id from people where phone = p_phone
$$;

-- ── Profile (1.3) ─────────────────────────────────────────────────────────

/**
 * Upsert the contributor and replace everything derived from their answers.
 *
 * The one rule inside is mechanical rather than product logic: **delete-then-insert,
 * not merge.** A parent who removes a school must lose that edge, and doing it
 * row-by-row from n8n would mean four more nodes and a window where the graph is
 * half-updated.
 *
 * It deliberately does not touch `people.founding` — that is a decision, and it
 * belongs to the workflow via `founding_checklist` + `set_founding`.
 */
create or replace function write_person(payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  pid   uuid;
  phone text := nullif(payload->>'phone', '');
begin
  insert into people (
    phone, first_name, last_name, market_id, neighborhood, invite_code,
    invited_via_group, source, time_in_area, moved_from, attribution,
    aggregate_display, monthly_contact_allowance, allowance_mode,
    phone_verified_at, profile_completeness, profile_captured_at,
    topic_preferences, topics_lived_experience, wants_founding, raw_answers,
    child_ages_at_capture, is_test
  ) values (
    phone,
    nullif(payload->>'first_name',''),
    nullif(payload->>'last_name',''),
    coalesce(nullif(payload->>'market_id',''), 'pasadena'),
    nullif(payload->>'neighborhood',''),
    nullif(payload->>'invite_code',''),
    nullif(payload->>'invited_via_group',''),
    nullif(payload->>'source',''),
    nullif(payload->>'time_in_area',''),
    nullif(payload->>'moved_from',''),
    nullif(payload->>'attribution','')::attribution_mode,
    coalesce((payload->>'aggregate_display')::boolean, true),
    nullif(payload->>'monthly_contact_allowance','')::int,
    coalesce(nullif(payload->>'allowance_mode','')::allowance_mode, 'fixed'),
    (payload->>'phone_verified_at')::timestamptz,
    coalesce((payload->>'profile_completeness')::int, 0),
    (payload->>'profile_captured_at')::timestamptz,
    jsonb_text_array(payload->'topic_preferences'),
    jsonb_text_array(payload->'topics_lived_experience'),
    coalesce((payload->>'wants_founding')::boolean, true),
    payload->'answers',
    jsonb_int_array(payload->'child_ages_at_capture'),
    coalesce((payload->>'is_test')::boolean, false)
  )
  on conflict (phone) do update set
    first_name        = coalesce(excluded.first_name, people.first_name),
    last_name         = coalesce(excluded.last_name, people.last_name),
    neighborhood      = coalesce(excluded.neighborhood, people.neighborhood),
    invited_via_group = coalesce(excluded.invited_via_group, people.invited_via_group),
    time_in_area      = excluded.time_in_area,
    moved_from        = excluded.moved_from,
    attribution       = excluded.attribution,
    aggregate_display = excluded.aggregate_display,
    monthly_contact_allowance = excluded.monthly_contact_allowance,
    allowance_mode    = excluded.allowance_mode,
    -- Verification is never downgraded by a later save.
    phone_verified_at = coalesce(people.phone_verified_at, excluded.phone_verified_at),
    profile_completeness    = excluded.profile_completeness,
    profile_captured_at     = coalesce(excluded.profile_captured_at, people.profile_captured_at),
    topic_preferences       = excluded.topic_preferences,
    topics_lived_experience = excluded.topics_lived_experience,
    wants_founding          = excluded.wants_founding,
    raw_answers             = coalesce(excluded.raw_answers, people.raw_answers),
    child_ages_at_capture   = excluded.child_ages_at_capture
  returning id into pid;

  delete from children          where person_id = pid;
  delete from social_affinities where person_id = pid;
  delete from life_relevance    where person_id = pid;
  delete from person_schools    where person_id = pid;

  insert into children (person_id, birth_year, expecting, due_year, due_year_precision)
  select pid,
         nullif(c->>'birth_year','')::int,
         coalesce((c->>'expecting')::boolean, false),
         nullif(c->>'due_year','')::int,
         nullif(c->>'due_year_precision','')
  from jsonb_array_elements(coalesce(payload->'children', '[]'::jsonb)) c;

  insert into social_affinities (person_id, affinity_type, affinity_value, weight_at_capture)
  select pid, a->>'affinity_type', a->>'affinity_value', nullif(a->>'score_weight','')::int
  from jsonb_array_elements(coalesce(payload->'social_affinities', '[]'::jsonb)) a
  where coalesce(a->>'affinity_value','') <> ''
  on conflict (person_id, affinity_type, affinity_value) do nothing;

  insert into life_relevance (person_id, dimension, value)
  select distinct pid, r->>'dimension', r->>'value'
  from jsonb_array_elements(coalesce(payload->'life_relevance', '[]'::jsonb)) r
  where coalesce(r->>'value','') <> ''
  on conflict do nothing;

  insert into person_schools (person_id, option_value, status)
  select pid, key, value #>> '{}'
  from jsonb_each(coalesce(payload->'school_status', '{}'::jsonb))
  on conflict (person_id, option_value) do update set status = excluded.status;

  return pid;
end $$;

/** { market_id, category, submitted_value, person_id } */
create or replace function write_pending_option(payload jsonb)
returns uuid
language sql security definer set search_path = public as $$
  insert into pending_options (market_id, category, submitted_value, submitted_by)
  values (coalesce(nullif(payload->>'market_id',''),'pasadena'),
          payload->>'category', payload->>'submitted_value',
          nullif(payload->>'person_id','')::uuid)
  on conflict (market_id, category, submitted_value)
    do update set occurrences = pending_options.occurrences + 1
  returning id
$$;

/** { person_id, scope, status, source, text_version, captured_at } */
create or replace function write_consent(payload jsonb)
returns uuid
language sql security definer set search_path = public as $$
  insert into consents (person_id, scope, status, source, text_version, captured_at)
  values ((payload->>'person_id')::uuid, payload->>'scope', payload->>'status',
          payload->>'source', payload->>'text_version',
          coalesce((payload->>'captured_at')::timestamptz, now()))
  returning id
$$;

/** { person_id, monthly_contact_allowance, allowance_mode } */
create or replace function set_allowance(payload jsonb)
returns void
language sql security definer set search_path = public as $$
  update people
     set monthly_contact_allowance = nullif(payload->>'monthly_contact_allowance','')::int,
         allowance_mode = coalesce(nullif(payload->>'allowance_mode','')::allowance_mode,
                                   'fixed')
   where id = (payload->>'person_id')::uuid
$$;

-- ── Cards (1.4–1.6) ───────────────────────────────────────────────────────

/** The card as captured. Upsert on client_id: a correction re-sends the same id. */
create or replace function write_submission(payload jsonb)
returns uuid
language sql security definer set search_path = public as $$
  insert into submissions (client_id, person_id, kind, fields, is_test, received_at)
  values (payload->>'client_id',
          nullif(payload->>'person_id','')::uuid,
          (payload->>'kind')::share_kind,
          coalesce(payload->'fields', '{}'::jsonb),
          coalesce((payload->>'is_test')::boolean, false),
          coalesce((payload->>'received_at')::timestamptz, now()))
  on conflict (client_id) do update set
    fields    = excluded.fields,
    person_id = coalesce(excluded.person_id, submissions.person_id)
  returning id
$$;

create or replace function write_place(payload jsonb)
returns uuid
language sql security definer set search_path = public as $$
  insert into places (market_id, kind, name, venue, neighborhoods, age_bands,
                      place_type, topic, is_test)
  values (coalesce(nullif(payload->>'market_id',''),'pasadena'),
          (payload->>'kind')::share_kind,
          payload->>'name',
          nullif(payload->>'venue',''),
          jsonb_text_array(payload->'neighborhoods'),
          jsonb_text_array(payload->'age_bands'),
          nullif(payload->>'place_type',''),
          nullif(payload->>'topic',''),
          coalesce((payload->>'is_test')::boolean, false))
  returning id
$$;

/**
 * One parent's experience of one place (R1–R11). Every judgement is passed in:
 * whether it counts as firsthand, whether the caveat prompt was answered, which
 * place it belongs to. Those are the workflow's calls, and they stay visible there.
 */
create or replace function write_place_contribution(payload jsonb)
returns uuid
language sql security definer set search_path = public as $$
  insert into place_contributions (
    place_id, person_id, submission_id, firsthand, child_age_at_time, last_there,
    how_much, recommendation, what_makes_it_great, caveat, caveat_answered,
    who_for, who_not_for, price_band, price_unit, worth_it, follow_up_ok, tip_text,
    is_test
  ) values (
    (payload->>'place_id')::uuid,
    nullif(payload->>'person_id','')::uuid,
    nullif(payload->>'submission_id','')::uuid,
    coalesce((payload->>'firsthand')::boolean, false),
    jsonb_int_array(payload->'child_age_at_time'),
    nullif(payload->>'last_there',''),
    nullif(payload->>'how_much',''),
    nullif(payload->>'recommendation',''),
    nullif(payload->>'what_makes_it_great',''),
    nullif(payload->>'caveat',''),
    coalesce((payload->>'caveat_answered')::boolean, false),
    nullif(payload->>'who_for',''),
    nullif(payload->>'who_not_for',''),
    nullif(payload->>'price_band',''),
    nullif(payload->>'price_unit',''),
    nullif(payload->>'worth_it',''),
    coalesce((payload->>'follow_up_ok')::boolean, false),
    nullif(payload->>'tip_text',''),
    coalesce((payload->>'is_test')::boolean, false)
  )
  on conflict (place_id, submission_id) do update set
    firsthand           = excluded.firsthand,
    child_age_at_time   = excluded.child_age_at_time,
    last_there          = excluded.last_there,
    how_much            = excluded.how_much,
    recommendation      = excluded.recommendation,
    what_makes_it_great = excluded.what_makes_it_great,
    caveat              = excluded.caveat,
    caveat_answered     = excluded.caveat_answered,
    who_for             = excluded.who_for,
    who_not_for         = excluded.who_not_for,
    price_band          = excluded.price_band,
    price_unit          = excluded.price_unit,
    worth_it            = excluded.worth_it,
    follow_up_ok        = excluded.follow_up_ok,
    tip_text            = excluded.tip_text
  returning id
$$;

/**
 * A new caregiver row. Always at the bottom of the ladder: 'mentioned', not active,
 * not discoverable. Moving up happens through the two setters below, and only ever
 * upward.
 */
create or replace function write_caregiver(payload jsonb)
returns uuid
language sql security definer set search_path = public as $$
  insert into caregivers (market_id, first_name, last_initial, is_adult, is_test)
  values (coalesce(nullif(payload->>'market_id',''),'pasadena'),
          payload->>'first_name',
          nullif(upper(left(coalesce(payload->>'last_initial',''),1)), ''),
          coalesce((payload->>'is_adult')::boolean, false),
          coalesce((payload->>'is_test')::boolean, false))
  returning id
$$;

/**
 * The one bundled write in the schema (C1–C11).
 *
 * The nomination and its restricted notes go in together because a failure between
 * them would leave a card that reads as clean while the parent's private concern is
 * gone — the one silent failure here that would actually hurt somebody.
 *
 * The hold is still the workflow's decision: pass `review_hold` and `hold_reasons`.
 * The CHECK in 0001 refuses the row if a hesitant answer arrives without one, so a
 * mistake on the canvas fails loudly instead of releasing a held card.
 *
 * `restricted_notes`: [{ "kind": "private_note" | "hesitation_reason", "body": … }]
 */
create or replace function write_caregiver_nomination(payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare nom_id uuid;
begin
  insert into caregiver_nominations (
    caregiver_id, person_id, submission_id, worked_for_family, care_type, how_known,
    how_long, last_worked, cared_for_ages, strengths, in_their_words, good_fit_for,
    caveat, hire_again, needs_horizon, needs_change_type, recontact_ok, pay_band,
    pay_benchmark_consent, reference_willing, invite_sent_by_parent,
    review_hold, hold_reasons, is_test
  ) values (
    (payload->>'caregiver_id')::uuid,
    nullif(payload->>'person_id','')::uuid,
    nullif(payload->>'submission_id','')::uuid,
    coalesce((payload->>'worked_for_family')::boolean, false),
    nullif(payload->>'care_type',''),
    nullif(payload->>'how_known',''),
    nullif(payload->>'how_long',''),
    nullif(payload->>'last_worked',''),
    jsonb_text_array(payload->'cared_for_ages'),
    jsonb_text_array(payload->'strengths'),
    nullif(payload->>'in_their_words',''),
    jsonb_text_array(payload->'good_fit_for'),
    nullif(payload->>'caveat',''),
    nullif(payload->>'hire_again',''),
    nullif(payload->>'needs_horizon',''),
    nullif(payload->>'needs_change_type',''),
    coalesce((payload->>'recontact_ok')::boolean, false),
    nullif(payload->>'pay_band',''),
    coalesce((payload->>'pay_benchmark_consent')::boolean, false),
    nullif(payload->>'reference_willing',''),
    coalesce((payload->>'invite_sent_by_parent')::boolean, false),
    coalesce((payload->>'review_hold')::boolean, false),
    jsonb_text_array(payload->'hold_reasons'),
    coalesce((payload->>'is_test')::boolean, false)
  )
  on conflict (caregiver_id, submission_id) do update set
    care_type = excluded.care_type, how_known = excluded.how_known,
    how_long = excluded.how_long, last_worked = excluded.last_worked,
    cared_for_ages = excluded.cared_for_ages, strengths = excluded.strengths,
    in_their_words = excluded.in_their_words, good_fit_for = excluded.good_fit_for,
    caveat = excluded.caveat, hire_again = excluded.hire_again,
    needs_horizon = excluded.needs_horizon, needs_change_type = excluded.needs_change_type,
    recontact_ok = excluded.recontact_ok, pay_band = excluded.pay_band,
    pay_benchmark_consent = excluded.pay_benchmark_consent,
    reference_willing = excluded.reference_willing,
    invite_sent_by_parent = excluded.invite_sent_by_parent,
    -- A re-save can add a hold, never clear one.
    review_hold  = caregiver_nominations.review_hold or excluded.review_hold,
    hold_reasons = (select array_agg(distinct x) from unnest(
                      caregiver_nominations.hold_reasons || excluded.hold_reasons) x)
  returning id into nom_id;

  delete from restricted_notes where nomination_id = nom_id;
  insert into restricted_notes (nomination_id, kind, body)
  select nom_id, n->>'kind', n->>'body'
  from jsonb_array_elements(coalesce(payload->'restricted_notes', '[]'::jsonb)) n
  where coalesce(n->>'body','') <> '';

  return nom_id;
end $$;

/**
 * Move a caregiver's consent state. 'consented' needs evidence and 'active' is
 * impossible without consent — both refused by the constraints in 0001 if a
 * workflow tries otherwise.
 */
/** { caregiver_id, consent_status, evidence: {method, note, at}, actor } */
create or replace function set_caregiver_consent(payload jsonb)
returns void
language plpgsql security definer set search_path = public as $$
declare
  before_row jsonb;
  cg_id uuid := (payload->>'caregiver_id')::uuid;
begin
  select to_jsonb(c) into before_row from caregivers c where c.id = cg_id;
  if before_row is null then
    raise exception 'set_caregiver_consent: no caregiver %', cg_id;
  end if;

  update caregivers
     set consent_status   = (payload->>'consent_status')::consent_status,
         consent_evidence = coalesce(payload->'evidence', consent_evidence)
   where id = cg_id;

  insert into audit_log (actor, action, resource, resource_id, before, after)
  values (coalesce(nullif(payload->>'actor',''),'workflow'), 'caregiver.consent',
          'caregiver', cg_id::text, before_row,
          jsonb_build_object('consent_status', payload->>'consent_status',
                             'evidence', payload->'evidence'));
end $$;

/** { caregiver_id, active, discoverable, introducible, actor } — omitted keys keep
    their current value. */
create or replace function set_caregiver_visibility(payload jsonb)
returns void
language plpgsql security definer set search_path = public as $$
declare
  before_row jsonb;
  cg_id uuid := (payload->>'caregiver_id')::uuid;
begin
  select to_jsonb(c) into before_row from caregivers c where c.id = cg_id;

  update caregivers
     set active       = coalesce((payload->>'active')::boolean, active),
         discoverable = coalesce((payload->>'discoverable')::boolean, discoverable),
         introducible = coalesce((payload->>'introducible')::boolean, introducible)
   where id = cg_id;

  insert into audit_log (actor, action, resource, resource_id, before, after)
  values (coalesce(nullif(payload->>'actor',''),'workflow'), 'caregiver.visibility',
          'caregiver', cg_id::text, before_row,
          payload - 'actor' - 'caregiver_id');
end $$;

-- ── Completion, review, demand (1.7, 1.9, 2.x) ────────────────────────────

create or replace function write_demand_signal(payload jsonb)
returns uuid
language sql security definer set search_path = public as $$
  insert into demand_signals (person_id, question_text, category, sensitivity,
                              requires_human_review, is_test)
  values (nullif(payload->>'person_id','')::uuid,
          payload->>'question_text',
          nullif(payload->>'category',''),
          coalesce(nullif(payload->>'sensitivity',''), 'ordinary'),
          coalesce((payload->>'requires_human_review')::boolean, false),
          coalesce((payload->>'is_test')::boolean, false))
  returning id
$$;

create or replace function write_flag(payload jsonb)
returns uuid
language sql security definer set search_path = public as $$
  insert into flags (severity, reason, subject_kind, subject_id, person_id,
                     field, excerpt, confidence)
  values (payload->>'severity', payload->>'reason',
          nullif(payload->>'subject_kind',''),
          nullif(payload->>'subject_id','')::uuid,
          nullif(payload->>'person_id','')::uuid,
          nullif(payload->>'field',''),
          nullif(payload->>'excerpt',''),
          nullif(payload->>'confidence','')::numeric)
  returning id
$$;

/** { flag_id, status, note, actor } */
create or replace function resolve_flag(payload jsonb)
returns void
language plpgsql security definer set search_path = public as $$
declare fid uuid := (payload->>'flag_id')::uuid;
begin
  update flags set status = payload->>'status', resolved_at = now(),
                   resolved_by = nullif(payload->>'actor',''),
                   resolution_note = nullif(payload->>'note','')
   where id = fid;

  insert into audit_log (actor, action, resource, resource_id, after)
  values (coalesce(nullif(payload->>'actor',''),'workflow'),
          'flag.' || (payload->>'status'), 'flag', fid::text,
          jsonb_build_object('status', payload->>'status'));
end $$;

/**
 * The review outcome for one contribution. The judgement is the admin's; this
 * records it and writes the audit row.
 * { contribution_id, status, actor }
 */
create or replace function set_contribution_status(payload jsonb)
returns void
language plpgsql security definer set search_path = public as $$
declare
  before_row jsonb;
  cid    uuid := (payload->>'contribution_id')::uuid;
  status text := payload->>'status';
  actor  text := coalesce(nullif(payload->>'actor',''), 'workflow');
begin
  select to_jsonb(pc) into before_row from place_contributions pc where pc.id = cid;
  if before_row is null then
    raise exception 'set_contribution_status: no contribution %', cid;
  end if;

  update place_contributions
     set status = status::review_status,
         approved_at = case when status = 'approved' then now() else approved_at end,
         approved_by = case when status = 'approved' then actor else approved_by end
   where id = cid;

  insert into audit_log (actor, action, resource, resource_id, before, after)
  values (actor, 'contribution.' || status, 'place_contribution', cid::text,
          before_row, jsonb_build_object('status', status));
end $$;

/** { nomination_id, status, actor } */
create or replace function set_nomination_status(payload jsonb)
returns void
language plpgsql security definer set search_path = public as $$
declare
  before_row jsonb;
  nid    uuid := (payload->>'nomination_id')::uuid;
  status text := payload->>'status';
  actor  text := coalesce(nullif(payload->>'actor',''), 'workflow');
begin
  select to_jsonb(n) into before_row from caregiver_nominations n where n.id = nid;
  if before_row is null then
    raise exception 'set_nomination_status: no nomination %', nid;
  end if;

  update caregiver_nominations
     set status = status::review_status,
         approved_at = case when status = 'approved' then now() else approved_at end,
         approved_by = case when status = 'approved' then actor else approved_by end
   where id = nid;

  insert into audit_log (actor, action, resource, resource_id, before, after)
  values (actor, 'nomination.' || status, 'caregiver_nomination', nid::text,
          before_row, jsonb_build_object('status', status));
end $$;

/** { place_id, status, actor } */
create or replace function set_place_status(payload jsonb)
returns void
language plpgsql security definer set search_path = public as $$
declare
  pid    uuid := (payload->>'place_id')::uuid;
  status text := payload->>'status';
  actor  text := coalesce(nullif(payload->>'actor',''), 'workflow');
begin
  update places set status = status::review_status,
                    last_confirmed_at = case when status = 'approved'
                                             then coalesce(last_confirmed_at, now())
                                             else last_confirmed_at end
  where id = pid;

  insert into audit_log (actor, action, resource, resource_id, after)
  values (actor, 'place.' || status, 'place', pid::text,
          jsonb_build_object('status', status));
end $$;

/**
 * Founding as a setter, not a rule. The rule — verified phone, a neighborhood, a
 * child, allowance at 3 or more, two approved qualifying contributions — is an IF
 * node in n8n reading `founding_checklist`, so Janet can see it and change it.
 *
 * The one thing enforced here is the client's promise: founding is permanent and
 * never downgrades.
 */
/** { person_id, status, actor } */
create or replace function set_founding(payload jsonb)
returns void
language plpgsql security definer set search_path = public as $$
declare
  current_status founding_status;
  pid    uuid := (payload->>'person_id')::uuid;
  target text := payload->>'status';
  actor  text := coalesce(nullif(payload->>'actor',''), 'workflow');
begin
  select founding into current_status from people where id = pid;
  if current_status is null then
    raise exception 'set_founding: no person %', pid;
  end if;
  if current_status = 'founding' and target <> 'founding' then
    raise exception 'set_founding: founding is permanent and never downgrades';
  end if;

  update people set founding = target::founding_status where id = pid;

  insert into audit_log (actor, action, resource, resource_id, before, after)
  values (actor, 'founding.' || target, 'person', pid::text,
          jsonb_build_object('founding', current_status),
          jsonb_build_object('founding', target));
end $$;

/** Promote an "other" answer into the taxonomy. n8n supplies the slug it chose. */
/** { pending_option_id, option_value, label, actor } — n8n supplies the slug. */
create or replace function promote_option(payload jsonb)
returns void
language plpgsql security definer set search_path = public as $$
declare
  o     record;
  oid   uuid := (payload->>'pending_option_id')::uuid;
  slug  text := payload->>'option_value';
  actor text := coalesce(nullif(payload->>'actor',''), 'workflow');
begin
  select * into o from pending_options where id = oid;
  if o is null then raise exception 'promote_option: no pending option %', oid; end if;

  insert into market_options (market_id, category, option_value, label)
  values (o.market_id, o.category, slug,
          coalesce(nullif(payload->>'label',''), o.submitted_value))
  on conflict (market_id, category, option_value) do update set active = true;

  update pending_options set status = 'approved' where id = oid;

  insert into audit_log (actor, action, resource, resource_id, after)
  values (actor, 'option.promote', 'pending_option', oid::text,
          jsonb_build_object('category', o.category, 'option_value', slug));
end $$;

/** { person_id, kind, reason } — earned on approval, never on submission (D2/D3). */
create or replace function write_credit(payload jsonb)
returns uuid
language sql security definer set search_path = public as $$
  insert into credits (person_id, kind, reason)
  values ((payload->>'person_id')::uuid, payload->>'kind', payload->>'reason')
  returning id
$$;

create or replace function write_message_log(payload jsonb)
returns uuid
language sql security definer set search_path = public as $$
  insert into message_log (person_id, direction, category, template, template_version,
                           provider_message_id, responded_to)
  values (nullif(payload->>'person_id','')::uuid,
          payload->>'direction', payload->>'category',
          nullif(payload->>'template',''),
          nullif(payload->>'template_version',''),
          nullif(payload->>'provider_message_id',''),
          nullif(payload->>'responded_to','')::uuid)
  returning id
$$;

-- SMS keywords. STOP writes; START and UNSTOP clear — never YES.
/** { phone, keyword } */
create or replace function set_opt_out(payload jsonb)
returns void
language sql security definer set search_path = public as $$
  insert into sms_opt_outs (phone, keyword)
  values (payload->>'phone', payload->>'keyword')
  on conflict (phone) do update set keyword = excluded.keyword, opted_out_at = now()
$$;

/** { phone } */
create or replace function clear_opt_out(payload jsonb)
returns void
language sql security definer set search_path = public as $$
  delete from sms_opt_outs where phone = payload->>'phone'
$$;

/** { phone, allowed } — PRIVACY, the standing opt-out the disclosure promised. */
create or replace function set_aggregate_display(payload jsonb)
returns void
language sql security definer set search_path = public as $$
  update people set aggregate_display = coalesce((payload->>'allowed')::boolean, false)
   where phone = payload->>'phone'
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- Facts for n8n
--
-- Not decisions — the inputs a workflow branches on. Each one answers a question a
-- node asks, so the IF that follows is readable on the canvas.
-- ═══════════════════════════════════════════════════════════════════════════

/**
 * "Is this place already here?" The exact match first, then near-matches with a
 * score, so the workflow can attach, create, or create-and-flag — visibly, rather
 * than inside a function nobody opens.
 */
/** { market_id, kind, name } */
create or replace function place_candidates(payload jsonb)
returns table (id uuid, name text, venue text, score real, exact_match boolean)
language sql stable security definer set search_path = public as $$
  select p.id, p.name, p.venue,
         similarity(lower(p.name), lower(payload->>'name')) as score,
         lower(p.name) = lower(payload->>'name')            as exact_match
  from places p
  where p.market_id = coalesce(nullif(payload->>'market_id',''),'pasadena')
    and p.kind = (payload->>'kind')::share_kind
    and (lower(p.name) = lower(payload->>'name')
         or similarity(lower(p.name), lower(payload->>'name')) > 0.5)
  order by exact_match desc, score desc
  limit 5
$$;

/** { market_id, first_name, last_initial } */
create or replace function caregiver_candidates(payload jsonb)
returns table (id uuid, first_name text, last_initial text, consent_status text,
               score real, exact_match boolean)
language sql stable security definer set search_path = public as $$
  select c.id, c.first_name, c.last_initial::text, c.consent_status::text,
         similarity(lower(c.first_name), lower(payload->>'first_name')) as score,
         (lower(c.first_name) = lower(payload->>'first_name')
          and coalesce(c.last_initial::text,'')
              = coalesce(nullif(upper(left(payload->>'last_initial',1)),''),''))
           as exact_match
  from caregivers c
  where c.market_id = coalesce(nullif(payload->>'market_id',''),'pasadena')
    and (lower(c.first_name) = lower(payload->>'first_name')
         or similarity(lower(c.first_name), lower(payload->>'first_name')) > 0.6)
  order by exact_match desc, score desc
  limit 5
$$;

/**
 * The facts behind the send order (invariant 6), so the outreach workflow shows
 * them as five IF nodes instead of hiding them in SQL. The app's send layer
 * (web/lib/server/sms.ts) re-checks every one before anything actually goes out —
 * n8n decides *who is due*, the app decides *whether a text may leave*.
 */
create or replace view outreach_facts as
select
  p.id as person_id,
  p.phone is not null and exists (
    select 1 from sms_opt_outs o where o.phone = p.phone)              as opted_out,
  extract(hour from (now() at time zone 'America/Los_Angeles'))::int   as hour_pt,
  p.allowance_mode,
  p.monthly_contact_allowance,
  (select count(*) from message_log m
    where m.person_id = p.id and m.direction = 'out'
      and m.category = 'outreach' and m.sent_at > now() - interval '30 days')
                                                                       as outreach_30d,
  (select max(m.sent_at) from message_log m
    where m.person_id = p.id and m.direction = 'out' and m.category = 'outreach')
                                                                       as last_outreach_at,
  (select count(*) from message_log m
    where m.person_id = p.id and m.direction = 'out'
      and m.sent_at > now() - interval '30 days')                      as sent_30d,
  (select count(*) from message_log m
    where m.person_id = p.id and m.direction = 'in'
      and m.sent_at > now() - interval '30 days')                      as replies_30d
from people p
where not p.is_test;

/** Places whose category threshold has passed — the freshness ping's work list. */
create or replace view places_due_for_ping as
select p.id as place_id, p.kind, p.name, p.market_id,
       p.last_confirmed_at, p.last_pinged_at,
       f.ageing_days, f.stale_days,
       greatest(0, extract(day from now() - coalesce(p.last_confirmed_at, p.created_at))::int)
         as days_since_confirmed
from places p
join freshness_policy f on f.kind = p.kind
where p.status = 'approved'
  and not p.is_test
  and coalesce(p.last_confirmed_at, p.created_at) < now() - (f.ageing_days || ' days')::interval
  and (p.last_pinged_at is null or p.last_pinged_at < now() - interval '30 days');

-- ═══════════════════════════════════════════════════════════════════════════
-- Admin write operations (2.2–2.8)
--
-- Same rule as everything above: the decision is the admin's, made on a page and
-- carried through a workflow. These record it, and each writes its own audit row so
-- a new branch on the canvas cannot forget one.
-- ═══════════════════════════════════════════════════════════════════════════

/** { demand_id, status, note, actor } */
create or replace function set_demand_status(payload jsonb)
returns void
language plpgsql security definer set search_path = public as $$
declare
  did    uuid := (payload->>'demand_id')::uuid;
  target text := payload->>'status';
  actor  text := coalesce(nullif(payload->>'actor',''), 'workflow');
  before_row jsonb;
begin
  select to_jsonb(d) into before_row from demand_signals d where d.id = did;
  if before_row is null then
    raise exception 'set_demand_status: no demand signal %', did;
  end if;

  update demand_signals set status = target where id = did;

  insert into audit_log (actor, action, resource, resource_id, before, after)
  values (actor, 'demand.' || target, 'demand_signal', did::text,
          jsonb_build_object('status', before_row->>'status'),
          jsonb_build_object('status', target, 'note', payload->>'note'));
end $$;

/** { contribution_id, confidence, age_band } — the extraction engine's only write. */
create or replace function set_contribution_confidence(payload jsonb)
returns void
language plpgsql security definer set search_path = public as $$
declare cid uuid := (payload->>'contribution_id')::uuid;
begin
  update place_contributions
     set confidence = nullif(payload->>'confidence','')::numeric
   where id = cid;

  /* An extracted age band fills a gap; it never overwrites what a parent tapped,
     and it never touches their words. */
  if nullif(payload->>'age_band','') is not null then
    update places p
       set age_bands = (select array_agg(distinct x)
                        from unnest(coalesce(p.age_bands,'{}') ||
                                    array[payload->>'age_band']) x)
     where p.id = (select place_id from place_contributions where id = cid)
       and coalesce(array_length(p.age_bands, 1), 0) = 0;
  end if;
end $$;

/**
 * { nomination_id, note, actor } — releasing a review hold.
 *
 * A hold exists because a parent hesitated about a named person, so this refuses to
 * run without a reason, and the reason is what goes in the audit row.
 */
create or replace function release_nomination_hold(payload jsonb)
returns void
language plpgsql security definer set search_path = public as $$
declare
  nid   uuid := (payload->>'nomination_id')::uuid;
  note  text := nullif(trim(payload->>'note'), '');
  actor text := coalesce(nullif(payload->>'actor',''), 'workflow');
  before_row jsonb;
begin
  if note is null or length(note) < 3 then
    raise exception 'release_nomination_hold: a hold is only released with a reason';
  end if;

  select to_jsonb(n) into before_row from caregiver_nominations n where n.id = nid;
  if before_row is null then
    raise exception 'release_nomination_hold: no nomination %', nid;
  end if;

  update caregiver_nominations
     set review_hold = false, hold_reasons = '{}'
   where id = nid;

  insert into audit_log (actor, action, resource, resource_id, before, after)
  values (actor, 'nomination.release_hold', 'caregiver_nomination', nid::text,
          jsonb_build_object('review_hold', true,
                             'hold_reasons', before_row->'hold_reasons'),
          jsonb_build_object('review_hold', false, 'note', note));
end $$;

/** { contribution_id, patch: {...}, actor } — tidying wording, never provenance. */
create or replace function edit_contribution(payload jsonb)
returns void
language plpgsql security definer set search_path = public as $$
declare
  cid   uuid := (payload->>'contribution_id')::uuid;
  patch jsonb := coalesce(payload->'patch', '{}'::jsonb);
  actor text := coalesce(nullif(payload->>'actor',''), 'workflow');
  before_row jsonb;
begin
  select to_jsonb(pc) into before_row from place_contributions pc where pc.id = cid;
  if before_row is null then
    raise exception 'edit_contribution: no contribution %', cid;
  end if;

  /* Only these four. `firsthand`, `person_id`, `caveat_answered` and the freshness
     dates are provenance — an edit must not be able to change who said what. */
  update place_contributions set
    what_makes_it_great = coalesce(patch->>'what_makes_it_great', what_makes_it_great),
    caveat              = coalesce(patch->>'caveat', caveat),
    who_for             = coalesce(patch->>'who_for', who_for),
    who_not_for         = coalesce(patch->>'who_not_for', who_not_for)
  where id = cid;

  insert into audit_log (actor, action, resource, resource_id, before, after)
  values (actor, 'contribution.edit', 'place_contribution', cid::text,
          before_row, patch);
end $$;

/** { person_id, body, actor } — an admin's note on a contributor. */
create or replace function write_contributor_note(payload jsonb)
returns void
language plpgsql security definer set search_path = public as $$
declare
  pid   uuid := (payload->>'person_id')::uuid;
  actor text := coalesce(nullif(payload->>'actor',''), 'workflow');
begin
  insert into audit_log (actor, action, resource, resource_id, after)
  values (actor, 'contributor.note', 'person', pid::text,
          jsonb_build_object('body', payload->>'body'));
end $$;

/** { pending_option_id, status, actor } — reject or retire, without promoting. */
create or replace function set_option_status(payload jsonb)
returns void
language plpgsql security definer set search_path = public as $$
declare
  oid    uuid := (payload->>'pending_option_id')::uuid;
  target text := payload->>'status';
  actor  text := coalesce(nullif(payload->>'actor',''), 'workflow');
begin
  update pending_options set status = target where id = oid;

  insert into audit_log (actor, action, resource, resource_id, after)
  values (actor, 'option.' || target, 'pending_option', oid::text,
          jsonb_build_object('status', target));
end $$;

/**
 * { actor, action, resource, resource_id, after } — the catch-all audit row the
 * admin_write workflow writes on its shared path, after the Switch.
 *
 * Most setters above write their own row; this one records the *action* itself, so an
 * admin action that only changes state through a page still leaves a trace.
 */
create or replace function write_audit(payload jsonb)
returns uuid
language sql security definer set search_path = public as $$
  insert into audit_log (actor, action, resource, resource_id, before, after)
  values (coalesce(nullif(payload->>'actor',''), 'workflow'),
          payload->>'action',
          coalesce(nullif(payload->>'resource',''), 'admin'),
          nullif(payload->>'resource_id',''),
          payload->'before',
          payload->'after')
  returning id
$$;

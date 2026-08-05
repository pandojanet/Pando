-- ═══════════════════════════════════════════════════════════════════════════
-- Pando — 0006 the operations the earlier files left out
--
-- Three genuine gaps, and one thing that is the product rather than plumbing:
--
--  1. **2C** — the caregiver's own profile. The schema had `caregiver_profiles` and the
--     ladder columns from the start, but no way to write them.
--  2. **Merging duplicates** — the one admin action that is not a status change, and the
--     only one that can destroy information if it is careless.
--  3. **Retiring a taxonomy option** — the other half of promotion.
--  4. **Matching.** The two-layer query the whole product is for. First version, and
--     deliberately readable rather than clever.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 2C · the caregiver's own flow (G1–G10) ────────────────────────────────

/**
 * Everything the caregiver says about herself, plus the visibility she granted.
 *
 * The rule this enforces, because it is the one that matters: **visibility only ever
 * increases, and only from here.** A parent's nomination can reach `invited`; every
 * step past that is the caregiver's own act. An admin can revoke, never promote.
 *
 * { caregiver_id, person_id, roles_wanted[], age_experience[], areas_served[],
 *   drives, days_available[], hours_note, rate_band,
 *   open_to_reference_intros, appear_in_answers, allow_introductions,
 *   consent: { text_version, captured_at } }
 */
create or replace function apply_caregiver_profile(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  cg_id     uuid := (payload->>'caregiver_id')::uuid;
  person_id uuid := nullif(payload->>'person_id','')::uuid;
  current   consent_status;
begin
  select consent_status into current from caregivers where id = cg_id;
  if current is null then
    raise exception 'apply_caregiver_profile: no caregiver %', cg_id;
  end if;
  if current in ('declined', 'revoked') then
    raise exception 'apply_caregiver_profile: % has withdrawn; a profile cannot reopen it', cg_id;
  end if;

  -- G2. Consenting to a private profile is what moves them off `invited`, and it is
  -- recorded with the wording they saw.
  if payload->'consent' is not null then
    insert into consents (person_id, scope, status, source, text_version, captured_at)
    values (person_id, 'caregiver_profile', 'opted_in', 'caregiver_flow',
            payload->'consent'->>'text_version',
            coalesce((payload->'consent'->>'captured_at')::timestamptz, now()));
  end if;

  insert into caregiver_profiles (
    caregiver_id, roles_wanted, age_experience, areas_served, drives,
    days_available, hours_note, rate_band, open_to_reference_intros
  ) values (
    cg_id,
    jsonb_text_array(payload->'roles_wanted'),
    jsonb_text_array(payload->'age_experience'),
    jsonb_text_array(payload->'areas_served'),
    (payload->>'drives')::boolean,
    jsonb_text_array(payload->'days_available'),
    nullif(payload->>'hours_note',''),
    nullif(payload->>'rate_band',''),
    coalesce((payload->>'open_to_reference_intros')::boolean, false)
  )
  on conflict (caregiver_id) do update set
    roles_wanted   = excluded.roles_wanted,
    age_experience = excluded.age_experience,
    areas_served   = excluded.areas_served,
    drives         = excluded.drives,
    days_available = excluded.days_available,
    hours_note     = excluded.hours_note,
    rate_band      = excluded.rate_band,
    open_to_reference_intros = excluded.open_to_reference_intros;

  /* The ladder. `consented` needs evidence, and her own profile *is* the evidence —
     an auditable act with a timestamp and a wording version, which is more than a
     phone call gives us. G9 and G10 are separate answers, so a caregiver who wants to
     be listed but not introduced gets exactly that. */
  update caregivers set
    profile_person_id = coalesce(person_id, profile_person_id),
    consent_status    = 'consented',
    consent_evidence  = coalesce(consent_evidence, jsonb_build_object(
      'method', 'caregiver_profile',
      'note', 'Set up her own profile and consented in the flow',
      'at', now())),
    active       = coalesce((payload->>'appear_in_answers')::boolean, active),
    discoverable = coalesce((payload->>'appear_in_answers')::boolean, discoverable),
    introducible = coalesce((payload->>'allow_introductions')::boolean, introducible)
  where id = cg_id;

  insert into audit_log (actor, action, resource, resource_id, before, after)
  values ('caregiver', 'caregiver.profile', 'caregiver', cg_id::text,
          jsonb_build_object('consent_status', current),
          payload - 'consent');

  return jsonb_build_object('persisted', true, 'caregiver_id', cg_id);
end $$;

/** G2's other half: withdrawing. Deletes the profile and stops all visibility. */
create or replace function withdraw_caregiver(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare cg_id uuid := (payload->>'caregiver_id')::uuid;
begin
  delete from caregiver_profiles where caregiver_id = cg_id;

  update caregivers set
    consent_status = 'revoked',
    active = false, discoverable = false, introducible = false
  where id = cg_id;

  insert into consents (person_id, scope, status, source, text_version)
  select profile_person_id, 'caregiver_profile', 'revoked', 'caregiver_flow',
         coalesce(nullif(payload->>'text_version',''), 'withdrawal')
  from caregivers where id = cg_id and profile_person_id is not null;

  insert into audit_log (actor, action, resource, resource_id, after)
  values ('caregiver', 'caregiver.withdraw', 'caregiver', cg_id::text,
          jsonb_build_object('consent_status', 'revoked'));

  return jsonb_build_object('persisted', true, 'caregiver_id', cg_id);
end $$;

-- ── Merging duplicate caregivers (2.5) ────────────────────────────────────

/**
 * { keep, merge: [ids], actor }
 *
 * The careful one. Two rules:
 *
 *  - **the survivor keeps the LOWEST visibility of the group.** Merging must never be a
 *    way to promote somebody: if one row is consented-and-active and another is only
 *    mentioned, the result is mentioned. Re-granting is the caregiver's act, not a
 *    side effect of admin housekeeping.
 *  - **nothing is deleted except the duplicate shell.** Nominations and their
 *    restricted notes move, so no parent's words are lost.
 */
create or replace function merge_caregivers(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  keep_id  uuid := (payload->>'keep')::uuid;
  actor    text := coalesce(nullif(payload->>'actor',''), 'workflow');
  merge_ids uuid[];
  moved    int := 0;
  before_row jsonb;
begin
  select array_agg((value #>> '{}')::uuid)
    into merge_ids
  from jsonb_array_elements(coalesce(payload->'merge', '[]'::jsonb));

  if keep_id is null or merge_ids is null or array_length(merge_ids, 1) is null then
    raise exception 'merge_caregivers: needs one to keep and at least one to fold in';
  end if;
  if keep_id = any(merge_ids) then
    raise exception 'merge_caregivers: the survivor cannot also be merged away';
  end if;

  select to_jsonb(c) into before_row from caregivers c where c.id = keep_id;
  if before_row is null then
    raise exception 'merge_caregivers: no caregiver %', keep_id;
  end if;

  update caregiver_nominations set caregiver_id = keep_id
   where caregiver_id = any(merge_ids);
  moved := coalesce((select count(*) from caregiver_nominations
                      where caregiver_id = keep_id), 0);

  -- Lowest visibility wins. `mentioned` < `invited` < `consented`, and a withdrawal
  -- anywhere in the group withdraws the survivor.
  update caregivers set
    consent_status = (
      select case
        when bool_or(c.consent_status in ('declined','revoked')) then 'revoked'
        when bool_and(c.consent_status = 'consented') then 'consented'
        when bool_or(c.consent_status = 'mentioned') then 'mentioned'
        else 'invited' end::consent_status
      from caregivers c where c.id = keep_id or c.id = any(merge_ids)),
    active       = (select bool_and(c.active) from caregivers c
                     where c.id = keep_id or c.id = any(merge_ids)),
    discoverable = (select bool_and(c.discoverable) from caregivers c
                     where c.id = keep_id or c.id = any(merge_ids)),
    introducible = (select bool_and(c.introducible) from caregivers c
                     where c.id = keep_id or c.id = any(merge_ids))
  where id = keep_id;

  delete from caregivers where id = any(merge_ids);

  insert into audit_log (actor, action, resource, resource_id, before, after)
  values (actor, 'caregiver.merge', 'caregiver', keep_id::text, before_row,
          jsonb_build_object('merged', to_jsonb(merge_ids), 'nominations', moved));

  return jsonb_build_object('persisted', true, 'caregiver_id', keep_id,
                            'nominations_moved', moved);
end $$;

-- ── Retiring a taxonomy option (2.6) ──────────────────────────────────────

/** { market_id, category, option_value, actor } — stops offering it, keeps history. */
create or replace function retire_market_option(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare actor text := coalesce(nullif(payload->>'actor',''), 'workflow');
begin
  -- Deactivated, never deleted: profiles already point at it, and a deleted option
  -- would silently rewrite what those parents said.
  update market_options set active = false
   where market_id = coalesce(nullif(payload->>'market_id',''), 'pasadena')
     and category = payload->>'category'
     and option_value = payload->>'option_value';

  insert into audit_log (actor, action, resource, resource_id, after)
  values (actor, 'option.retire', 'market_option', payload->>'option_value',
          jsonb_build_object('category', payload->>'category', 'active', false));

  return jsonb_build_object('persisted', true);
end $$;

-- ── Matching · the two-layer query (spec §7, §8) ──────────────────────────

/**
 * { person_id, topic?, age_band?, limit? } → ranked candidates to ask.
 *
 * Two layers, as the spec puts it: **social affinity × life relevance.**
 *
 *  - affinity is the sum of `affinity_weights` over shared edges, **resolved at query
 *    time** — the weight a parent's row was written with is deliberately ignored, so a
 *    weight change needs no backfill;
 *  - relevance is how many life dimensions overlap (budget, logistics, family setup,
 *    childcare, tenure);
 *  - a shared trust circle is a **rank multiplier, never a filter** — the client was
 *    explicit: Pando weighs these first and still finds the best available match.
 *
 * What it deliberately does not do: decide whether to actually message anybody. That is
 * `outreach_facts` plus the send layer, and it stays separate so a matching change can
 * never widen who gets texted.
 */
create or replace function match_candidates(payload jsonb)
returns table (
  person_id uuid,
  affinity_score int,
  relevance_overlap int,
  trust_circle_match boolean,
  rank numeric
)
language sql
stable
security definer
set search_path = public
as $$
  with asker as (
    select p.id, p.market_id from people p where p.id = (payload->>'person_id')::uuid
  ),
  shared_edges as (
    select b.person_id, sum(w.weight) as affinity
    from social_affinities a
    join asker on true
    join social_affinities b
      on b.affinity_type = a.affinity_type
     and b.affinity_value = a.affinity_value
     and b.person_id <> a.person_id
    join affinity_weights w on w.affinity_type = a.affinity_type
    where a.person_id = asker.id
    group by b.person_id
  ),
  shared_life as (
    select b.person_id, count(*) as overlap
    from life_relevance a
    join asker on true
    join life_relevance b
      on b.dimension = a.dimension and b.value = a.value and b.person_id <> a.person_id
    where a.person_id = asker.id
      and a.dimension <> 'trust_circle'
    group by b.person_id
  ),
  trust as (
    select b.person_id
    from life_relevance a
    join asker on true
    join life_relevance b
      on b.dimension = 'trust_circle' and b.value = a.value and b.person_id <> a.person_id
    where a.person_id = asker.id and a.dimension = 'trust_circle'
    group by b.person_id
  )
  select
    p.id,
    coalesce(e.affinity, 0)::int,
    coalesce(l.overlap, 0)::int,
    t.person_id is not null,
    /* The ranking. Trust circle is a 1.5× nudge, not a gate: a parent outside every
       circle still ranks if the overlap is there, which is what "always finds the best
       available match" means. */
    round(
      (coalesce(e.affinity, 0) + coalesce(l.overlap, 0) * 2)
      * case when t.person_id is not null then 1.5 else 1.0 end,
      2)
  from people p
  join asker on p.market_id = asker.market_id and p.id <> asker.id
  left join shared_edges e on e.person_id = p.id
  left join shared_life  l on l.person_id = p.id
  left join trust        t on t.person_id = p.id
  where not p.is_test
    -- Only people who can be asked at all: a verified phone and an allowance.
    and p.phone_verified_at is not null
    and (p.allowance_mode = 'as_relevant' or coalesce(p.monthly_contact_allowance, 0) >= 1)
    -- Topic, when the asker's question has one (P12).
    and (payload->>'topic' is null
         or payload->>'topic' = any(p.topic_preferences)
         or payload->>'topic' = any(p.topics_lived_experience))
    -- Age band, when it matters: someone who has lived that stage.
    and (payload->>'age_band' is null
         or exists (select 1 from social_affinities sa
                     where sa.person_id = p.id
                       and sa.affinity_type = 'age_range'
                       and sa.affinity_value = payload->>'age_band'))
    and (coalesce(e.affinity, 0) > 0 or coalesce(l.overlap, 0) > 0)
  order by 5 desc, 2 desc
  limit coalesce(nullif(payload->>'limit','')::int, 20)
$$;

revoke all on function apply_caregiver_profile(jsonb) from anon, authenticated;
revoke all on function withdraw_caregiver(jsonb)      from anon, authenticated;
revoke all on function merge_caregivers(jsonb)        from anon, authenticated;
revoke all on function retire_market_option(jsonb)    from anon, authenticated;
revoke all on function match_candidates(jsonb)        from anon, authenticated;

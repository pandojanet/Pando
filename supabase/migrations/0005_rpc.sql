-- ═══════════════════════════════════════════════════════════════════════════
-- Pando — 0005 RPC surface
--
-- Everything reachable over **HTTP**, so n8n needs no Postgres connection at all.
--
-- Why this exists: Supabase's direct database host is IPv6-only unless you buy the
-- IPv4 add-on, and plenty of VPSes are IPv4-only — so the Postgres node simply cannot
-- dial it. PostgREST, on the other hand, is a normal HTTPS endpoint. Every function in
-- `0003_write_ops.sql` already takes a single `payload jsonb`, which is exactly what
-- PostgREST's RPC calling convention wants:
--
--     POST https://<ref>.supabase.co/rest/v1/rpc/write_person
--     apikey: <service-role key>
--     { "payload": { … } }
--
-- The one thing missing was reads: the admin's queries were raw SQL inside n8n nodes.
-- This file turns them into one function, so the read side is an RPC call too.
--
-- Note what did *not* move: these are **projections**, not decisions. Which rows the
-- admin sees is a query; what to do about them is still an IF on the n8n canvas.
-- ═══════════════════════════════════════════════════════════════════════════

/**
 * { resource, params: { include_test?, nomination_id?, person_id? } }
 *
 * Returns the rows shaped exactly as `web/lib/admin/types.ts` expects — an object for
 * `overview`, `contributor` and `restricted_note`, an array for the lists — so no node
 * reshapes anything and no page reshapes anything either.
 */
create or replace function admin_read(payload jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  resource   text    := payload->>'resource';
  params     jsonb   := coalesce(payload->'params', '{}'::jsonb);
  with_test  boolean := coalesce((params->>'include_test')::boolean, false);
  result     jsonb;
begin
  if resource = 'overview' then
    select jsonb_build_object(
      'contributors', jsonb_build_object(
        'total',        (select count(*) from people where not is_test),
        'completed',    (select count(*) from people where not is_test and profile_completeness > 0),
        'with_two_plus',(select count(*) from founding_checklist where qualifying_approved >= 2)),
      'submissions', jsonb_build_object(
        'activities', (select count(*) from submissions where kind = 'activity' and not is_test),
        'caregivers', (select count(*) from submissions where kind = 'caregiver' and not is_test),
        'places',     (select count(*) from submissions where kind = 'place'    and not is_test),
        'tips',       (select count(*) from submissions where kind = 'tip'      and not is_test)),
      'consent', jsonb_build_object(
        'follow_up_opt_in', (select count(distinct person_id) from consents
                              where scope = 'follow_up' and status = 'opted_in'),
        'reference_willing', (select count(*) from caregiver_nominations
                               where reference_willing = 'yes' and not is_test)),
      'caregivers', jsonb_build_object(
        'mentioned', (select count(*) from caregivers where consent_status = 'mentioned' and not is_test),
        'invited',   (select count(*) from caregivers where consent_status = 'invited'   and not is_test),
        'consented', (select count(*) from caregivers where consent_status = 'consented' and not is_test),
        'declined',  (select count(*) from caregivers where consent_status = 'declined'  and not is_test)),
      'quality', jsonb_build_object(
        'low_confidence', (select count(*) from place_contributions
                            where confidence is not null and confidence < 0.6 and not is_test),
        'open_flags',     (select count(*) from flags where status = 'open'),
        'pending_options',(select count(*) from pending_options where status = 'pending'),
        'review_holds',   (select count(*) from caregiver_nominations
                            where review_hold and status = 'pending_review' and not is_test)),
      'founding', jsonb_build_object(
        'pending',  (select count(*) from people where founding = 'pending_founding' and not is_test),
        'approved', (select count(*) from people where founding = 'founding' and not is_test)),
      'demand', jsonb_build_object(
        'ordinary',     (select count(*) from demand_signals
                          where status = 'open' and sensitivity = 'ordinary' and not is_test),
        'peer_support', (select count(*) from demand_signals
                          where status = 'open' and sensitivity = 'peer_support' and not is_test),
        'high_stakes',  (select count(*) from demand_signals
                          where status = 'open' and sensitivity = 'high_stakes' and not is_test)),
      -- The funnel lives in PostHog; duplicating it here would be a second source of
      -- truth for the same number.
      'drop_off', '[]'::jsonb,
      'posthog_url', null
    ) into result;

  elsif resource = 'contributors' then
    select coalesce(jsonb_agg(r order by r->>'created_at' desc), '[]'::jsonb) into result
    from (
      select jsonb_build_object(
        'id', p.id,
        'name', nullif(concat_ws(' ', p.first_name, p.last_name), ''),
        'phone_masked', case when p.phone is null then null
                             else '••• ••• ' || right(p.phone, 4) end,
        'neighborhood', p.neighborhood,
        'child_birth_years', coalesce((select jsonb_agg(c.birth_year order by c.birth_year desc)
                                        from children c
                                        where c.person_id = p.id and c.birth_year is not null),
                                      '[]'::jsonb),
        'submissions', (select count(*) from submissions s where s.person_id = p.id),
        'qualifying_approved', coalesce(f.qualifying_approved, 0),
        'founding_status', p.founding,
        'follow_up_opt_in', (select cs.status = 'opted_in' from consents cs
                              where cs.person_id = p.id and cs.scope = 'follow_up'
                              order by cs.captured_at desc limit 1),
        'wants_founding', p.wants_founding,
        'is_test', p.is_test,
        'created_at', p.created_at
      ) as r
      from people p
      left join founding_checklist f on f.person_id = p.id
      where with_test or not p.is_test
    ) t;

  elsif resource = 'contributor' then
    select jsonb_build_object(
      'id', p.id,
      'name', nullif(concat_ws(' ', p.first_name, p.last_name), ''),
      'phone_masked', case when p.phone is null then null
                           else '••• ••• ' || right(p.phone, 4) end,
      'neighborhood', p.neighborhood,
      'child_birth_years', coalesce((select jsonb_agg(c.birth_year order by c.birth_year desc)
                                      from children c
                                      where c.person_id = p.id and c.birth_year is not null),
                                    '[]'::jsonb),
      'submissions', (select count(*) from submissions s where s.person_id = p.id),
      'qualifying_approved', coalesce(
        (select qualifying_approved from founding_checklist where person_id = p.id), 0),
      'founding_status', p.founding,
      'follow_up_opt_in', (select cs.status = 'opted_in' from consents cs
                            where cs.person_id = p.id and cs.scope = 'follow_up'
                            order by cs.captured_at desc limit 1),
      'wants_founding', p.wants_founding,
      'is_test', p.is_test,
      'created_at', p.created_at,
      'invite_code', p.invite_code,
      'source', p.source,
      'profile_completeness', p.profile_completeness,
      'time_in_area', p.time_in_area,
      'moved_from', p.moved_from,
      'attribution', p.attribution,
      'aggregate_display', p.aggregate_display,
      'monthly_contact_allowance', p.monthly_contact_allowance,
      'allowance_mode', p.allowance_mode,
      'topic_preferences', to_jsonb(coalesce(p.topic_preferences, '{}')),
      'topics_lived_experience', to_jsonb(coalesce(p.topics_lived_experience, '{}')),
      'school_status', coalesce((select jsonb_object_agg(ps.option_value, ps.status)
                                  from person_schools ps where ps.person_id = p.id),
                                '{}'::jsonb),
      'affinities', coalesce((select jsonb_agg(jsonb_build_object(
                                'affinity_type', sa.affinity_type,
                                'affinity_value', sa.affinity_value,
                                'weight', aw.weight))
                              from social_affinities sa
                              left join affinity_weights aw on aw.affinity_type = sa.affinity_type
                              where sa.person_id = p.id), '[]'::jsonb),
      'relevance', coalesce((select jsonb_agg(jsonb_build_object(
                               'dimension', lr.dimension, 'value', lr.value))
                             from life_relevance lr where lr.person_id = p.id), '[]'::jsonb),
      'cards', coalesce((select jsonb_agg(jsonb_build_object(
                            'id', s.id, 'kind', s.kind,
                            'title', coalesce(s.fields->>'name', s.fields->>'topic', 'Untitled'),
                            'status', coalesce(
                              (select pc.status::text from place_contributions pc
                                where pc.submission_id = s.id),
                              (select n.status::text from caregiver_nominations n
                                where n.submission_id = s.id),
                              'pending_review'),
                            'firsthand', coalesce(
                              (select pc.firsthand from place_contributions pc
                                where pc.submission_id = s.id),
                              (select n.worked_for_family from caregiver_nominations n
                                where n.submission_id = s.id),
                              true),
                            'created_at', s.received_at)
                          order by s.received_at desc)
                         from submissions s where s.person_id = p.id), '[]'::jsonb),
      'consents', coalesce((select jsonb_agg(jsonb_build_object(
                              'scope', cs.scope, 'status', cs.status,
                              'text_version', cs.text_version, 'captured_at', cs.captured_at)
                            order by cs.captured_at desc)
                           from consents cs where cs.person_id = p.id), '[]'::jsonb),
      'transcript', coalesce((select sc.messages from seed_conversations sc
                               where sc.person_id = p.id
                               order by sc.created_at desc limit 1), '[]'::jsonb),
      -- Admin notes live in the audit log: one append-only place, and they are already
      -- attributed to whoever wrote them.
      'notes', coalesce((select jsonb_agg(jsonb_build_object(
                            'id', a.id, 'author', a.actor,
                            'body', a.after->>'body', 'at', a.at)
                          order by a.at desc)
                         from audit_log a
                         where a.action = 'contributor.note'
                           and a.resource_id = p.id::text), '[]'::jsonb)
    ) into result
    from people p
    where p.id = (params->>'person_id')::uuid;

  elsif resource = 'contributions' then
    select coalesce(jsonb_agg(r order by r->>'created_at' desc), '[]'::jsonb) into result
    from (
      select jsonb_build_object(
        'id', pc.id, 'kind', pl.kind,
        'place', jsonb_build_object(
          'id', pl.id, 'name', pl.name, 'venue', pl.venue,
          'neighborhoods', to_jsonb(coalesce(pl.neighborhoods, '{}')),
          'age_bands', to_jsonb(coalesce(pl.age_bands, '{}')),
          'freshness_state', pl.freshness_state,
          'last_confirmed_at', pl.last_confirmed_at,
          'validated_count', pl.validated_count),
        'firsthand', pc.firsthand,
        'child_age_at_time', to_jsonb(coalesce(pc.child_age_at_time, '{}')),
        'last_there', pc.last_there, 'how_much', pc.how_much,
        'recommendation', pc.recommendation,
        'what_makes_it_great', pc.what_makes_it_great,
        'caveat', pc.caveat, 'caveat_answered', pc.caveat_answered,
        'who_for', pc.who_for, 'who_not_for', pc.who_not_for,
        'price_band', pc.price_band, 'price_unit', pc.price_unit,
        'worth_it', pc.worth_it, 'follow_up_ok', pc.follow_up_ok,
        'tip_text', pc.tip_text, 'status', pc.status,
        'confidence', pc.confidence, 'provenance', pl.provenance,
        'contributor', case when pc.person_id is null then null else jsonb_build_object(
          'id', pc.person_id,
          'name', (select nullif(concat_ws(' ', p.first_name, p.last_name), '')
                    from people p where p.id = pc.person_id)) end,
        'is_test', pc.is_test, 'created_at', pc.created_at
      ) as r
      from place_contributions pc
      join places pl on pl.id = pc.place_id
      where with_test or not pc.is_test
    ) t;

  elsif resource = 'caregivers' then
    select coalesce(jsonb_agg(to_jsonb(v) order by v.created_at desc), '[]'::jsonb) into result
    from admin_caregiver_rows v
    where with_test or not v.is_test;

  elsif resource = 'restricted_note' then
    -- One at a time, on request. A list view carrying these would leak them into every
    -- screenshot and every cache (invariant 12).
    select to_jsonb(r) into result
    from restricted_notes r
    where r.nomination_id = (params->>'nomination_id')::uuid
    order by r.created_at desc
    limit 1;

  elsif resource = 'duplicates' then
    select coalesce(jsonb_agg(r), '[]'::jsonb) into result
    from (
      select jsonb_build_object(
        'key', lower(a.first_name) || '-' || coalesce(lower(a.last_initial::text), ''),
        'score', round(similarity(lower(a.first_name), lower(b.first_name))::numeric, 2),
        'reason', to_jsonb(array_remove(array[
          case when lower(a.first_name) = lower(b.first_name)
                 and coalesce(a.last_initial, ' ') = coalesce(b.last_initial, ' ')
               then 'same first name + initial' end,
          case when a.market_id = b.market_id then 'same market' end,
          case when exists (select 1 from caregiver_nominations na
                             join caregiver_nominations nb on nb.caregiver_id = b.id
                             where na.caregiver_id = a.id
                               and na.cared_for_ages && nb.cared_for_ages)
               then 'overlapping ages' end], null)),
        'members', jsonb_build_array(
          jsonb_build_object('id', a.id, 'first_name', a.first_name,
            'last_initial', a.last_initial, 'type',
            (select care_type from caregiver_nominations where caregiver_id = a.id limit 1),
            'neighborhood', null),
          jsonb_build_object('id', b.id, 'first_name', b.first_name,
            'last_initial', b.last_initial, 'type',
            (select care_type from caregiver_nominations where caregiver_id = b.id limit 1),
            'neighborhood', null))
      ) as r
      from caregivers a
      join caregivers b on b.id > a.id
        and b.market_id = a.market_id
        and similarity(lower(a.first_name), lower(b.first_name)) > 0.7
      where not a.is_test and not b.is_test
    ) t;

  elsif resource = 'options' then
    select coalesce(jsonb_agg(r order by r->>'created_at' desc), '[]'::jsonb) into result
    from (
      select jsonb_build_object(
        'id', po.id, 'market_id', po.market_id, 'category', po.category,
        'submitted_value', po.submitted_value,
        'submitted_by', case when po.submitted_by is null then null else jsonb_build_object(
          'id', po.submitted_by,
          'name', (select nullif(concat_ws(' ', p.first_name, p.last_name), '')
                    from people p where p.id = po.submitted_by)) end,
        'occurrences', po.occurrences, 'status', po.status, 'created_at', po.created_at
      ) as r
      from pending_options po
    ) t;

  elsif resource = 'flags' then
    select coalesce(jsonb_agg(r order by r->>'created_at' desc), '[]'::jsonb) into result
    from (
      select jsonb_build_object(
        'id', fl.id, 'severity', fl.severity, 'reason', fl.reason,
        'excerpt', coalesce(fl.excerpt, ''), 'field', fl.field,
        'subject', case when fl.subject_id is null then null else jsonb_build_object(
          'kind', fl.subject_kind, 'id', fl.subject_id, 'title', fl.reason) end,
        'contributor', case when fl.person_id is null then null else jsonb_build_object(
          'id', fl.person_id,
          'name', (select nullif(concat_ws(' ', p.first_name, p.last_name), '')
                    from people p where p.id = fl.person_id)) end,
        'status', fl.status, 'confidence', fl.confidence, 'created_at', fl.created_at
      ) as r
      from flags fl
    ) t;

  elsif resource = 'demand' then
    select coalesce(jsonb_agg(r order by r->>'created_at' desc), '[]'::jsonb) into result
    from (
      select jsonb_build_object(
        'id', d.id, 'question_text', d.question_text, 'category', d.category,
        'sensitivity', d.sensitivity, 'requires_human_review', d.requires_human_review,
        'status', d.status,
        'contributor', case when d.person_id is null then null else jsonb_build_object(
          'id', d.person_id,
          'name', (select nullif(concat_ws(' ', p.first_name, p.last_name), '')
                    from people p where p.id = d.person_id)) end,
        'is_test', d.is_test, 'created_at', d.created_at
      ) as r
      from demand_signals d
      where with_test or not d.is_test
    ) t;

  elsif resource = 'founding' then
    select coalesce(jsonb_agg(r order by r->>'created_at' desc), '[]'::jsonb) into result
    from (
      select jsonb_build_object(
        'id', p.id,
        'name', nullif(concat_ws(' ', p.first_name, p.last_name), ''),
        'phone_masked', case when p.phone is null then null
                             else '••• ••• ' || right(p.phone, 4) end,
        'neighborhood', p.neighborhood,
        'child_birth_years', coalesce((select jsonb_agg(c.birth_year order by c.birth_year desc)
                                        from children c
                                        where c.person_id = p.id and c.birth_year is not null),
                                      '[]'::jsonb),
        'school', (select ps.option_value from person_schools ps
                    where ps.person_id = p.id and ps.status = 'current' limit 1),
        'invited_by', null,
        'arrived_via', p.invited_via_group,
        'submissions', jsonb_build_object(
          'activities', (select count(*) from submissions s
                          where s.person_id = p.id and s.kind = 'activity'),
          'caregivers', (select count(*) from submissions s
                          where s.person_id = p.id and s.kind = 'caregiver'),
          'places',     (select count(*) from submissions s
                          where s.person_id = p.id and s.kind = 'place'),
          'tips',       (select count(*) from submissions s
                          where s.person_id = p.id and s.kind = 'tip')),
        'checklist', jsonb_build_object(
          'verified', f.verified, 'has_neighborhood', f.has_neighborhood,
          'has_children', f.has_children, 'allowance_ok', f.allowance_ok,
          'qualifying_approved', f.qualifying_approved,
          'caregiver_approved', f.caregiver_approved),
        'status', p.founding, 'created_at', p.created_at
      ) as r
      from people p
      join founding_checklist f on f.person_id = p.id
      where p.founding in ('pending_founding', 'request_invite')
        and (with_test or not p.is_test)
    ) t;

  elsif resource = 'audit' then
    select coalesce(jsonb_agg(r order by r->>'at' desc), '[]'::jsonb) into result
    from (
      select jsonb_build_object(
        'id', a.id, 'at', a.at, 'user', a.actor, 'action', a.action,
        'resource', a.resource, 'resource_id', a.resource_id,
        'before', a.before, 'after', a.after
      ) as r
      from audit_log a
      order by a.at desc
      limit 200
    ) t;

  else
    -- An unknown resource is a bug in the caller, not an empty list. Saying so beats
    -- rendering a blank page that looks like "no data yet".
    raise exception 'admin_read: unknown resource %', resource;
  end if;

  return coalesce(result, 'null'::jsonb);
end $$;

/**
 * The seed writes, bundled so the browser's three flush calls are three RPC calls and
 * nothing has to be composed in a node. Each one is still the decision-free write from
 * `0003_write_ops.sql`; this only saves a round trip.
 *
 * { person: {...}, pending_options: [...] }
 */
create or replace function seed_profile(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  pid    uuid;
  market text;
  opt    jsonb;
  queued int := 0;
begin
  pid := write_person(coalesce(payload->'person', payload));
  market := coalesce(payload->'person'->>'market_id', payload->>'market_id', 'pasadena');

  /* A loop, not a `where write_pending_option(...) is not null`: Postgres gives no
     guarantee about evaluating a side-effecting function once per row, or at all. */
  for opt in
    select value from jsonb_array_elements(coalesce(payload->'pending_options', '[]'::jsonb))
  loop
    if coalesce(opt->>'submitted_value', '') <> '' then
      perform write_pending_option(jsonb_build_object(
        'market_id', market,
        'category', opt->>'category',
        'submitted_value', opt->>'submitted_value',
        'person_id', pid));
      queued := queued + 1;
    end if;
  end loop;

  return jsonb_build_object('persisted', true, 'person_id', pid,
                            'pending_options', queued);
end $$;

-- ── The reads the cron and check workflows need ───────────────────────────
--
-- These were raw SQL inside n8n nodes, which the Postgres node could run but PostgREST
-- cannot. They are projections, not decisions — the branching stays on the canvas.

/** { person_id } — the Founding criteria as facts, for the IF that follows. */
create or replace function founding_checklist_for(payload jsonb)
returns jsonb
language sql stable security definer set search_path = public as $$
  select to_jsonb(f) from founding_checklist f
  where f.person_id = (payload->>'person_id')::uuid
$$;

/** { limit } — contributions the extraction engine hasn't scored yet (1.8).
    Restricted notes are deliberately absent: free text about a named person never
    reaches a model (invariant 8). */
create or replace function contributions_needing_extraction(payload jsonb)
returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(r), '[]'::jsonb) from (
    select jsonb_build_object(
      'id', pc.id,
      'name', pl.name,
      'kind', pl.kind,
      'what_makes_it_great', pc.what_makes_it_great,
      'caveat', pc.caveat,
      'who_for', pc.who_for,
      'who_not_for', pc.who_not_for
    ) as r
    from place_contributions pc
    join places pl on pl.id = pc.place_id
    where pc.status = 'pending_review' and pc.confidence is null and not pc.is_test
    limit coalesce(nullif(payload->>'limit','')::int, 20)
  ) t
$$;

/** No arguments used — the 1.9 rules, each row already shaped as the flag it wants.
    Deliberately blunt: a false positive costs one admin glance, a false negative costs
    a parent. */
create or replace function flag_rules(payload jsonb)
returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(r), '[]'::jsonb) from (
    select jsonb_build_object(
      'severity', 'review', 'reason', 'stale_at_capture',
      'subject_kind', 'place_contribution', 'subject_id', pc.id,
      'person_id', pc.person_id, 'excerpt', null) as r
    from place_contributions pc
    join places pl on pl.id = pc.place_id
    join freshness_policy fp on fp.kind = pl.kind
    where pc.status = 'pending_review' and not pc.is_test
      and coalesce(pl.last_confirmed_at, pl.created_at)
          < now() - (fp.stale_days || ' days')::interval

    union all
    /* A capitalised word that is not a known option — the only net for D1's fourth
       row, a complaint about a named person filed as ordinary. */
    select jsonb_build_object(
      'severity', 'review', 'reason', 'possible_named_person',
      'subject_kind', 'place_contribution', 'subject_id', pc.id,
      'person_id', pc.person_id, 'excerpt', substring(pc.caveat for 120))
    from place_contributions pc
    where pc.status = 'pending_review' and not pc.is_test
      and pc.caveat ~ '\m[A-Z][a-z]{2,}\M'
      and not exists (select 1 from market_options mo
                       where lower(mo.label) = lower(pc.caveat))

    union all
    select jsonb_build_object(
      'severity', 'note', 'reason', 'volume_spike',
      'subject_kind', 'person', 'subject_id', s.person_id,
      'person_id', s.person_id, 'excerpt', null)
    from submissions s
    where s.received_at > now() - interval '1 hour' and s.person_id is not null
    group by s.person_id
    having count(*) >= 5
  ) t
  where payload is not null
$$;

/** { flags: [ … ] } — write each flag unless the same rule is already open on the same
    subject. Without this, a rule firing every 15 minutes makes 96 identical rows. */
create or replace function write_flags_if_new(payload jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  f       jsonb;
  written int := 0;
begin
  for f in select value from jsonb_array_elements(coalesce(payload->'flags', '[]'::jsonb))
  loop
    if not exists (
      select 1 from flags x
      where x.reason = f->>'reason'
        and x.subject_id = nullif(f->>'subject_id','')::uuid
        and x.status = 'open'
    ) then
      perform write_flag(f);
      written := written + 1;
    end if;
  end loop;

  return jsonb_build_object('written', written);
end $$;

-- ── Who may call what ─────────────────────────────────────────────────────
--
-- PostgREST executes RPC as the role in the key. n8n holds the **service-role** key,
-- which bypasses RLS, so nothing extra is needed for it to work. What matters is the
-- other direction: `anon` and `authenticated` must not be able to call any of this.

do $$
declare fn text;
begin
  for fn in
    select p.oid::regprocedure::text
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'admin_read','seed_profile','write_person','write_submission','write_place',
        'write_place_contribution','write_caregiver','write_caregiver_nomination',
        'write_consent','write_pending_option','write_demand_signal','write_flag',
        'write_credit','write_message_log','write_audit','write_contributor_note',
        'set_allowance','set_caregiver_consent','set_caregiver_visibility',
        'set_contribution_status','set_nomination_status','set_place_status',
        'set_founding','set_demand_status','set_contribution_confidence',
        'set_option_status','set_opt_out','clear_opt_out','set_aggregate_display',
        'promote_option','resolve_flag','release_nomination_hold','edit_contribution',
        'place_candidates','caregiver_candidates','person_by_phone',
        'founding_checklist_for','contributions_needing_extraction',
        'flag_rules','write_flags_if_new')
  loop
    execute format('revoke all on function %s from anon, authenticated', fn);
  end loop;
end $$;

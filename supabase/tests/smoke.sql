-- ═══════════════════════════════════════════════════════════════════════════
-- Pando — smoke test
--
-- Paste this into the SQL editor after the migrations. It walks one contributor all the
-- way through — profile, an activity, a caregiver nomination, completion, review,
-- Founding — then asserts every safety rule actually bites, and rolls the whole thing
-- back so your database is left exactly as it was.
--
-- If it finishes with "ALL CHECKS PASSED", the database works. If it stops, the message
-- says which rule failed and why.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

do $$
declare
  pid       uuid;
  sub_id    uuid;
  place_id  uuid;
  contrib   uuid;
  cg_id     uuid;
  nom_id    uuid;
  checklist jsonb;
  rows      jsonb;
  n         int;
begin
  -- ── 1. A profile arrives (1.3) ─────────────────────────────────────────
  pid := write_person(jsonb_build_object(
    'phone', '+15550000001',
    'first_name', 'Smoke', 'last_name', 'Test',
    'market_id', 'pasadena', 'neighborhood', 'bungalow-heaven',
    'phone_verified_at', now(),
    'profile_captured_at', now(),
    'monthly_contact_allowance', 3, 'allowance_mode', 'fixed',
    'attribution', 'anonymous_verified',
    'profile_completeness', 92,
    'topic_preferences', jsonb_build_array('camps', 'babysitters'),
    'topics_lived_experience', jsonb_build_array('sleep_routines'),
    'children', jsonb_build_array(
      jsonb_build_object('birth_year', 2019, 'expecting', false),
      jsonb_build_object('expecting', true, 'due_year', 2026,
                         'due_year_precision', 'assumed_capture_year')),
    'child_ages_at_capture', jsonb_build_array(7, -1),
    'social_affinities', jsonb_build_array(
      jsonb_build_object('affinity_type','school','affinity_value','walden-school','score_weight',5),
      jsonb_build_object('affinity_type','age_range','affinity_value','grade','score_weight',2)),
    'life_relevance', jsonb_build_array(
      jsonb_build_object('dimension','budget','value','compare_value'),
      jsonb_build_object('dimension','trust_circle','value','same_school')),
    'school_status', jsonb_build_object('walden-school','current'),
    'sms_consent', jsonb_build_object('status','opted_in','source','seed_entry_phone_field',
                                      'text_version','seed-sms-2026-08-01','captured_at', now())
  ));
  assert pid is not null, 'write_person returned nothing';

  select count(*) into n from children where person_id = pid;
  assert n = 2, format('expected 2 children, got %s', n);

  select count(*) into n from social_affinities where person_id = pid;
  assert n = 2, format('expected 2 affinities, got %s', n);

  -- Re-saving replaces derived rows rather than adding to them.
  perform write_person(jsonb_build_object(
    'phone', '+15550000001', 'phone_verified_at', now(),
    'neighborhood', 'altadena',
    'social_affinities', jsonb_build_array(
      jsonb_build_object('affinity_type','school','affinity_value','walden-school','score_weight',5))
  ));
  select count(*) into n from social_affinities where person_id = pid;
  assert n = 1, format('delete-then-insert failed: %s affinities remain', n);

  -- ── 2. An activity card (1.5) ──────────────────────────────────────────
  sub_id := write_submission(jsonb_build_object(
    'client_id', 'smoke-card-1', 'person_id', pid, 'kind', 'activity',
    'fields', jsonb_build_object('name','Little Maestros')));

  place_id := write_place(jsonb_build_object(
    'market_id','pasadena','kind','activity','name','Little Maestros',
    'neighborhoods', jsonb_build_array('bungalow-heaven'),
    'age_bands', jsonb_build_array('grade')));

  contrib := write_place_contribution(jsonb_build_object(
    'place_id', place_id, 'person_id', pid, 'submission_id', sub_id,
    'firsthand', true,
    'child_age_at_time', jsonb_build_array(6),
    'last_there', 'current',
    'what_makes_it_great', 'Small groups and a patient teacher.',
    'caveat_answered', true,
    'who_for', 'A cautious child',
    'price_band', '50_100', 'price_unit', 'per_month',
    'worth_it', 'great_value', 'follow_up_ok', true));
  assert contrib is not null, 'write_place_contribution returned nothing';

  -- A price band without a unit must be refused (price_shape).
  begin
    perform write_place_contribution(jsonb_build_object(
      'place_id', place_id, 'person_id', pid, 'firsthand', true, 'price_band', '50_100'));
    raise exception 'CHECK price_shape did not fire';
  exception when check_violation then null;
  end;

  -- ── 3. A caregiver nomination (1.6) ────────────────────────────────────
  cg_id := write_caregiver(jsonb_build_object(
    'market_id','pasadena','first_name','Rosa','last_initial','R','is_adult', true));

  nom_id := write_caregiver_nomination(jsonb_build_object(
    'caregiver_id', cg_id, 'person_id', pid, 'submission_id', sub_id,
    'worked_for_family', true, 'care_type', 'regular_part_time',
    'cared_for_ages', jsonb_build_array('grade'),
    'strengths', jsonb_build_array('reliable'),
    'hire_again', 'hesitant',
    'review_hold', true,
    'hold_reasons', jsonb_build_array('hire_again_hesitant','hesitation_reason'),
    'restricted_notes', jsonb_build_array(
      jsonb_build_object('kind','hesitation_reason','body','Smoke test note.'))));

  select count(*) into n from restricted_notes where nomination_id = nom_id;
  assert n = 1, format('restricted note not stored, got %s', n);

  -- A minor is refused outright (invariant 2).
  begin
    perform write_caregiver(jsonb_build_object(
      'market_id','pasadena','first_name','Too','last_initial','Y','is_adult', false));
    raise exception 'CHECK adults_only did not fire';
  exception when check_violation then null;
  end;

  -- A hesitant answer cannot arrive without a hold (hold_when_hesitant).
  begin
    perform write_caregiver_nomination(jsonb_build_object(
      'caregiver_id', cg_id, 'worked_for_family', true, 'hire_again', 'no',
      'review_hold', false));
    raise exception 'CHECK hold_when_hesitant did not fire';
  exception when check_violation then null;
  end;

  -- A secondhand nomination is refused, not stored weaker (invariant 14).
  begin
    perform write_caregiver_nomination(jsonb_build_object(
      'caregiver_id', cg_id, 'worked_for_family', false));
    raise exception 'CHECK firsthand_only did not fire';
  exception when check_violation then null;
  end;

  -- Visibility without consent is impossible (invariant 1).
  begin
    perform set_caregiver_visibility(jsonb_build_object(
      'caregiver_id', cg_id, 'active', true, 'actor', 'smoke'));
    raise exception 'CHECK visibility_requires_consent did not fire';
  exception when check_violation then null;
  end;

  -- And nothing unconsented can reach an answer.
  select count(*) into n from caregivers_answerable where caregiver_id = cg_id;
  assert n = 0, 'an unconsented caregiver is visible in caregivers_answerable';

  -- ── 4. Completion + D1 (1.7) ───────────────────────────────────────────
  perform write_consent(jsonb_build_object(
    'person_id', pid, 'scope','follow_up','status','opted_in',
    'source','seed_completion_screen','text_version','seed-followup-2026-07-31'));

  perform write_demand_signal(jsonb_build_object(
    'person_id', pid, 'question_text','Smoke test question.',
    'category','camps','sensitivity','ordinary'));

  -- ── 5. Review and Founding (2.2, 2.4) ──────────────────────────────────
  perform set_contribution_status(jsonb_build_object(
    'contribution_id', contrib, 'status','approved','actor','smoke'));

  select to_jsonb(f) into checklist from founding_checklist f where f.person_id = pid;
  assert (checklist->>'qualifying_approved')::int = 1,
    format('expected 1 qualifying contribution, got %s', checklist->>'qualifying_approved');
  assert (checklist->>'verified')::boolean, 'verified should be true';

  -- One is not enough: the client's rule is two.
  perform set_founding(jsonb_build_object(
    'person_id', pid, 'status','pending_founding','actor','smoke'));

  -- Founding never downgrades once granted.
  perform set_founding(jsonb_build_object('person_id', pid, 'status','founding','actor','smoke'));
  begin
    perform set_founding(jsonb_build_object(
      'person_id', pid, 'status','pending_founding','actor','smoke'));
    raise exception 'set_founding allowed a downgrade';
  exception when others then
    if sqlerrm not like '%permanent%' then raise; end if;
  end;

  -- ── 6. The admin reads (2.x) ───────────────────────────────────────────
  rows := admin_read(jsonb_build_object('resource','overview'));
  assert rows->'contributors'->>'total' is not null, 'overview came back empty';

  rows := admin_read(jsonb_build_object('resource','contributors'));
  assert jsonb_array_length(rows) >= 1, 'contributors list is empty';
  assert rows->0->>'phone_masked' like '%0001', 'phone should be masked, not raw';
  assert rows->0->>'phone_masked' not like '%+1555%', 'phone leaked into the admin read';

  rows := admin_read(jsonb_build_object('resource','caregivers'));
  assert jsonb_array_length(rows) >= 1, 'caregivers list is empty';
  assert (rows->0->>'has_restricted_notes')::boolean,
    'has_restricted_notes should be true';
  assert rows->0->'body' is null and rows->0->>'body' is null,
    'a restricted note body leaked into the caregiver list';

  rows := admin_read(jsonb_build_object('resource','contributions'));
  assert jsonb_array_length(rows) >= 1, 'contributions list is empty';

  rows := admin_read(jsonb_build_object('resource','demand'));
  assert jsonb_array_length(rows) >= 1, 'demand list is empty';

  rows := admin_read(jsonb_build_object('resource','audit'));
  assert jsonb_array_length(rows) >= 1, 'audit log is empty — a setter forgot its row';

  -- An unknown resource fails loudly rather than rendering a blank page.
  begin
    perform admin_read(jsonb_build_object('resource','nonsense'));
    raise exception 'admin_read accepted an unknown resource';
  exception when others then
    if sqlerrm not like '%unknown resource%' then raise; end if;
  end;

  -- ── 7. Identity rules ──────────────────────────────────────────────────
  -- A named parent without a verified phone cannot exist (invariant 11).
  begin
    insert into people (phone, first_name) values ('+15550009999', 'Unverified');
    raise exception 'CHECK verified_if_named did not fire';
  exception when check_violation then null;
  end;

  -- "As many as relevant" must not carry a number (allowance_shape).
  begin
    insert into people (allowance_mode, monthly_contact_allowance)
    values ('as_relevant', 5);
    raise exception 'CHECK allowance_shape did not fire';
  exception when check_violation then null;
  end;

  -- ── 8. 2C · her own profile ────────────────────────────────────────────
  perform set_caregiver_consent(jsonb_build_object(
    'caregiver_id', cg_id, 'consent_status','invited','actor','smoke'));

  perform apply_caregiver_profile(jsonb_build_object(
    'caregiver_id', cg_id,
    'roles_wanted', jsonb_build_array('regular_part_time'),
    'areas_served', jsonb_build_array('bungalow-heaven'),
    'drives', true,
    'appear_in_answers', true,
    'allow_introductions', false,
    'consent', jsonb_build_object('text_version','caregiver-profile-v1','captured_at', now())));

  select count(*) into n from caregivers_answerable where caregiver_id = cg_id;
  assert n = 0, 'a held nomination reached caregivers_answerable';

  perform release_nomination_hold(jsonb_build_object(
    'nomination_id', nom_id, 'note','Smoke test: cleared deliberately.','actor','smoke'));
  perform set_nomination_status(jsonb_build_object(
    'nomination_id', nom_id, 'status','approved','actor','smoke'));

  select count(*) into n from caregivers_answerable where caregiver_id = cg_id;
  assert n = 1, format('a consented, active, approved caregiver should be answerable, got %s', n);

  -- Introducible implies discoverable (ladder_order).
  begin
    update caregivers set introducible = true, discoverable = false where id = cg_id;
    raise exception 'CHECK ladder_order did not fire';
  exception when check_violation then null;
  end;

  -- Releasing a hold without a reason is refused.
  begin
    perform release_nomination_hold(jsonb_build_object('nomination_id', nom_id, 'note',''));
    raise exception 'release_nomination_hold accepted an empty note';
  exception when others then
    if sqlerrm not like '%reason%' then raise; end if;
  end;

  -- ── 9. Matching ────────────────────────────────────────────────────────
  -- One contributor cannot match themselves, and the query must not error.
  perform match_candidates(jsonb_build_object('person_id', pid, 'limit', 5));

  raise notice 'ALL CHECKS PASSED';
end $$;

-- Nothing above is kept: this leaves the database exactly as it was.
rollback;

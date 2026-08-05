-- ═══════════════════════════════════════════════════════════════════════════
-- Pando — 0002 views
--
-- The read paths. Every query that could reach a parent goes through a view here,
-- never through a base table, because that is where invariants 1, 3 and 4 are
-- enforceable "at the query level" as the spec requires.
-- ═══════════════════════════════════════════════════════════════════════════

-- Invariant 1: a caregiver appears in a user-facing answer only if
-- consent_status = 'consented' AND active. Plus: the nomination must be approved
-- and not held. Matching, SMS answers and exports all read this — never
-- `caregivers`.
create view caregivers_answerable as
select
  c.id            as caregiver_id,
  c.market_id,
  c.first_name,
  c.last_initial,
  n.id            as nomination_id,
  n.care_type,
  n.cared_for_ages,
  n.strengths,
  n.good_fit_for,
  n.caveat,
  n.last_worked,
  n.pay_band,
  n.pay_benchmark_consent,
  c.discoverable,
  c.introducible
from caregivers c
join caregiver_nominations n on n.caregiver_id = c.id
where c.consent_status = 'consented'
  and c.active
  and not c.is_test
  and n.status = 'approved'
  and not n.review_hold;

-- Invariants 3 and 4: the label reads the *source*, never who typed it, and
-- "vouched by a parent" needs firsthand experience *and* a real contributor
-- behind it. No query may compose its own label.
create view contribution_labels as
select
  pc.id as contribution_id,
  case
    when pc.firsthand and pc.person_id is not null then 'vouched_by_a_parent'
    when not pc.firsthand                          then 'shared_secondhand'
    else 'public_information'
  end as label
from place_contributions pc;

-- What an answer may say about a place: approved firsthand contributions only,
-- with the freshness the spec wants attached.
create view places_answerable as
select
  p.id as place_id,
  p.market_id,
  p.kind,
  p.name,
  p.venue,
  p.neighborhoods,
  p.age_bands,
  p.freshness_state,
  p.last_confirmed_at,
  count(pc.id) filter (where pc.firsthand)     as firsthand_count,
  count(pc.id) filter (where not pc.firsthand) as secondhand_count
from places p
join place_contributions pc on pc.place_id = p.id
where p.status = 'approved'
  and pc.status = 'approved'
  and not p.is_test
group by p.id;

-- The admin caregiver list. Says *whether* restricted notes exist; the bodies are
-- fetched by their own resource call, so a list view cannot leak them
-- (invariant 12).
create view admin_caregiver_rows as
select distinct on (c.id)
  c.id,
  c.first_name,
  c.last_initial,
  c.consent_status,
  c.active,
  c.discoverable,
  c.introducible,
  c.consent_evidence,
  c.provenance,
  c.is_test,
  c.created_at,
  n.care_type                        as type,
  n.cared_for_ages                   as good_with_bands,
  n.reference_willing                as contributor_reference_opt_in,
  n.caveat,
  n.review_hold,
  n.hold_reasons,
  n.invite_sent_by_parent,
  n.status                           as nomination_status,
  exists (select 1 from restricted_notes r where r.nomination_id = n.id)
                                     as has_restricted_notes,
  (select count(*) from caregiver_nominations x where x.caregiver_id = c.id)
                                     as nominations
from caregivers c
left join caregiver_nominations n on n.caregiver_id = c.id
-- The newest nomination represents the caregiver in the list; the rest are behind
-- the count and the detail view.
order by c.id, n.created_at desc nulls last;

-- The Founding checklist, per person, so the admin sees *why* somebody is or is
-- not eligible rather than a bare submission count (estimate 2.2 / D3).
create view founding_checklist as
select
  p.id as person_id,
  p.founding,
  p.phone_verified_at is not null                                     as verified,
  p.neighborhood is not null                                          as has_neighborhood,
  exists (select 1 from children c where c.person_id = p.id)          as has_children,
  coalesce(p.monthly_contact_allowance >= 3, p.allowance_mode = 'as_relevant')
                                                                      as allowance_ok,
  (select count(*) from place_contributions pc
     where pc.person_id = p.id
       and pc.status = 'approved'
       and pc.firsthand
       and coalesce(array_length(pc.child_age_at_time, 1), 0) > 0
       and pc.last_there is not null
       and pc.what_makes_it_great is not null
       and (pc.who_for is not null or pc.who_not_for is not null)
       and pc.caveat_answered)                                        as qualifying_approved,
  (select count(*) from caregiver_nominations n
     where n.person_id = p.id and n.status = 'approved' and not n.review_hold)
                                                                      as caregiver_approved
from people p
where not p.is_test;

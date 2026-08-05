-- ═══════════════════════════════════════════════════════════════════════════
-- Pando — 0007 flagging at capture
--
-- Correcting a timing mistake in 0005, without moving any rule into SQL.
--
-- The 1.9 rules were all on a 15-minute cron. That is wrong for the ones that describe
-- a single card:
--
--   A parent writes a caveat naming somebody. An admin opens the review queue two
--   minutes later and approves it. The flag arrives thirteen minutes after the
--   decision it existed to inform.
--
-- Invariant 8 says free text about a named person is never published without human
-- review, and a flag that can arrive after approval doesn't deliver that. So those
-- rules move to **capture time** — but they move onto the n8n canvas as IF nodes in the
-- card-save workflow, not into a function here. The rules are business logic and stay
-- where they can be read and changed.
--
-- This file only does what a database has to: hand the workflow the *facts* those IFs
-- need, and stop claiming the moved rules.
-- ═══════════════════════════════════════════════════════════════════════════

/**
 * `place_candidates`, now carrying freshness.
 *
 * The save workflow needs to know whether the place it is attaching to has already
 * drifted past its category's threshold — otherwise "was this stale when she wrote
 * it?" can only be answered later, by a cron, which is the thing being fixed.
 *
 * { market_id, kind, name }
 */
create or replace function place_candidates(payload jsonb)
returns table (
  id uuid,
  name text,
  venue text,
  score real,
  exact_match boolean,
  freshness_state text,
  last_confirmed_at timestamptz,
  days_since_confirmed int,
  stale_days int,
  is_stale boolean
)
language sql stable security definer set search_path = public as $$
  select
    p.id, p.name, p.venue,
    similarity(lower(p.name), lower(payload->>'name')) as score,
    lower(p.name) = lower(payload->>'name')            as exact_match,
    p.freshness_state,
    p.last_confirmed_at,
    extract(day from now() - coalesce(p.last_confirmed_at, p.created_at))::int
      as days_since_confirmed,
    fp.stale_days,
    coalesce(p.last_confirmed_at, p.created_at) < now() - (fp.stale_days || ' days')::interval
      as is_stale
  from places p
  left join freshness_policy fp on fp.kind = p.kind
  where p.market_id = coalesce(nullif(payload->>'market_id',''),'pasadena')
    and p.kind = (payload->>'kind')::share_kind
    and (lower(p.name) = lower(payload->>'name')
         or similarity(lower(p.name), lower(payload->>'name')) > 0.5)
  order by exact_match desc, score desc
  limit 5
$$;

/**
 * What is left for the cron: rules that cannot be decided from one card, because they
 * are about a **window** of time or activity.
 *
 * `stale_at_capture` and `possible_named_person` are gone from here — they are now IF
 * nodes in the card-save workflow, and leaving copies would mean two places to change
 * one rule, which is how the two drift apart.
 */
create or replace function flag_rules(payload jsonb)
returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(r), '[]'::jsonb) from (
    -- Five cards in an hour from one person. Not necessarily wrong — an enthusiastic
    -- founding parent looks exactly like this — but worth a glance.
    select jsonb_build_object(
      'severity', 'note', 'reason', 'volume_spike',
      'subject_kind', 'person', 'subject_id', s.person_id,
      'person_id', s.person_id, 'excerpt', null) as r
    from submissions s
    where s.received_at > now() - interval '1 hour' and s.person_id is not null
    group by s.person_id
    having count(*) >= 5

    union all
    -- A place that drifted past its threshold *after* it was approved. This one
    -- genuinely needs time to pass, which is what a cron is for.
    select jsonb_build_object(
      'severity', 'review', 'reason', 'went_stale',
      'subject_kind', 'place', 'subject_id', pl.id,
      'person_id', null, 'excerpt', pl.name)
    from places pl
    join freshness_policy fp on fp.kind = pl.kind
    where pl.status = 'approved' and not pl.is_test
      and coalesce(pl.last_confirmed_at, pl.created_at)
          < now() - (fp.stale_days || ' days')::interval
  ) t
  where payload is not null
$$;

/**
 * One flag, written only if the same rule isn't already open on the same subject.
 *
 * The guard is here rather than on the canvas for one reason: it is not a decision, it
 * is idempotency. A retried save, or a card corrected twice, must not multiply the
 * admin's queue.
 *
 * { severity, reason, subject_kind, subject_id, person_id, field, excerpt }
 */
create or replace function write_flag_if_new(payload jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare new_id uuid;
begin
  if exists (
    select 1 from flags f
    where f.reason = payload->>'reason'
      and f.subject_id = nullif(payload->>'subject_id','')::uuid
      and f.status = 'open'
  ) then
    return jsonb_build_object('written', false, 'reason', 'already_open');
  end if;

  new_id := write_flag(payload);
  return jsonb_build_object('written', true, 'flag_id', new_id);
end $$;

revoke all on function write_flag_if_new(jsonb) from anon, authenticated;

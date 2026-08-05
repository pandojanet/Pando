-- ═══════════════════════════════════════════════════════════════════════════
-- Pando — 0004 row level security
--
-- The posture is simple and deliberate: **nothing is readable by anon or
-- authenticated.** RLS is enabled on every table with no policies, which in
-- Postgres means "deny". Only Supabase's `service_role` — which bypasses RLS —
-- can read or write, and the only holder of that key is n8n.
--
-- Why this is right for Pando rather than lazy: the Next.js app has no Supabase
-- client at all (see CLAUDE.md, "Working model"). The browser talks to our route
-- handlers, the routes forward to n8n, and n8n owns the database credentials. A
-- table that anon could read would be a hole with no legitimate user.
--
-- When the caregiver's own flow (2C) or a future logged-in surface needs direct
-- access, add narrow policies here — starting from deny, one table at a time, and
-- never on `restricted_notes`.
-- ═══════════════════════════════════════════════════════════════════════════

alter table people                  enable row level security;
alter table consents                enable row level security;
alter table sms_opt_outs            enable row level security;
alter table children                enable row level security;
alter table social_affinities       enable row level security;
alter table life_relevance          enable row level security;
alter table affinity_weights        enable row level security;
alter table person_schools          enable row level security;
alter table market_options          enable row level security;
alter table pending_options         enable row level security;
alter table submissions             enable row level security;
alter table places                  enable row level security;
alter table place_contributions     enable row level security;
alter table caregivers              enable row level security;
alter table caregiver_nominations   enable row level security;
alter table restricted_notes        enable row level security;
alter table caregiver_profiles      enable row level security;
alter table flags                   enable row level security;
alter table demand_signals          enable row level security;
alter table audit_log               enable row level security;
alter table message_log             enable row level security;
alter table freshness_policy        enable row level security;
alter table referrals               enable row level security;
alter table credits                 enable row level security;
alter table seed_conversations      enable row level security;

-- `force row level security` on restricted_notes is deliberately NOT used. It would
-- apply RLS to the table owner as well, and the write functions in 0003 are
-- SECURITY DEFINER — they execute as the owner. Whether that still works then
-- depends on the owner keeping BYPASSRLS, which is a hosting detail nobody should
-- have to remember at 11pm when caregiver saves start failing. Enabled RLS with no
-- policies plus the REVOKE below denies anon and authenticated just as completely.

-- Belt and braces on the two tables where a leak is a product-level bug, in case
-- someone later adds a permissive policy by habit (invariants 12, 13).
revoke all on restricted_notes from anon, authenticated;
revoke all on audit_log        from anon, authenticated;

-- market_options is the one table that is genuinely public data (the tap lists).
-- It stays closed anyway: the app gets it from n8n or from its own placeholder
-- file, so opening it would add an attack surface for zero benefit. Documented
-- here so the omission reads as a decision, not an oversight.

-- ── Sanity checks the migration itself asserts ────────────────────────────
-- These fail the migration if the invariants were written wrongly, which is worth
-- more than a comment claiming they hold.

do $$
begin
  -- A caregiver cannot be active without consent (invariant 1).
  begin
    insert into caregivers (market_id, first_name, is_adult, active, consent_status)
    values ('__test__', 'Check', true, true, 'mentioned');
    raise exception 'RLS/constraint check failed: active without consent was allowed';
  exception when check_violation then null;
  end;

  -- A minor cannot be stored at all (invariant 2).
  begin
    insert into caregivers (market_id, first_name, is_adult)
    values ('__test__', 'Check', false);
    raise exception 'constraint check failed: a minor was allowed';
  exception when check_violation then null;
  end;

  -- A named parent cannot exist without a verification timestamp (invariant 11).
  begin
    insert into people (phone, first_name) values ('+15550000000', 'Check');
    raise exception 'constraint check failed: unverified named parent was allowed';
  exception when check_violation then null;
  end;

  delete from caregivers where market_id = '__test__';
end $$;

-- Row level security.
--
-- The posture is unchanged from when n8n held the credentials, but the *reason*
-- is now sharper. This app connects to Postgres directly, as a role that
-- bypasses RLS — so none of this is what protects our own queries. What it
-- protects against is the other door: a Supabase project always exposes
-- PostgREST publicly with an `anon` key, and a table without RLS is readable by
-- anyone who has that key. Every table below would be a hole with no legitimate
-- user behind it.
--
-- Enabled with no policies is Postgres for "deny". When the caregiver's own flow
-- (2C) or a future logged-in surface needs direct access, add narrow policies
-- here — one table at a time, and never on `restricted_notes`.

ALTER TABLE people                ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE consents              ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE sms_opt_outs          ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE children              ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE social_affinities     ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE life_relevance        ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE affinity_weights      ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE person_schools        ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE market_options        ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE pending_options       ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE submissions           ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE places                ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE place_contributions   ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE caregivers            ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE caregiver_nominations ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE restricted_notes      ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE caregiver_profiles    ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE flags                 ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE demand_signals        ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE audit_log             ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE message_log           ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE freshness_policy      ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE referrals             ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE credits               ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE seed_conversations    ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

-- Belt and braces on the two tables where a leak is a product-level bug, in case
-- someone later adds a permissive policy by habit (invariants 12, 13).
REVOKE ALL ON restricted_notes FROM anon, authenticated;--> statement-breakpoint
REVOKE ALL ON audit_log        FROM anon, authenticated;--> statement-breakpoint

-- market_options is the one table that is genuinely public data (the tap lists).
-- It stays closed anyway: the app reads it over its own connection, so opening it
-- would add attack surface for zero benefit. Documented here so the omission
-- reads as a decision, not an oversight.

-- ── Checks the migration asserts about itself ──────────────────────────────
-- These fail the migration if an invariant was written wrongly, which is worth
-- more than a comment claiming it holds. `force row level security` is
-- deliberately NOT used: it would apply RLS to the table owner too, and whether
-- that still works depends on the owner keeping BYPASSRLS — a hosting detail
-- nobody should have to remember at 11pm when caregiver saves start failing.

DO $$
DECLARE
  v_place uuid;
  v_caregiver uuid;
BEGIN
  -- invariant 1 — a caregiver cannot be visible without consent.
  BEGIN
    INSERT INTO caregivers (market_id, first_name, is_adult, active, consent_status)
    VALUES ('__test__', 'Check', true, true, 'mentioned');
    RAISE EXCEPTION 'CHECK visibility_requires_consent did not fire';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- invariant 2 — a minor cannot be stored at all, not even as pending.
  BEGIN
    INSERT INTO caregivers (market_id, first_name, is_adult)
    VALUES ('__test__', 'Check', false);
    RAISE EXCEPTION 'CHECK adults_only did not fire';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- The ladder only ever climbs in order.
  BEGIN
    INSERT INTO caregivers (market_id, first_name, is_adult, consent_status,
                            consent_evidence, discoverable, introducible)
    VALUES ('__test__', 'Check', true, 'consented', '{"method":"test"}'::jsonb,
            false, true);
    RAISE EXCEPTION 'CHECK ladder_order did not fire';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- invariant 11 — nothing about a named parent before verification.
  BEGIN
    INSERT INTO people (phone, first_name) VALUES ('+15550000000', 'Check');
    RAISE EXCEPTION 'CHECK verified_if_named did not fire';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- P14 — 'as_relevant' carries no number, and a fixed cap is one of 1/3/5.
  BEGIN
    INSERT INTO people (market_id, allowance_mode, monthly_contact_allowance)
    VALUES ('__test__', 'as_relevant', 3);
    RAISE EXCEPTION 'CHECK allowance_shape did not fire';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- A price band without a unit is unusable: $100/month <> $100/term.
  INSERT INTO places (market_id, kind, name)
  VALUES ('__test__', 'activity', 'Check') RETURNING id INTO v_place;
  BEGIN
    INSERT INTO place_contributions (place_id, firsthand, price_band)
    VALUES (v_place, true, '50_100');
    RAISE EXCEPTION 'CHECK price_shape did not fire';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  INSERT INTO caregivers (market_id, first_name, is_adult)
  VALUES ('__test__', 'Check', true) RETURNING id INTO v_caregiver;

  -- invariant 14 — a secondhand nomination is refused, not stored weaker.
  BEGIN
    INSERT INTO caregiver_nominations (caregiver_id, worked_for_family)
    VALUES (v_caregiver, false);
    RAISE EXCEPTION 'CHECK firsthand_only did not fire';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- Anything short of a clear yes cannot be released automatically.
  BEGIN
    INSERT INTO caregiver_nominations (caregiver_id, worked_for_family, hire_again,
                                       review_hold)
    VALUES (v_caregiver, true, 'hesitant', false);
    RAISE EXCEPTION 'CHECK hold_when_hesitant did not fire';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  DELETE FROM caregivers WHERE market_id = '__test__';
  DELETE FROM places     WHERE market_id = '__test__';
  DELETE FROM people     WHERE market_id = '__test__';
END $$;

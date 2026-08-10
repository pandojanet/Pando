-- Everything the Drizzle schema cannot express, kept in one place so it is
-- obvious what lives outside `lib/db/schema.ts`.
--
-- Two kinds of thing:
--   1. the updated_at triggers — drizzle-kit generates no triggers at all, and
--      without these `updated_at` silently stops tracking anything;
--   2. the read views — invariants 1, 3 and 4 are enforceable "at the query
--      level" only if every user-facing read goes through a view rather than a
--      base table, which is the whole reason they exist.
--
-- Ported verbatim from supabase/migrations/0001_schema.sql §8 and 0002_views.sql.

-- ── updated_at ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;
--> statement-breakpoint

DROP TRIGGER IF EXISTS people_touch ON people;--> statement-breakpoint
CREATE TRIGGER people_touch BEFORE UPDATE ON people
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();--> statement-breakpoint

DROP TRIGGER IF EXISTS places_touch ON places;--> statement-breakpoint
CREATE TRIGGER places_touch BEFORE UPDATE ON places
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();--> statement-breakpoint

DROP TRIGGER IF EXISTS caregivers_touch ON caregivers;--> statement-breakpoint
CREATE TRIGGER caregivers_touch BEFORE UPDATE ON caregivers
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();--> statement-breakpoint

DROP TRIGGER IF EXISTS cg_profiles_touch ON caregiver_profiles;--> statement-breakpoint
CREATE TRIGGER cg_profiles_touch BEFORE UPDATE ON caregiver_profiles
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();--> statement-breakpoint

-- ── Read views ─────────────────────────────────────────────────────────────

-- Invariant 1: a caregiver appears in a user-facing answer only if
-- consent_status = 'consented' AND active. Plus: the nomination must be approved
-- and not held. Matching, SMS answers and exports all read this — never
-- `caregivers`.
CREATE OR REPLACE VIEW caregivers_answerable AS
SELECT
  c.id            AS caregiver_id,
  c.market_id,
  c.first_name,
  c.last_initial,
  n.id            AS nomination_id,
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
FROM caregivers c
JOIN caregiver_nominations n ON n.caregiver_id = c.id
WHERE c.consent_status = 'consented'
  AND c.active
  AND NOT c.is_test
  AND n.status = 'approved'
  AND NOT n.review_hold;--> statement-breakpoint

-- Invariants 3 and 4: the label reads the *source*, never who typed it, and
-- "vouched by a parent" needs firsthand experience *and* a real contributor
-- behind it. No query may compose its own label.
CREATE OR REPLACE VIEW contribution_labels AS
SELECT
  pc.id AS contribution_id,
  CASE
    WHEN pc.firsthand AND pc.person_id IS NOT NULL THEN 'vouched_by_a_parent'
    WHEN NOT pc.firsthand                          THEN 'shared_secondhand'
    ELSE 'public_information'
  END AS label
FROM place_contributions pc;--> statement-breakpoint

-- What an answer may say about a place: approved firsthand contributions only,
-- with the freshness the spec wants attached.
CREATE OR REPLACE VIEW places_answerable AS
SELECT
  p.id AS place_id,
  p.market_id,
  p.kind,
  p.name,
  p.venue,
  p.neighborhoods,
  p.age_bands,
  p.freshness_state,
  p.last_confirmed_at,
  count(pc.id) FILTER (WHERE pc.firsthand)     AS firsthand_count,
  count(pc.id) FILTER (WHERE NOT pc.firsthand) AS secondhand_count
FROM places p
JOIN place_contributions pc ON pc.place_id = p.id
WHERE p.status = 'approved'
  AND pc.status = 'approved'
  AND NOT p.is_test
GROUP BY p.id;--> statement-breakpoint

-- The admin caregiver list. Says *whether* restricted notes exist; the bodies are
-- fetched by their own resource call, so a list view cannot leak them
-- (invariant 12).
CREATE OR REPLACE VIEW admin_caregiver_rows AS
SELECT DISTINCT ON (c.id)
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
  n.care_type                        AS type,
  n.cared_for_ages                   AS good_with_bands,
  n.reference_willing                AS contributor_reference_opt_in,
  n.caveat,
  n.review_hold,
  n.hold_reasons,
  n.invite_sent_by_parent,
  n.status                           AS nomination_status,
  EXISTS (SELECT 1 FROM restricted_notes r WHERE r.nomination_id = n.id)
                                     AS has_restricted_notes,
  (SELECT count(*) FROM caregiver_nominations x WHERE x.caregiver_id = c.id)
                                     AS nominations
FROM caregivers c
LEFT JOIN caregiver_nominations n ON n.caregiver_id = c.id
-- The newest nomination represents the caregiver in the list; the rest are behind
-- the count and the detail view.
ORDER BY c.id, n.created_at DESC NULLS LAST;--> statement-breakpoint

-- The Founding checklist, per person, so the admin sees *why* somebody is or is
-- not eligible rather than a bare submission count (estimate 2.2 / D3).
CREATE OR REPLACE VIEW founding_checklist AS
SELECT
  p.id AS person_id,
  p.founding,
  p.phone_verified_at IS NOT NULL                                     AS verified,
  p.neighborhood IS NOT NULL                                          AS has_neighborhood,
  EXISTS (SELECT 1 FROM children c WHERE c.person_id = p.id)          AS has_children,
  coalesce(p.monthly_contact_allowance >= 3, p.allowance_mode = 'as_relevant')
                                                                      AS allowance_ok,
  (SELECT count(*) FROM place_contributions pc
     WHERE pc.person_id = p.id
       AND pc.status = 'approved'
       AND pc.firsthand
       AND coalesce(array_length(pc.child_age_at_time, 1), 0) > 0
       AND pc.last_there IS NOT NULL
       AND pc.what_makes_it_great IS NOT NULL
       AND (pc.who_for IS NOT NULL OR pc.who_not_for IS NOT NULL)
       AND pc.caveat_answered)                                        AS qualifying_approved,
  (SELECT count(*) FROM caregiver_nominations n
     WHERE n.person_id = p.id AND n.status = 'approved' AND NOT n.review_hold)
                                                                      AS caregiver_approved
FROM people p
WHERE NOT p.is_test;

-- The Founding queue stops asking "is this parent from the group" and starts
-- asking "has this parent earned the badge and the reward" (developer, 16 Sep).
--
-- The old question died on 7 Sep, when entry opened and parents began arriving
-- directly: measured on the live cohort, ten of twelve have no invite at all,
-- so "is this really Sarah from our parent group" had nothing left to check.
-- Every parent who finished the flow was written to `pending_founding` by the
-- completion route, so the queue was a list of everyone rather than a list of
-- anyone owed a decision.
--
-- Two facts are needed to ask the new question, and neither existed.

-- ── 1. How full the profile actually is ──────────────────────────────────────
--
-- ⚠⚠ `profile_completeness` could not be reused and must not be changed. It
-- counts the screens a parent can *see*, so somebody who tapped Continue at the
-- optional fork scores **100%** on two answers — as a gate it passes exactly
-- the profiles it exists to catch. It is also read by the admin on rows written
-- months ago, so changing its formula would rewrite history.
--
-- This is `profileDepth`: the same questionnaire measured as if the optional
-- fork had been opened. `derive.ts` writes it beside the other one, from
-- answers the server has already sanitised (the 11 Aug rule — the graph is
-- derived here, never taken from the request body).
--
-- ⚠ It defaults to 0 rather than to anything friendlier, because 0 is the
-- honest answer for a row nobody has measured yet: `npm run depth:backfill`
-- computes it from `raw_answers`, and `seed:demo` sets it for the demo cohort,
-- which has no stored answers to compute from.
ALTER TABLE people ADD COLUMN IF NOT EXISTS profile_depth integer NOT NULL DEFAULT 0;--> statement-breakpoint

ALTER TABLE people DROP CONSTRAINT IF EXISTS profile_depth_range;--> statement-breakpoint
ALTER TABLE people ADD CONSTRAINT profile_depth_range
  CHECK (profile_depth BETWEEN 0 AND 100);--> statement-breakpoint

-- ── 2. What an admin has actually approved ───────────────────────────────────
--
-- `founding_checklist` already counted contributions, and under a much stricter
-- rule than the one the developer asked for: `qualifying_approved` demands six
-- fields, and **four of them went behind the optional fork on 10 Sep** (the
-- caveat, who-for, who-not-for, and the child's age at the time). So a card
-- captured by today's flow frequently cannot satisfy it, and gating Founding on
-- it would have made the badge unreachable through the product's own shortest
-- path. Measured: 14 of 19 approved contributions clear all six, and every one
-- of those 14 predates the fork.
--
-- ⚠ `qualifying_approved` is **kept, not replaced**. The contributors table and
-- the funnel both read it, and it is still the better answer to a different
-- question — "how complete is this record" rather than "did somebody approve
-- it". What changed is only which of the two decides the badge.
--
-- ⚠ A caregiver nomination on `review_hold` is not counted, exactly as before:
-- a hold is a reviewer saying a person still has to look (invariant 12), and a
-- held nomination paying out $10 would be that judgement spent in reverse.
--
-- DROP first, rather than CREATE OR REPLACE: Postgres refuses to replace a view
-- whose column list changes anywhere but the end (42P16 — "cannot change name
-- of view column"), and the two new columns belong beside the counts they are
-- read with rather than appended after `longest_reason`. Nothing else in the
-- schema depends on this view — only application queries — so no CASCADE,
-- which means a future dependent makes this fail loudly instead of silently
-- taking something down with it.
DROP VIEW IF EXISTS founding_checklist;--> statement-breakpoint

CREATE VIEW founding_checklist AS
SELECT
  p.id AS person_id,
  p.founding,
  p.phone_verified_at IS NOT NULL                                     AS verified,
  p.neighborhood IS NOT NULL                                          AS has_neighborhood,
  EXISTS (SELECT 1 FROM children c WHERE c.person_id = p.id)          AS has_children,
  coalesce(p.monthly_contact_allowance >= 3, p.allowance_mode = 'as_relevant')
                                                                      AS allowance_ok,
  p.profile_depth                                                     AS profile_depth,
  (SELECT count(*) FROM share_contributions sc
     WHERE sc.person_id = p.id
       AND sc.status = 'approved'
       AND sc.firsthand
       AND coalesce(array_length(sc.child_age_at_time, 1), 0) > 0
       AND sc.last_there IS NOT NULL
       AND sc.what_makes_it_great IS NOT NULL
       AND (sc.who_for IS NOT NULL OR sc.who_not_for IS NOT NULL)
       AND sc.caveat_answered)                                        AS qualifying_approved,
  (SELECT count(*) FROM caregiver_nominations n
     WHERE n.person_id = p.id AND n.status = 'approved' AND NOT n.review_hold)
                                                                      AS caregiver_approved,
  -- The developer's rule: the admin pressed Add to Pando, on anything.
  (SELECT count(*) FROM share_contributions sc
     WHERE sc.person_id = p.id AND sc.status = 'approved' AND NOT sc.is_test)
  + (SELECT count(*) FROM caregiver_nominations n
     WHERE n.person_id = p.id AND n.status = 'approved'
       AND NOT n.review_hold AND NOT n.is_test)                       AS approved_contributions,
  -- The longest reason they have written on any non-test contribution, as a
  -- length rather than the sentence: her "a reason included" condition needs a
  -- number, and a parent's own words have no business travelling to a list view.
  --
  -- ⚠ The **longest**, never the newest — a parent whose second card is thin
  -- has still met the condition with their first.
  coalesce((SELECT max(length(btrim(sc.what_makes_it_great)))
     FROM share_contributions sc
     WHERE sc.person_id = p.id AND NOT sc.is_test), 0)                AS longest_reason
FROM people p
WHERE NOT p.is_test;

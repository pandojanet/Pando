-- `places` was the wrong word, and it had been wrong since 0000.
--
-- The table holds four kinds of thing (`share_kind`): an activity, a camp, a place
-- and a tip. Calling a music class "a place" is odd; calling a piece of advice "a
-- place" is simply false, and the whole point of that table is that one *subject*
-- carries many parents' contributions about it. The structure was right and the
-- name was not.
--
-- `shares` is the word this codebase already used everywhere else: the enum is
-- `share_kind`, the parent-facing copy is "what you shared", and the admin talks
-- about contributions to a share. **Not to be confused with `submissions`**, which
-- is the raw card exactly as it was typed, kept for "did the parent actually say
-- that". A submission is an event; a share is the thing it is about.
--
-- Renames only — no data is rewritten, no column changes type, and every view and
-- foreign key follows automatically because Postgres tracks them by identity
-- rather than by name. What does *not* follow automatically is the names of
-- constraints, indexes, triggers and view output columns, so those are done by
-- hand below; leaving them would mean a `shares` table whose errors mention
-- `places`, which is how a rename becomes a lie six months later.
ALTER TABLE places RENAME TO shares;--> statement-breakpoint
ALTER TABLE place_contributions RENAME TO share_contributions;--> statement-breakpoint
ALTER TABLE share_contributions RENAME COLUMN place_id TO share_id;--> statement-breakpoint

-- Constraints. The names appear in error messages and in `lib/db/schema.ts`, and
-- the two have to agree or the next generated migration tries to "fix" it.
ALTER TABLE shares RENAME CONSTRAINT places_kind_check TO shares_kind_check;--> statement-breakpoint
ALTER TABLE shares RENAME CONSTRAINT places_confidence_check TO shares_confidence_check;--> statement-breakpoint
ALTER TABLE shares RENAME CONSTRAINT places_freshness_state_check TO shares_freshness_state_check;--> statement-breakpoint
ALTER TABLE shares RENAME CONSTRAINT places_answer_ready_check TO shares_answer_ready_check;--> statement-breakpoint
ALTER TABLE share_contributions RENAME CONSTRAINT place_contributions_confidence_check TO share_contributions_confidence_check;--> statement-breakpoint
ALTER TABLE share_contributions RENAME CONSTRAINT place_contributions_place_id_submission_id_key TO share_contributions_share_id_submission_id_key;--> statement-breakpoint

-- Indexes.
ALTER INDEX places_market_idx RENAME TO shares_market_idx;--> statement-breakpoint
ALTER INDEX places_name_trgm_idx RENAME TO shares_name_trgm_idx;--> statement-breakpoint
ALTER INDEX place_contributions_place_idx RENAME TO share_contributions_share_idx;--> statement-breakpoint
ALTER INDEX place_contributions_person_idx RENAME TO share_contributions_person_idx;--> statement-breakpoint
ALTER INDEX place_contributions_review_idx RENAME TO share_contributions_review_idx;--> statement-breakpoint

-- The touch trigger, which fires on every update of the subject row.
ALTER TRIGGER places_touch ON shares RENAME TO shares_touch;--> statement-breakpoint

-- Flags point at their subject by a *name*, not a foreign key (a flag can be about
-- a contribution, a share or a demand signal), so those strings are data and have
-- to be migrated with everything else. Left alone, the admin would resolve
-- `subject_kind = 'place'` against a table that no longer exists.
UPDATE flags SET subject_kind = 'share' WHERE subject_kind = 'place';--> statement-breakpoint
UPDATE flags SET subject_kind = 'share_contribution' WHERE subject_kind = 'place_contribution';--> statement-breakpoint
UPDATE flags SET reason = 'possible_duplicate_share' WHERE reason = 'possible_duplicate_place';--> statement-breakpoint

-- `places_answerable` has to be dropped and recreated rather than replaced: its
-- output column `place_id` is being renamed too, and CREATE OR REPLACE VIEW
-- refuses to rename a column. Nothing reads it yet — it is the Phase 2 answer
-- path — so this is free to do now and would not be later.
DROP VIEW IF EXISTS places_answerable;--> statement-breakpoint

CREATE VIEW shares_answerable AS
SELECT
  s.id AS share_id,
  s.market_id,
  s.kind,
  s.name,
  s.venue,
  s.neighborhoods,
  s.age_bands,
  s.freshness_state,
  s.last_confirmed_at,
  count(sc.id) FILTER (WHERE sc.firsthand)     AS firsthand_count,
  count(sc.id) FILTER (WHERE NOT sc.firsthand) AS secondhand_count
FROM shares s
JOIN share_contributions sc ON sc.share_id = s.id
WHERE s.status = 'approved'
  AND sc.status = 'approved'
  AND NOT s.is_test
GROUP BY s.id;

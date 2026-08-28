-- The taxonomy stops being a chip list and becomes a searchable directory.
--
-- Estimate 1.13 assumed Janet would hand over four columns (market_id, category,
-- option_value, active) and the questionnaire would render them as chips. The
-- 24 Aug master list is a different thing: ~390 schools, plus activities, clubs
-- and faith communities, each carrying aliases, a city, an entity type, an
-- operational status and a curated starter flag. Her instruction for all four
-- categories is the same sentence — "tap first, search second" — which a fixed
-- chip list cannot do at 390 rows.
--
-- Three fields deliberately overlap and must not be collapsed into one:
--
--   active   may this option be SELECTED at all. A closed school is still
--            selectable, because a parent's stored answer resolves against this
--            table and a former pupil's record must not become unreadable.
--   status   the operational nuance behind that: active / paused / closed /
--            unverified. Her rule: only 'active' may be PROMOTED as a starter;
--            everything else stays searchable.
--   starter  curated into the 8-12 tap-first set for this area.
--
-- So a starter chip is shown when active AND status = 'active' AND starter, and
-- search covers everything with active = true. Folding these together loses
-- either the history or the curation.

ALTER TABLE market_options
  -- Search tolerance: "Poly" -> Polytechnic, "LCHS" -> La Canada High School,
  -- "CPG" -> Coach Patty's Gymnastics. Without these, search only matches what a
  -- parent already knows the full official name of.
  ADD COLUMN IF NOT EXISTS aliases text[] NOT NULL DEFAULT '{}',
  -- The city or area. Ranking only, never an eligibility filter: her closing note
  -- on all four sheets is that Pasadena/SGV families routinely cross city lines
  -- for school, classes, clubs and worship.
  ADD COLUMN IF NOT EXISTS area text,
  -- "K-12 school" / "Preschool" / "Activity provider" / "Private golf club" /
  -- "Church". Metadata, not the displayed identity — the canonical name is what a
  -- parent taps.
  ADD COLUMN IF NOT EXISTS entity_type text,
  -- Clubs only: the two visible groups she asked for inside one question —
  -- "Private, recreational & social clubs" and "Service leagues & member
  -- organizations". Both are shared circles; they are not the same kind of thing.
  ADD COLUMN IF NOT EXISTS section text,
  ADD COLUMN IF NOT EXISTS starter boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS source_url text,
  ADD COLUMN IF NOT EXISTS last_verified_at date,
  -- Which rows a human typed rather than the importer. Her data-maintenance note
  -- on every sheet: a periodic refresh from the CDE directory or Community Care
  -- Licensing must not silently drop what an admin added by hand.
  ADD COLUMN IF NOT EXISTS user_added boolean NOT NULL DEFAULT false;--> statement-breakpoint

ALTER TABLE market_options
  ADD CONSTRAINT market_options_status_check
  CHECK (status IN ('active', 'paused', 'closed', 'unverified'));--> statement-breakpoint

-- A starter must be a live record. Enforced here rather than left to the query,
-- because "only Active records may appear in starter suggestions" is her rule in
-- four places and a stale starter is the one error a parent sees first.
ALTER TABLE market_options
  ADD CONSTRAINT market_options_starter_is_active
  CHECK (NOT starter OR (active AND status = 'active'));--> statement-breakpoint

-- The starter read: one index per market+category, already filtered.
CREATE INDEX IF NOT EXISTS market_options_starter_idx
  ON market_options (market_id, category, area)
  WHERE starter AND active AND status = 'active';--> statement-breakpoint

-- Search. `pg_trgm` gives the partial and misspelled matches ("conservatry",
-- "polytecnic") that a prefix index cannot.
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint

-- On `label` alone, deliberately.
--
-- The obvious index is over label *and* the joined aliases, and Postgres refuses
-- it: `array_to_string` is STABLE rather than IMMUTABLE, because it depends on
-- the element type's output function, and only an immutable expression can be
-- indexed. The two ways around that are a denormalised `aliases_text` column
-- kept in sync by every writer, or scanning the array. At this size the scan is
-- the right answer: the whole table is under a thousand rows, so
-- `exists (select 1 from unnest(aliases) a where a ilike …)` costs nothing
-- measurable, and a second copy of the aliases is a second thing to get wrong.
--
-- Revisit only if this table grows by an order of magnitude — and then with a
-- generated column, not a trigger.
CREATE INDEX IF NOT EXISTS market_options_label_trgm_idx
  ON market_options USING gin (label gin_trgm_ops)
  WHERE active;--> statement-breakpoint

-- Exact alias hits ("LCHS", "CPG") go through the array directly.
CREATE INDEX IF NOT EXISTS market_options_aliases_idx
  ON market_options USING gin (aliases)
  WHERE active;--> statement-breakpoint

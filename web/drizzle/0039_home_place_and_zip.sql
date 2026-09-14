-- Where a parent lives, as a place and a ZIP (client §5, 9 Sep).
--
-- Her storage note, verbatim: *"place_id, display_name, place_type
-- (incorporated city / unincorporated community / LA neighborhood),
-- selected_zip, zip_recorded_at, self_asserted = true. No precise home
-- address."*
--
-- ## Two of her six fields are deliberately not columns
--
-- `display_name` and `place_type` are properties of the **place**, not of the
-- parent, and `lib/home-places.ts` is where a place's properties live. Copying
-- them onto every person is the second-copy-that-goes-stale fault this schema
-- already records paying for twice (`shares.confidence`, and the age band
-- `matching.ts` recomputes rather than reads). A respelling would then be true
-- on the list and false on 350 rows.
--
-- `self_asserted` would be `true` on every row this app can ever write: there
-- is no other source, because Pando asks the parent and has no address to
-- verify against. A column that cannot vary records nothing and invites a
-- future reader to look for the rows where it is false.
--
-- ## Why `place_id` *is* a column, when `neighborhood` plus `area_slug` implies it
--
-- Those two do resolve to a city today, and that is exactly why this is not
-- derivation: `market_options.area_slug` is **editable taxonomy** (12 Aug, an
-- admin owns that table), while this is a fact recorded at the moment a parent
-- answered. Her own note says the two are stored "separately" and gives the
-- reason in the sentence above it — *"ZIPs don't follow city lines exactly"*.
-- The demand number §5 exists to produce must keep meaning the place it meant
-- when it was captured, and a re-parented district would silently rewrite
-- history the admin reads to decide where Pando opens next.
--
-- ⚠ `neighborhood` is untouched and stays the finer answer. Ten of the twenty
-- values live contributors are stored under are Pasadena districts, and the
-- developer's call was that the district layer stays: *"райони залиш, то
-- стосується міст"*. So a Bungalow Heaven parent keeps Bungalow Heaven, and
-- gains `place_id = 'pasadena'` beside it.
--
-- ## Nullable, all three, and not backfilled
--
-- Every parent stored before today answered a question that did not ask for a
-- ZIP. Inventing one from their neighborhood would be the app asserting a
-- five-digit fact nobody stated — and on a shared ZIP it would be a guess
-- between three places. Null means "not asked", which is true, and the
-- combobox fills it from the next answer onward.

ALTER TABLE "people"
  ADD COLUMN IF NOT EXISTS "place_id" text,
  ADD COLUMN IF NOT EXISTS "selected_zip" text,
  ADD COLUMN IF NOT EXISTS "zip_recorded_at" timestamptz;

-- Five digits or nothing. ZIP+4 is truncated before it reaches here
-- (`normaliseZip`), because the +4 is a delivery route and storing one would be
-- a sharper location than her own "no precise home address" line allows.
ALTER TABLE "people"
  DROP CONSTRAINT IF EXISTS "people_selected_zip_shape";
ALTER TABLE "people"
  ADD CONSTRAINT "people_selected_zip_shape"
  CHECK ("selected_zip" IS NULL OR "selected_zip" ~ '^[0-9]{5}$');

-- A ZIP without the moment it was given cannot be aged, and §5 is the input to
-- a decision about where to launch next — so a stale answer has to be tellable
-- from a fresh one. The pair moves together or not at all.
ALTER TABLE "people"
  DROP CONSTRAINT IF EXISTS "people_zip_recorded_together";
ALTER TABLE "people"
  ADD CONSTRAINT "people_zip_recorded_together"
  CHECK (("selected_zip" IS NULL) = ("zip_recorded_at" IS NULL));

-- The one query the admin's demand view runs: how many parents per ZIP, and
-- per place. Partial, because the rows that matter are the ones that answered.
CREATE INDEX IF NOT EXISTS "people_zip_demand_idx"
  ON "people" ("selected_zip")
  WHERE "selected_zip" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "people_place_idx"
  ON "people" ("place_id")
  WHERE "place_id" IS NOT NULL;

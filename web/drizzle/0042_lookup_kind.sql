-- One cache, two Google APIs: what kind of question was asked.
--
-- `geocode_cache` was keyed on (market, query) because there was one lookup —
-- the Geocoding API, resolving a town, a neighborhood or a ZIP. 16 Sep added
-- the second: the Places API (`places:searchText`), which is what can answer
-- "Field Elementary" or "The Little Gym" at all, because a geocoder asked for
-- a named establishment returns a street or nothing.
--
-- ⚠ They cannot share a key. "little gym" geocoded is a street address in
-- Torrance; "little gym" searched is four gymnastics studios. Without `kind`
-- in the primary key the first answer is served to the second question, and
-- the failure is silent — a parent looking for their child's class is offered
-- a road. Three kinds, because the geocoder itself asks two different
-- questions:
--
--   'place'        a town, neighborhood or ZIP inside the market. US only,
--                  biased to the market's own bounding box.
--   'world'        anywhere, for "where have you lived before?" — no country
--                  filter and no bounds, or a parent who moved from London
--                  gets London, Ontario.
--   'establishment' a named school, class, club or place of worship.
--
-- Everything else about the row is unchanged and deliberately so: the TTLs,
-- the empty-array-means-"Google knows no such place" rule, the "a failure is
-- never cached" rule, and above all that this is keyed on the QUERY and never
-- on the person. There is no `person_id` column and there must not be one —
-- `pending_options.submitted_value` already records who typed what, and a
-- second table saying the same thing with a timestamp would be a log of what
-- parents write, which is what invariant 7 exists to prevent. What this holds
-- is a dictionary of place names.
--
-- The default is 'place' so every row already in the table keeps meaning what
-- it meant: those were all geocodes of a town or a ZIP.

ALTER TABLE "geocode_cache" ADD COLUMN "kind" text DEFAULT 'place' NOT NULL;
--> statement-breakpoint
-- A typo here would create a cache nothing ever reads: the writer stores
-- 'establishments', the reader asks for 'establishment', and every lookup is
-- a miss that is paid for and then thrown away. Exactly the reason
-- `matching_settings` put a CHECK on its key.
ALTER TABLE "geocode_cache" ADD CONSTRAINT "geocode_cache_kind_check"
	CHECK ("geocode_cache"."kind" IN ('place', 'world', 'establishment'));
--> statement-breakpoint
-- The key itself. Dropping and recreating the primary key is safe on a cache
-- and on this one twice over: it is small, it is rebuilt by reads, and the
-- rows that exist are all 'place' by the default above.
ALTER TABLE "geocode_cache" DROP CONSTRAINT "geocode_cache_pk";
--> statement-breakpoint
ALTER TABLE "geocode_cache" ADD CONSTRAINT "geocode_cache_pk"
	PRIMARY KEY ("market_id", "kind", "query");

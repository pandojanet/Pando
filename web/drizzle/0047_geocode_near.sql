-- Which neighborhood a lookup was asked about, in the cache key.
--
-- 17 Sep. The developer picked Detroit on the neighborhood question and found
-- the schools box empty: "всі школи, активності мають шукатись по цьому
-- нейборхуду, так як в нас локально підтягується". Two things were wrong, and
-- this migration is about the second.
--
-- The first is the bias: every establishment search was ranked around a
-- hard-coded rectangle over the San Gabriel Valley, because `MARKETS` has one
-- entry and an unknown market falls back to it. `lookupPlaces` now centres the
-- search on the parent's own place instead.
--
-- ⚠⚠ And that is exactly what the cache could not express. `geocode_cache` was
-- keyed on (market, kind, query), so "schools, preschools and daycares" asked
-- for Detroit and the same words asked for Altadena were **one row**. The
-- second parent would have been served the first parent's town — silently,
-- with the right number of plausible-looking results and every one of them in
-- the wrong state. A cache that answers the wrong question confidently is
-- worse than no cache, which is the whole reason 0042 put `kind` in this key
-- three weeks ago rather than folding it into the query string.
--
-- `near` is the parent's own place as `GeocodedPlace.storedValue` writes it —
-- "Detroit, MI", "Altadena" — folded the way `cacheKey` folds everything else.
-- Empty string for a lookup with no neighborhood behind it, which is every row
-- written before today and every `world` lookup by construction.
ALTER TABLE "geocode_cache" ADD COLUMN "near" text DEFAULT '' NOT NULL;
--> statement-breakpoint
-- The same bound the query already carries, for the same reason: a limit held
-- in one place is a limit until somebody writes a second caller, and this one
-- is what stops a crafted request filling the table at Google's expense.
ALTER TABLE "geocode_cache" ADD CONSTRAINT "geocode_cache_near_shape"
	CHECK (
		length("geocode_cache"."near") <= 60
		AND "geocode_cache"."near" = btrim("geocode_cache"."near")
	);
--> statement-breakpoint
-- Dropping and recreating the primary key is safe on a cache and on this one
-- twice over: it is small, it is rebuilt by reads, and every row that exists
-- has near = '' from the default above.
ALTER TABLE "geocode_cache" DROP CONSTRAINT "geocode_cache_pk";
--> statement-breakpoint
ALTER TABLE "geocode_cache" ADD CONSTRAINT "geocode_cache_pk"
	PRIMARY KEY ("market_id", "kind", "near", "query");

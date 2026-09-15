-- Geocoding, cached: what Google said about a place name, keyed on the name.
--
-- Google's Geocoding API is billed per request, and the one surface that calls
-- it is a search box a parent types into. Two bounds keep that affordable, and
-- this table is the second of them: the endpoint only asks Google when the
-- closed §5 list (52 places, 62 ZIPs, already in the bundle) answers nothing,
-- and every answer that comes back is kept here so the next parent to type the
-- same ZIP costs nothing at all.
--
-- ⚠ Keyed on the QUERY and never on the person, and that is the whole reason
-- this is allowed to hold text somebody typed. There is no `person_id` column
-- and there must not be one: `pending_options.submitted_value` already records
-- who typed what, so a second table saying the same thing with a timestamp
-- would be a log of what parents write — which is what invariant 7 exists to
-- prevent. What this holds is a dictionary of place names.
--
-- `places` is the parsed result, not Google's body: `lib/geo.ts` has already
-- dropped everything unusable, so nothing here needs re-reading or trusting.
-- An EMPTY array is a real, meaningful value — it means "Google knows no such
-- place", which is exactly the answer worth caching, because without it one
-- typo is a paid lookup on every keystroke of every session that repeats it.
-- A *failure* is never written here at all (see `lib/server/geocode.ts`):
-- caching a bad key would leave the feature broken for a month after somebody
-- fixed it, with nothing on any screen saying why.
--
-- Freshness is decided in code rather than by a constraint, because the two
-- TTLs differ by outcome — a town does not move, so a hit stands for 30 days,
-- while a miss expires in 7. `isFresh` in `lib/geo.ts` is that rule, and it is
-- pure so `npm run test:geo` can walk both clocks.

CREATE TABLE "geocode_cache" (
	"market_id" text NOT NULL,
	"query" text NOT NULL,
	"places" jsonb NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "geocode_cache_pk" PRIMARY KEY ("market_id","query"),
	-- The same bound the endpoint enforces, held here as well. A limit checked
	-- in one place is a limit only until somebody writes a second caller, and
	-- this one is what stops a crafted request filling the table with long
	-- strings at Google's expense.
	CONSTRAINT "geocode_cache_query_shape" CHECK (
		length("geocode_cache"."query") between 2 and 60
		AND "geocode_cache"."query" = btrim("geocode_cache"."query")
	),
	-- `places` is a list. A bare object here would read back as one place with
	-- no fields rather than as an error.
	CONSTRAINT "geocode_cache_places_shape" CHECK (
		jsonb_typeof("geocode_cache"."places") = 'array'
	)
);
--> statement-breakpoint
-- For the sweep that clears stale rows. Nothing runs it today — this is a
-- cache, so a stale row is re-fetched on read rather than being wrong — but a
-- table with a date and no index on it is one somebody will scan by hand.
CREATE INDEX "geocode_cache_fetched_idx" ON "geocode_cache" USING btree ("fetched_at");

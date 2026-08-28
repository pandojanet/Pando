-- The area a record belongs to, as a slug — so it can be compared to the
-- neighborhood id a parent actually tapped.
--
-- ## The bug this closes
--
-- `market_options.area` holds the human name from the client's workbook
-- ("Altadena", "La Cañada Flintridge"). The parent's answer is the option id
-- ("altadena", "la-canada-flintridge"). Both the search endpoint and the chip
-- list compared them with `lower()`, which bridges a single-word name and
-- nothing else — so **nine of the seventeen areas never matched**: Highland
-- Park, La Cañada Flintridge, Monterey Park, Sierra Madre, South Pasadena, San
-- Marino, San Gabriel, Eagle Rock, Temple City. The eight that worked worked by
-- accident.
--
-- Nothing looked broken: a parent in La Cañada was shown twelve schools in
-- alphabetical order, none of them in their own city, and the code that was
-- meant to rank them had run and found no matches. The same failure mode as the
-- `bands` bug — typecheck clean, tests green, feature dead.
--
-- ## Why a column and not a fix at the comparison
--
-- Because the app's rule everywhere else is that matching keys on a slug and
-- never on display text (the promoted-option rule, the previous-places prefix).
-- Comparing against a label means the ranking breaks silently the day somebody
-- edits a spelling — which is precisely what just happened, one level up.
-- Indexable, and computed once at import rather than per query.
ALTER TABLE market_options ADD COLUMN IF NOT EXISTS area_slug text;--> statement-breakpoint

COMMENT ON COLUMN market_options.area_slug IS
  'market_options.area as a slug, for comparing against the neighborhood option id a parent tapped. Written by npm run taxonomy:import; never compare against area itself.';--> statement-breakpoint

-- Backfill. This has to agree with `slug()` in scripts/import-taxonomy.mjs, which
-- is what writes the column from now on: fold diacritics, drop apostrophes, then
-- collapse everything else to single hyphens. Verified equal for all 521 rows.
UPDATE market_options
   SET area_slug = trim(both '-' from
         regexp_replace(
           lower(
             translate(
               replace(replace(area, '''', ''), '’', ''),
               'ÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜÝàáâãäåçèéêëìíîïñòóôõöùúûüý',
               'AAAAAACEEEEIIIINOOOOOUUUUYaaaaaaceeeeiiiinooooouuuuy'
             )
           ),
           '[^a-z0-9]+', '-', 'g'))
 WHERE area IS NOT NULL;--> statement-breakpoint

-- Ranking and the starter filter both key on it.
CREATE INDEX IF NOT EXISTS market_options_area_slug_idx
  ON market_options (market_id, category, area_slug);

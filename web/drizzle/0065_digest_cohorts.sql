-- The weekly digest goes to groups of alike families, not to each person
-- (4 Nov, lib/digest-cohorts.ts).
--
-- The developer: "not a personalised digest for each person — combine them for
-- people with similar interests, by the graph", and "the number of groups must
-- be decided dynamically, not a fixed number". A Saturday's recipients are
-- grouped by what the graph knows (children's stages, town, affinities,
-- logistics), and each group has its own edition: one agent search, one set
-- of items. So an edition is per market, Saturday and group now, not per
-- market and Saturday.
--
-- Additive: every existing edition becomes the group 'all', which is what it
-- was. ⚠ But not safe in either order on its own (review, 4 Nov): migrated
-- first, the old code's `on conflict (market_id, edition_date, is_test)` has no
-- matching constraint any more and every edition insert fails; deployed first,
-- the new code reads `cohort_key`, which is not there yet. Only the weekly
-- digest job touches it, Saturdays 9:00-20:00 on the market's clock — so
-- migrate and deploy together, on any other day.
--   * cohort_key     — the group's stable name for the day (its profile, hashed):
--                      the same group is the same edition on every hourly run.
--   * cohort_label   — what the admin reads ("toddler, preschool · Altadena").
--   * cohort_profile — what the agent was told: ages, stages, towns, interests,
--                      members. Counts and the graph's own values, never a name
--                      or a phone (invariant 7).
-- The one-per-week constraint becomes one per week per group.
ALTER TABLE digest_editions ADD COLUMN IF NOT EXISTS cohort_key text NOT NULL DEFAULT 'all';--> statement-breakpoint
ALTER TABLE digest_editions ADD COLUMN IF NOT EXISTS cohort_label text;--> statement-breakpoint
ALTER TABLE digest_editions ADD COLUMN IF NOT EXISTS cohort_profile jsonb;--> statement-breakpoint
ALTER TABLE digest_editions DROP CONSTRAINT IF EXISTS digest_editions_one_per_week;--> statement-breakpoint
ALTER TABLE digest_editions ADD CONSTRAINT digest_editions_one_per_cohort
  UNIQUE (market_id, edition_date, is_test, cohort_key);

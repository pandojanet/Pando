-- What a record is *about*, in the vocabulary a parent is asked in.
--
-- Retrieval reads no subject at all: a question is a market, an area, age bands
-- and kinds, so "toddler swim classes" and "toddler music classes" return the
-- same activities. The vocabulary to fix that already exists and nothing uses
-- it: `market_options.focus` holds thirteen curated topics for this market
-- (activities, arts_music, sports, camps, nannies, outings, pediatric_health,
-- preschools_schools, newborn_care, special_needs_resources,
-- working_parent_logistics, new_to_area_help, babysitters), and `grep '"focus"'`
-- over the whole repository returns nothing. It is what a parent is *asked*
-- about in P11/P12 and it was never attached to a record.
--
-- Why a new column rather than `shares.topic`: that one is the tip script's own
-- question — schedules, birthdays, costs, new_to_area — a different vocabulary
-- for a different purpose, populated on five records and null on every activity
-- and place. Two vocabularies in one column is a column nobody can query.
--
-- ## Why there is deliberately no CHECK on it
--
-- Every other enum-shaped column here carries one, and this one must not. The
-- values live in `market_options`, which is authoritative and editable by an
-- admin (12 Aug) — so a CHECK would be a second copy of a list this codebase
-- does not own, and adding a topic for a new market would need a migration to
-- go with it. It is validated at the write instead, against the same table the
-- model was given as its choices, and anything outside that list is dropped
-- rather than stored.

alter table shares add column if not exists focus text;

comment on column shares.focus is
  'market_options.focus value: what a parent would ask about to reach this. Set by the extraction pass on a cards first scoring, or by npm run focus:backfill --retag. There is no admin control for it yet. No CHECK on purpose - the vocabulary lives in market_options.';

-- Retrieval ranks on it, so it is read on every answered question.
create index if not exists shares_focus_idx on shares (market_id, focus)
  where focus is not null;

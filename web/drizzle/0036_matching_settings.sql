-- The scalar knobs in the matcher that are not a per-connection weight.
--
-- `affinity_weights` already holds "what one shared connection is worth", and it
-- cannot hold this one: its column is `integer` and the context step is 0.5.
-- CLAUDE.md records what happens when a fraction meets that column -- Postgres
-- answers `invalid input syntax for type integer`, which reaches the admin as a
-- bare 502.
--
-- Key and value rather than a single-row table with a column per setting: the
-- next knob is then a row, not a migration, which is the same reasoning that
-- made the weights data in the first place.
--
-- The CHECK on `key` is the important half. Without it a typo creates a setting
-- that nothing reads and nothing reports -- the admin writes 0.8, the page shows
-- 0.8, and the scorer goes on using the default forever. Same rule as the
-- taxonomy importer refusing a category it does not know.
create table if not exists matching_settings (
  key   text primary key,
  value numeric(4, 2) not null,
  constraint matching_settings_key_check
    check (key in ('relevance_step')),
  -- Zero is allowed and means "context breaks no ties", which is a legitimate
  -- thing to want to try on the harness. Negative is not: it would make a
  -- parent *less* relevant for having something in common.
  constraint matching_settings_value_check
    check (value >= 0 and value <= 5)
);

-- The value the code has used since M6 shipped, so switching the page from a
-- constant to this table changes no ranking on the day it lands.
insert into matching_settings (key, value)
values ('relevance_step', 0.5)
on conflict (key) do nothing;

-- pando_sources.market_id → area (23 Nov, the lab walk as an admin).
--
-- 0077 named the column market_id, but what the Source agent and the Partner analyst put there is the
-- area an organisation covers ("altadena", "pasadena") — the tools call it `area` — while market_id
-- everywhere else in Pando means the market (lib/markets.ts). The developer chose the rename (23 Nov)
-- over a second column. Nothing outside the local stands has this table yet: on production 0077
-- creates it and this renames it in the same run, with no rows.
ALTER TABLE pando_sources RENAME COLUMN market_id TO area;

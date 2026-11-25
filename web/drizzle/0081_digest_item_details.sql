-- A digest item's details: its price, what the place is, and whether it is in high demand (25 Nov).
--
-- Janet: an event card needs its price (Enchanted Forest - $30 for a fixed date, $80 any day), who
-- goes free (under-2s) and its discounts ("free first Friday"), or the information is not relevant;
-- a short line on what the place is ("not everyone knows what Kidspace Children's Museum is"); and
-- events that sell out or draw crowds flagged and ranked higher. The developer: the price is shown
-- only in the details a pick opens - the list stays short - and "popular" means high demand, a lot
-- of people, a well-known event, not only "few tickets left".
--
-- Written by the digest agent from the event's own page and kept only when the page bears it out
-- (`readAgentItems`: every $ amount and a "free" on the page; "popular" only with a demand cue on it).
-- Null / false for every item stored before this, and for a candidate until a proposal carries them.
-- Additive, no row rewritten; the app writes and reads the columns only once they exist, so a deploy
-- before `npm run migrate` keeps working.
ALTER TABLE digest_items ADD COLUMN IF NOT EXISTS price text;--> statement-breakpoint
ALTER TABLE digest_items ADD COLUMN IF NOT EXISTS about text;--> statement-breakpoint
ALTER TABLE digest_items ADD COLUMN IF NOT EXISTS popular boolean NOT NULL DEFAULT false;--> statement-breakpoint
ALTER TABLE digest_items ADD COLUMN IF NOT EXISTS popular_why text;--> statement-breakpoint
ALTER TABLE digest_candidates ADD COLUMN IF NOT EXISTS price text;--> statement-breakpoint
ALTER TABLE digest_candidates ADD COLUMN IF NOT EXISTS about text;--> statement-breakpoint
ALTER TABLE digest_candidates ADD COLUMN IF NOT EXISTS popular boolean NOT NULL DEFAULT false;--> statement-breakpoint
ALTER TABLE digest_candidates ADD COLUMN IF NOT EXISTS popular_why text;

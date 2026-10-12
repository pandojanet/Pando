-- The client's sub-categories (9 Oct, *Categories Questions*, added 10/7 JW).
--
-- The chat now asks a few context questions, classifies the card into one of
-- the button's sub-categories and asks that sub-category's questions
-- (lib/seed-chat/subcategories.ts). The button stays the share_kind; this
-- records which sub-category it was. Text + CHECK rather than an enum: it is a
-- taxonomy the client adds to, and an enum value cannot be used in the
-- migration that adds it.
--
-- The sub-categories' own questions land on four new unified columns on the
-- contribution, each meaning one thing whichever card asked it: used_for,
-- timing_note, detail_note, amenities.
--
-- Additive and nullable. ⚠ RUN THIS BEFORE THE CODE THAT CAME WITH IT DEPLOYS:
-- drizzle's insert names every column in schema.ts, so the new code's
-- insert(shares) / insert(shareContributions) fails on a database without them —
-- every card, not only the new ones (DEPLOY.md §3b, the 0054 note).
ALTER TABLE shares
  ADD COLUMN IF NOT EXISTS subcategory text;--> statement-breakpoint

ALTER TABLE shares
  ADD CONSTRAINT shares_subcategory_check
  CHECK (subcategory IS NULL OR subcategory IN ('activities','classes','camps','places','restaurants','schools','doctors','specialists','parties','tips','products'));--> statement-breakpoint

ALTER TABLE share_contributions
  ADD COLUMN IF NOT EXISTS used_for text,
  ADD COLUMN IF NOT EXISTS timing_note text,
  ADD COLUMN IF NOT EXISTS detail_note text,
  ADD COLUMN IF NOT EXISTS amenities text[];--> statement-breakpoint

COMMENT ON COLUMN shares.subcategory IS
  'The client sub-category the chat classified the card into (9 Oct). Null = asked as the general category.';

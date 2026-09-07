-- 7 Sep — three of the client's four instructions need the same two tables to
-- learn one new idea each: an invite link can point at more things than a parent
-- group, and a referral can be owed to somebody who is not a `people` row.
--
-- ## `invites.kind`
--
-- The table has carried exactly one target since 12 Aug: `group_option_value`,
-- a `market_options.parent_groups` value. Her instruction is that a link can now
-- be made for a **school** as well, and that there are **individual** links whose
-- referrer is whoever created them.
--
-- Those are three different questions about one row, so the row says which it is
-- rather than leaving a reader to infer it from which column happens to be full.
-- `group` is the default, which is what every existing row is.
--
-- ## What a school link deliberately does *not* do
--
-- It records **attribution and nothing else**, exactly as the group link has
-- since 12 Aug: a link forwarded out of a school WhatsApp group is evidence that
-- somebody shared it, never that whoever opened it has a child there. So no
-- `social_affinities` row is written from this, and the 14 Aug hole stays open
-- and stays documented rather than being quietly closed by a link.
--
-- ## `invites.referrer_person_id`
--
-- A parent's own referral link is one more row here rather than a table of its
-- own, which is the client's own earlier framing (27 Aug: a personal invitation
-- is "one more invite row"). It buys the whole existing mechanism for free —
-- resolution, the 60-second cache, `people.invite_id` attribution, the open
-- counter, and `/admin/invites` reporting — instead of a second thing that has
-- to learn all of it.
--
-- `on delete set null` rather than cascade: deleting the referrer must not
-- delete the link, because `people.invite_id` points at it and that is how
-- everyone who arrived through it is attributed. An orphaned personal link is
-- history, which is what this repo keeps.
--
-- ## `referrals.referrer_admin`
--
-- Her fourth instruction says the referrer of an individual link is **the admin
-- who created it**, and an admin is not a person in the graph — invariant 10 is
-- that one person is one identity keyed by phone, so minting a `people` row for
-- an operator to satisfy a foreign key would be worse than a nullable column.
--
-- ⚠ The CHECK forbids **both** being set and deliberately does not require one:
-- `referrer_id` is `on delete set null`, so demanding one would make deleting a
-- person fail on a constraint attached to a row about somebody else.

ALTER TABLE invites ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'group';--> statement-breakpoint
ALTER TABLE invites ADD COLUMN IF NOT EXISTS school_option_value text;--> statement-breakpoint
ALTER TABLE invites ADD COLUMN IF NOT EXISTS referrer_person_id uuid
  REFERENCES people(id) ON DELETE SET NULL;--> statement-breakpoint

ALTER TABLE invites DROP CONSTRAINT IF EXISTS invites_kind_check;--> statement-breakpoint
ALTER TABLE invites ADD CONSTRAINT invites_kind_check
  CHECK (kind IN ('group', 'school', 'personal'));--> statement-breakpoint

-- A row carries the target its own kind names, and no other.
ALTER TABLE invites DROP CONSTRAINT IF EXISTS invites_target_matches_kind;--> statement-breakpoint
ALTER TABLE invites ADD CONSTRAINT invites_target_matches_kind CHECK (
  (kind = 'group' AND school_option_value IS NULL AND referrer_person_id IS NULL)
  OR (kind = 'school' AND referrer_person_id IS NULL)
  OR (kind = 'personal' AND school_option_value IS NULL AND group_option_value IS NULL)
);--> statement-breakpoint

-- One referral link per parent. Partial, because every other row has no
-- referrer and nulls would otherwise collide.
DROP INDEX IF EXISTS invites_referrer_person_uniq;--> statement-breakpoint
CREATE UNIQUE INDEX invites_referrer_person_uniq
  ON invites (referrer_person_id) WHERE referrer_person_id IS NOT NULL;--> statement-breakpoint

ALTER TABLE referrals ADD COLUMN IF NOT EXISTS referrer_admin text;--> statement-breakpoint
ALTER TABLE referrals DROP CONSTRAINT IF EXISTS referrals_one_referrer;--> statement-breakpoint
ALTER TABLE referrals ADD CONSTRAINT referrals_one_referrer
  CHECK (NOT (referrer_id IS NOT NULL AND referrer_admin IS NOT NULL));--> statement-breakpoint

COMMENT ON COLUMN invites.kind IS
  'group | school | personal. Says which target the row carries, rather than leaving a reader to infer it from which column is full.';--> statement-breakpoint
COMMENT ON COLUMN invites.school_option_value IS
  'A market_options.schools value. Attribution only — a forwarded link is never evidence that whoever opened it has a child at that school, so no affinity edge is written from it.';--> statement-breakpoint
COMMENT ON COLUMN invites.referrer_person_id IS
  'The parent whose own referral link this is. One row per parent (partial unique index); set null on delete, because people.invite_id points here and that is how their arrivals are attributed.';--> statement-breakpoint
COMMENT ON COLUMN referrals.referrer_admin IS
  'The admin who created an individual link, when the referrer is not a person in the graph. Exactly one of referrer_id / referrer_admin is set at insert; the CHECK only forbids both, because referrer_id is set null on delete.';

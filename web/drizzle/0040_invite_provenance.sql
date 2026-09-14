-- An invitation is provenance, not proof of trust (client §1, 9 Sep).
--
-- Her row, verbatim: *"Automatically store invited_by, invited_at and
-- activated_at. Do not create a vouch or trust edge from an invite."*
--
-- ## The second sentence needed no code, and that is worth saying
--
-- Nothing has ever written an affinity edge from a link, and it is a decision
-- taken twice (12 and 14 Aug): a link forwarded out of a parent group is
-- evidence somebody shared it, never that whoever opened it belongs there.
-- `test:e2e` already asserts the absence — a parent arriving on a group code
-- has the attribution and **no** edge to that group. So this migration is only
-- the first sentence, and the second is a guard that was already standing.
--
-- ## What each of the three can honestly mean
--
-- `invited_by` — **only a personal link has one.** An invite is per *group*
-- (12 Aug) and since `drizzle/0034` may point at a school, and only
-- `kind = 'personal'` carries a `referrer_person_id`. So this is null for most
-- arrivals and that is the honest answer rather than a gap: nobody in
-- particular invited them, a group did. ⚠ `on delete set null`, never cascade
-- — deleting the inviter must not take their invitee's row with it, which is
-- the same rule `invites.referrer_person_id` already follows.
--
-- `invited_at` — **when the invitation was taken up**, not when it was sent.
-- Pando cannot know the second: a personal link is copied and sent by the
-- parent themselves, through a channel Pando never sees (invariant 13's
-- reasoning, one surface along). What it can observe is the first profile
-- write that carried a code, which is the moment the link produced somebody.
--
-- ⚠ **Written once and never moved.** Both are `coalesce`d on the upsert, so a
-- parent who edits their profile a month later — or opens a second link —
-- keeps the provenance of the invitation that actually brought them. Letting
-- the newer write win would make "who brought this contributor" answerable
-- differently depending on when you asked.
--
-- `activated_at` — **when the invitation produced a founding contributor**,
-- stamped where that transition happens (`founding.approve`). ⚠ This is the
-- one of the three where her word admits more than one reading, and the
-- alternative is *profile completed* — which is already `profile_captured_at`
-- and would make this column a copy. Founding is the threshold the rest of the
-- product treats as activation (it is granted by a person on the second
-- approved contribution), so that is what this records. Worth confirming with
-- her, because it is the number that says whether a link delivered anybody.
--
-- All three nullable and none backfilled: no existing row can be told which of
-- these moments it passed through, and inventing a timestamp would put a date
-- on a funnel that nobody measured.

ALTER TABLE "people"
  ADD COLUMN IF NOT EXISTS "invited_by" uuid REFERENCES "people"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "invited_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "activated_at" timestamptz;

-- Nobody is their own inviter. Reachable only through a corrupted write, and
-- it would read on the founding queue as a parent who brought themselves.
ALTER TABLE "people"
  DROP CONSTRAINT IF EXISTS "people_not_self_invited";
ALTER TABLE "people"
  ADD CONSTRAINT "people_not_self_invited"
  CHECK ("invited_by" IS NULL OR "invited_by" <> "id");

-- Activation cannot precede the invitation it came from.
ALTER TABLE "people"
  DROP CONSTRAINT IF EXISTS "people_activated_after_invited";
ALTER TABLE "people"
  ADD CONSTRAINT "people_activated_after_invited"
  CHECK (
    "activated_at" IS NULL
    OR "invited_at" IS NULL
    OR "activated_at" >= "invited_at"
  );

-- "Which link delivered contributors, and how many activated" — the per-link
-- funnel estimate 2.2 asks for, now answerable without a scan.
CREATE INDEX IF NOT EXISTS "people_invited_by_idx"
  ON "people" ("invited_by")
  WHERE "invited_by" IS NOT NULL;

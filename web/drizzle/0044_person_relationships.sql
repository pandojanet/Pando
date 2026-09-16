-- 16 Sep — "ask about their relationship to the inviter … to start building an
-- internal relationship graph."
--
-- ## A table of edges, not a column on `people`
--
-- The obvious place is `people.invited_by_relationship`, next to `invited_by`
-- (0040). It is the wrong one: `invited_by` is `ON DELETE SET NULL`, so any
-- CHECK tying the relationship to an inviter would make deleting the *inviter*
-- fail on a constraint attached to somebody else's row — the trap `referrals`
-- already documents — and without that CHECK a deleted inviter leaves a
-- relationship pointing at nobody.
--
-- An edge between two people cascades from both ends instead. When either of
-- them deletes their profile the edge goes, which is right: it describes both.
--
-- ## What it holds
--
-- One row per (person, related person), written with the profile — after the
-- phone is confirmed (invariant 11) — and only when the invite that brought the
-- person was a personal link. Internal: never shown to another parent, and not
-- read by the matcher today.
CREATE TABLE IF NOT EXISTS "person_relationships" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "person_id" uuid NOT NULL REFERENCES "people"("id") ON DELETE CASCADE,
  "related_person_id" uuid NOT NULL REFERENCES "people"("id") ON DELETE CASCADE,
  "relationship" text NOT NULL,
  "source" text NOT NULL DEFAULT 'invite',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "person_relationships_pair_key" UNIQUE ("person_id", "related_person_id"),
  CONSTRAINT "person_relationships_not_self" CHECK ("person_id" <> "related_person_id"),
  CONSTRAINT "person_relationships_relationship_check" CHECK ("relationship" IN (
    'family', 'close_friend', 'friend', 'neighbor', 'colleague',
    'parent_group', 'school_parent', 'other'
  )),
  CONSTRAINT "person_relationships_source_check" CHECK ("source" IN ('invite'))
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "person_relationships_related_idx"
  ON "person_relationships" ("related_person_id");

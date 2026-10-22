-- Parent ↔ parent connections an admin records (22 Oct).
--
-- The developer: links between parents, many to many, not through the
-- recommendation graph — "to see how parents are connected, family and so on".
-- Decided with them: an admin adds a connection on a parent's profile; one
-- general kind for now ('connected'), with an optional note in the admin's
-- words ("sisters", "neighbours on Lake Ave"); shown only on the admin profile,
-- never to a parent, and read by nothing else — not the matcher, not a blast.
--
-- `person_relationships` (0044) already is that graph: an edge between two
-- people, cascading from both ends. Until now it had one writer — the invite
-- question, "how do you know the person who invited you?" — so this widens
-- three CHECKs and adds nothing else:
--   * relationship: + 'connected', the one general kind an admin records;
--   * source:       + 'admin', so an admin's edge is never mistaken for a
--                   parent's own answer (and is the only kind an admin removes);
--   * note:         allowed on 'connected' as well as 'other' (0050), same 120.
--
-- Widening only: every row that passed the old CHECKs passes the new ones, so
-- nothing existing is rewritten. One connection per pair either way round is
-- enforced by the write (`person.link`), not by an index here — an index on
-- (least, greatest) would fail this whole migration if any pair already had
-- edges both ways, and the write's conditional insert keeps that from growing.
ALTER TABLE person_relationships DROP CONSTRAINT IF EXISTS person_relationships_relationship_check;--> statement-breakpoint
ALTER TABLE person_relationships ADD CONSTRAINT person_relationships_relationship_check
  CHECK (relationship IN ('family', 'close_friend', 'friend', 'neighbor', 'colleague', 'parent_group', 'school_parent', 'other', 'connected'));--> statement-breakpoint
ALTER TABLE person_relationships DROP CONSTRAINT IF EXISTS person_relationships_source_check;--> statement-breakpoint
ALTER TABLE person_relationships ADD CONSTRAINT person_relationships_source_check
  CHECK (source IN ('invite', 'admin'));--> statement-breakpoint
ALTER TABLE person_relationships DROP CONSTRAINT IF EXISTS person_relationships_note_check;--> statement-breakpoint
ALTER TABLE person_relationships ADD CONSTRAINT person_relationships_note_check
  CHECK (note IS NULL OR (relationship IN ('other', 'connected') AND char_length(note) BETWEEN 1 AND 120));

-- Per-affiliation visibility: the client's Privacy Guidance §A (24 Aug).
--
-- Until now "may Pando mention a shared connection" was one answer per person.
-- Her model is one decision per *connection*: share the school, keep the golf
-- club and the faith community private. That is not a finer-grained version of
-- the same setting — it is a different thing, because the exposure differs by
-- connection. A parent at a 900-pupil school and a parent at a 40-member club
-- are risking very different amounts of identifiability from the same sentence.
--
-- ## Why a table rather than a column
--
-- Three of her requirements cannot live on `people`:
--
--   * permission is per affiliation, and a parent has as many as they named;
--   * each grant carries its own **wording version and timestamp**, because §I
--     asks that every attributed statement be reconstructable from its
--     supporting records;
--   * revocation is a recorded event with an effective time, not a flag flip —
--     §G: "Record the effective time of the change."
--
-- ## The three states, and why only two are stored here
--
-- `private` (internal matching only) and `shared_anonymously` (may be mentioned,
-- without a name) are states of an affiliation. Her third — identity sharing —
-- is deliberately **not** a value in this column: §A says it is "never
-- persistent; requires separate permission for each introduction". Storing it as
-- a visibility state would make a per-introduction decision look like a standing
-- one, which is the mistake the sentence exists to prevent.
--
-- ## What this table does not do
--
-- It records permission. It does not implement §§B–F or §H — eligibility,
-- counting by household, the 1/2/3+ wording, the no-combining rule, or the
-- introduction flow. All of those are the *answering* path, and Phase 1 has no
-- answering path. This is the record those rules will read.

CREATE TABLE IF NOT EXISTS affiliation_visibility (
  person_id uuid NOT NULL REFERENCES people(id) ON DELETE CASCADE,

  -- Deliberately the same vocabulary as `social_affinities`, so a row here names
  -- exactly one edge in the matching graph and the join needs no translation.
  -- Not a foreign key to that table: an affinity is re-derived whenever a parent
  -- edits their profile, and a permission must not be destroyed by a
  -- re-derivation. The parent's decision outlives our copy of the graph.
  affiliation_type text NOT NULL,
  affiliation_value text NOT NULL,

  visibility text NOT NULL DEFAULT 'private',

  -- Which words they agreed to, and when. `lib/consent.ts` owns the text and its
  -- version; a version is never edited in place.
  consent_text_version text,
  consented_at timestamptz,

  -- §G. Kept rather than deleted: "Do not delete the underlying recommendation
  -- unless the parent separately requests that", and the same reasoning applies
  -- to the permission itself — the audit question is "what was allowed, when",
  -- which a deleted row cannot answer.
  revoked_at timestamptz,

  created_at timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (person_id, affiliation_type, affiliation_value)
);--> statement-breakpoint

ALTER TABLE affiliation_visibility
  ADD CONSTRAINT affiliation_visibility_state_check
  CHECK (visibility IN ('private', 'shared_anonymously'));--> statement-breakpoint

-- Sharing requires evidence, exactly as caregiver consent does: which wording,
-- and when. A `shared_anonymously` row with neither could not be defended, and
-- §I lists both as required fields.
ALTER TABLE affiliation_visibility
  ADD CONSTRAINT affiliation_visibility_consent_evidence
  CHECK (
    visibility <> 'shared_anonymously'
    OR (consent_text_version IS NOT NULL AND consented_at IS NOT NULL)
  );--> statement-breakpoint

-- Revoking returns the affiliation to private. Without this a row could claim to
-- be both revoked and still shareable, and every reader would have to remember
-- to check two columns — which is how a revoked permission gets used once.
ALTER TABLE affiliation_visibility
  ADD CONSTRAINT affiliation_visibility_revoked_is_private
  CHECK (revoked_at IS NULL OR visibility = 'private');--> statement-breakpoint

-- The answering path's read: which of this parent's connections may be mentioned.
CREATE INDEX IF NOT EXISTS affiliation_visibility_shared_idx
  ON affiliation_visibility (affiliation_type, affiliation_value)
  WHERE visibility = 'shared_anonymously';--> statement-breakpoint

-- And the parent's own view, for a settings screen and for the admin's record.
CREATE INDEX IF NOT EXISTS affiliation_visibility_person_idx
  ON affiliation_visibility (person_id);--> statement-breakpoint

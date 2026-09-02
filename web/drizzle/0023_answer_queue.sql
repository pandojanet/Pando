-- M14.2 / 5.8 — answers waiting for a person.
--
-- 5.7 composes an answer; this is where it waits. The estimate's 5.8 holds
-- "sensitive, caregiver-related, or low-confidence answers in an admin review
-- queue instead of sending them automatically" — and the strategy is stricter
-- than that for the pilot: §19, "for the first months every contribution is read
-- by a person, because that is how we learn what 'good' looks like well enough to
-- safely automate any of it."
--
-- So the table holds *why* an answer is here rather than assuming, and the
-- routing rule that fills it lives in lib/answer-routing.ts where it can be read
-- and changed as the pilot learns.
--
-- ## Why the composed text is stored rather than recomposed on approval
--
-- Because the admin approved *this* text. Recomposing at send time would mean
-- the records could have changed in between — a contribution approved, a record
-- marked stale — and the parent would receive something nobody read. The stored
-- text is the artefact; if it is out of date the answer is rejected and a new one
-- composed, which is a decision rather than a drift.
CREATE TABLE IF NOT EXISTS answers (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id     text NOT NULL DEFAULT 'pasadena',
  -- Who asked. Null for a cold inbound whose sender is not a person yet (5.9).
  person_id     uuid REFERENCES people(id) ON DELETE SET NULL,
  -- The number, so an answer can still be sent to somebody with no profile.
  phone         text NOT NULL,
  question_text text NOT NULL,
  -- Exactly what would be sent. Never regenerated at send time.
  answer_text   text NOT NULL,
  -- What 5.7 decided: none | offer_blast | human_review.
  next_step     text NOT NULL DEFAULT 'none',
  -- The trust labels the answer carries, so the reviewer can check the claim
  -- against the records without re-deriving it.
  labels        text[] NOT NULL DEFAULT '{}',
  -- True when the answer rests only on public information. Stored because it
  -- changes what the reviewer is checking, not merely how it reads.
  public_only   boolean NOT NULL DEFAULT false,
  -- Why it is in the queue at all. One of the routing reasons.
  hold_reason   text NOT NULL,
  status        text NOT NULL DEFAULT 'pending_review',
  reviewed_by   text,
  reviewed_at   timestamptz,
  -- The message that carried it, once sent. Null until then.
  sent_message_id uuid REFERENCES message_log(id) ON DELETE SET NULL,
  sent_at       timestamptz,
  is_test       boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT answers_status_check
    CHECK (status IN ('pending_review', 'approved', 'sent', 'rejected')),
  CONSTRAINT answers_next_step_check
    CHECK (next_step IN ('none', 'offer_blast', 'human_review')),
  -- Sent means sent: a row cannot claim delivery without the message behind it.
  CONSTRAINT answers_sent_has_message
    CHECK (status <> 'sent' OR sent_at IS NOT NULL)
);--> statement-breakpoint

COMMENT ON TABLE answers IS
  'M14.2 answer queue. Every answer waits for a person during the pilot (strategy 19); hold_reason says which rule put it here. answer_text is what will be sent, verbatim — never recomposed at send time, because the admin approved that text and not the records behind it.';--> statement-breakpoint

CREATE INDEX IF NOT EXISTS answers_queue_idx
  ON answers (status, created_at)
  WHERE status = 'pending_review' AND NOT is_test;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS answers_person_idx
  ON answers (person_id, created_at DESC);

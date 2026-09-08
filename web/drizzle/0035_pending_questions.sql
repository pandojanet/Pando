-- 8 Sep — a question Pando could not read, and the turns that follow it.
--
-- The client: if a parent writes something and Pando cannot tell what they want,
-- it should **ask for the detail it needs** rather than go quiet, and the
-- exchange has to be read as one thing.
--
-- ## Why this needs a table at all
--
-- The classifier already takes a `recent` array of earlier turns — and nothing
-- has ever passed one, because there was nowhere to read them from.
-- `message_log` deliberately stores **no message bodies** (invariant 7 at the
-- schema level), so the conversation cannot be reconstructed from it, and that
-- is a property worth keeping rather than working around.
--
-- So the turns of one unresolved question live here and nowhere else: bounded,
-- attached to a person, deleted with them, and closed as soon as the question
-- can be read.
--
-- ## Deliberately not `sms_captures`, and not `answers`
--
-- `sms_captures` is a *recommendation being added* — a known script with a known
-- next step. This is the opposite: Pando does not know what it is collecting,
-- which is the whole reason it is asking. One table for both would need a column
-- meaning "which script" that is null for half its rows.
--
-- `answers` is a composed answer waiting for a person. There is no answer here
-- yet, and `answer_text` is NOT NULL for a good reason: that row is a promise
-- about what will be sent.
CREATE TABLE IF NOT EXISTS pending_questions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id  uuid NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  -- Every turn of this question, oldest first, including the one that could not
  -- be read. The classifier is given the tail of it and the answer path is given
  -- the whole thing joined up.
  turns      text[] NOT NULL DEFAULT '{}',
  -- How many times Pando has asked for more. Bounded in `lib/pending-question.ts`
  -- so a parent is never interrogated by a machine that cannot understand them.
  asks       integer NOT NULL DEFAULT 0,
  status     text NOT NULL DEFAULT 'open',
  is_test    boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pending_questions_status_check
    CHECK (status IN ('open', 'resolved', 'given_up')),
  -- An open row must hold something to be read together with the next message.
  -- Without this an empty one would swallow a message and add nothing.
  --
  -- `cardinality`, not `array_length`: the latter returns **NULL** for an empty
  -- array, so `array_length(turns, 1) >= 1` evaluates to NULL and a CHECK treats
  -- NULL as satisfied. Written that way first, and the constraint walk caught it
  -- accepting exactly the row it exists to refuse.
  CONSTRAINT pending_questions_turns_check
    CHECK (status <> 'open' OR cardinality(turns) >= 1),
  -- Bounded in the database as well as in the code: the window is small on
  -- purpose, and a row that grew without limit would be a transcript.
  CONSTRAINT pending_questions_window_check
    CHECK (cardinality(turns) <= 6)
);--> statement-breakpoint

COMMENT ON TABLE pending_questions IS
  'A question Pando could not classify, and the turns since. The only place SMS conversation text is kept, because message_log deliberately holds none. Closed as soon as the question can be read.';--> statement-breakpoint

COMMENT ON COLUMN pending_questions.asks IS
  'How many times Pando has asked for more detail. Capped, so an unreadable message ends with a person rather than with a loop.';--> statement-breakpoint

-- One open question per person. Two would make the next message ambiguous —
-- the same rule, for the same reason, as sms_captures_one_open.
CREATE UNIQUE INDEX IF NOT EXISTS pending_questions_one_open
  ON pending_questions (person_id)
  WHERE status = 'open';--> statement-breakpoint

CREATE INDEX IF NOT EXISTS pending_questions_person_idx
  ON pending_questions (person_id, updated_at DESC);

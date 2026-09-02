-- M10.2 — what a freshness ping actually asked about.
--
-- 10.3 has been sending "is X still worth recommending?" since 27 Aug and the
-- reply had nowhere to land: `message_log` records that a ping went out and
-- never *which record it was about*, so a "yes" could be received and not
-- attributed. Exactly the hole `answers.share_ids` filled for 9.1, one loop
-- later.
--
-- A table rather than a column on `shares`, because a ping is per (person,
-- record) and several people are asked about one record over time. It is also
-- the only place the difference between "asked and ignored" and "asked and told
-- no" is legible, and those mean very different things about a recommendation.
CREATE TABLE IF NOT EXISTS freshness_pings (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id  uuid NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  share_id   uuid NOT NULL REFERENCES shares(id) ON DELETE CASCADE,
  asked_at   timestamptz NOT NULL DEFAULT now(),
  answered_at timestamptz,
  -- NULL is "they did not reply", never "no". A silence says nothing about a
  -- recommendation, and recording it as a withdrawal would let inattention
  -- quietly retire records nobody complained about.
  still_good boolean
);--> statement-breakpoint

COMMENT ON TABLE freshness_pings IS
  'M10.2/10.3. One row per "is this still worth recommending?" put to one contributor about one record. still_good NULL means unanswered, never no.';--> statement-breakpoint

-- The job's own queue: the oldest unanswered ping per person.
CREATE INDEX IF NOT EXISTS freshness_pings_pending_idx
  ON freshness_pings (person_id, asked_at DESC)
  WHERE answered_at IS NULL;--> statement-breakpoint

-- M10.1 — a capture that arrives one text at a time.
--
-- The Seed Tool holds a part-finished card in the browser's local storage; over
-- SMS there is no browser, and the parent's next answer may arrive tomorrow. So
-- the half-built card lives here.
--
-- **Deliberately not `submissions`.** That table is the verbatim record of what
-- a parent typed on a finished card — the answer to "did they actually say
-- that" — and mixing part-finished rows into it would make that question
-- unanswerable. A capture graduates *into* the ordinary tables when it is done.
CREATE TABLE IF NOT EXISTS sms_captures (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id  uuid NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  -- Which question is outstanding. NULL once the capture is finished.
  step       text,
  -- What has been answered so far, keyed by step id.
  answers    jsonb NOT NULL DEFAULT '{}'::jsonb,
  status     text NOT NULL DEFAULT 'open',
  share_id   uuid REFERENCES shares(id) ON DELETE SET NULL,
  is_test    boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sms_captures_status_check
    CHECK (status IN ('open', 'saved', 'abandoned')),
  -- An open capture must know what it is waiting for, and a closed one must not
  -- claim to be waiting. Without this a finished capture keeps swallowing every
  -- later message the parent sends.
  CONSTRAINT sms_captures_step_check
    CHECK ((status = 'open') = (step IS NOT NULL))
);--> statement-breakpoint

COMMENT ON TABLE sms_captures IS
  'M10.1. A recommendation being added over SMS, one question at a time. Not submissions: that table is the verbatim record of a finished card.';--> statement-breakpoint

-- One open capture per person. Two at once would mean the next reply is
-- ambiguous, which is the same failure the one-question-at-a-time rule exists
-- to prevent.
CREATE UNIQUE INDEX IF NOT EXISTS sms_captures_one_open
  ON sms_captures (person_id)
  WHERE status = 'open';

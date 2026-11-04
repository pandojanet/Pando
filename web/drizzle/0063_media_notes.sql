-- What Pando made of a voice note (or a video's sound), a picture or a PDF, held only until the person
-- says it was read right (3 Nov).
--
-- The 30 Oct brief, item 2: a voice note or screenshot is read and the person
-- confirms it. The developer: confirm before the main flow, and keep no media —
-- Pando never copies it, and it is deleted at Twilio once the person has
-- answered (lib/server/media-note.ts). Its Twilio URL waits here until then.
--
-- The text has to live somewhere between "I heard: ... Is that right?" (or "I
-- read your picture as: ...") and the YES that sends it on: `message_log`
-- holds no bodies (invariant 7 at the schema level), and `pending_questions`
-- is a message Pando could not read — this one it read, and is asking about.
--
-- The text and the media URL are **cleared when the person answers** — yes,
-- no, or a typed message instead — so a row outlives its words: both are held
-- only while `status = 'pending'`. The kind, duration and confidence stay, as
-- counts, for the cost of reading them.
CREATE TABLE IF NOT EXISTS media_notes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id     uuid NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  kind          text NOT NULL,
  -- The words heard, or the message a picture was read as.
  text          text,
  -- Twilio's media URL, so the media can be deleted there once answered.
  media_url     text,
  status        text NOT NULL DEFAULT 'pending',
  duration_sec  numeric(7, 2),
  confidence    numeric(4, 3),
  is_test       boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  resolved_at   timestamptz,
  CONSTRAINT media_notes_kind_check
    CHECK (kind IN ('voice', 'image', 'file')),
  CONSTRAINT media_notes_status_check
    CHECK (status IN ('pending', 'confirmed', 'rejected', 'superseded', 'expired')),
  CONSTRAINT media_notes_text_pending
    CHECK ((status = 'pending') = (text IS NOT NULL)),
  CONSTRAINT media_notes_media_pending
    CHECK (status = 'pending' OR media_url IS NULL),
  CONSTRAINT media_notes_text_length
    CHECK (text IS NULL OR char_length(text) BETWEEN 1 AND 8000)
);--> statement-breakpoint

-- One read-back waiting per person: the next message answers the newest.
CREATE UNIQUE INDEX IF NOT EXISTS media_notes_one_pending
  ON media_notes (person_id)
  WHERE status = 'pending';--> statement-breakpoint

ALTER TABLE media_notes ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON media_notes FROM anon, authenticated;--> statement-breakpoint

COMMENT ON TABLE media_notes IS
  'A voice note or picture received over MMS/RCS: what Pando read from it and its Twilio media URL while the person is asked "is that right?", then counts only. No audio or image is ever stored by Pando.';

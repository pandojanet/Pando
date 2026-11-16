-- The weekly digest, answered (11 Nov): a parent picks events from it by number,
-- gets their details and a "remind you on the day?", is reminded on the morning
-- of the event, and is asked the day after how it was — by buttons only.
--
-- Two changes:
--   * digest_sends.item_ids — the items each family was sent, in the order they
--     were numbered, so a reply of "2" means the second item of THAT text. A
--     family's text mixes its group's edition with other groups' items for its
--     children (`poolForFamily`), so the edition alone cannot say what "2" was.
--   * digest_interests — one row per family and item they picked: whether they
--     want the reminder, the moment it is due (two hours before the event's
--     stated start, never before 8:00, else 8:00) and when it went, the moment
--     the feedback question is due (10:00 the day after), went and was answered.
--     The rows are the scheduled jobs: one sweep every five minutes sends what
--     has come due (`digest_reminders`, `digest_feedback`). The answer is one of three
--     buttons, never free text, so nothing a parent writes is kept here.
--
-- Deleted with the person (DELETE, cascade) and with the item's edition.
ALTER TABLE digest_sends ADD COLUMN IF NOT EXISTS item_ids uuid[] NOT NULL DEFAULT '{}';--> statement-breakpoint

CREATE TABLE IF NOT EXISTS digest_interests (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id          uuid NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  item_id            uuid NOT NULL REFERENCES digest_items(id) ON DELETE CASCADE,
  -- picked → a YES makes it going, a NO declined.
  status             text NOT NULL DEFAULT 'picked',
  remind_on          date,
  remind_at          timestamptz,
  reminded_at        timestamptz,
  ask_at             timestamptz,
  feedback_asked_at  timestamptz,
  feedback           text,
  feedback_at        timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT digest_interests_status_check CHECK (status IN ('picked', 'going', 'declined')),
  CONSTRAINT digest_interests_feedback_check CHECK (feedback IS NULL OR feedback IN ('loved', 'ok', 'didnt_go')),
  CONSTRAINT digest_interests_once UNIQUE (person_id, item_id)
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS digest_interests_remind_idx ON digest_interests (remind_at) WHERE reminded_at IS NULL AND status = 'going';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS digest_interests_feedback_idx ON digest_interests (ask_at) WHERE feedback_asked_at IS NULL AND status = 'going';--> statement-breakpoint

ALTER TABLE digest_interests ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON digest_interests FROM anon, authenticated;

-- 12.3 — START has to be recordable, not just STOP.
--
-- `sms_opt_outs` held `phone`, `keyword` and `opted_out_at`, which can say
-- somebody left and can never say they came back. 12.3's own words are "START
-- re-opts them in with a fresh timestamp", and 12.6 tests exactly that: "STOP
-- then START resumes with a new consent timestamp".
--
-- ## Why two timestamps rather than a status
--
-- Because the question is always "which happened last", and a status column is a
-- third thing somebody has to keep correct. With both dates the rule is one
-- comparison — opted out unless `opted_in_at` is later — and it cannot disagree
-- with itself. It is also the artefact a TCPA complaint actually tests: not "were
-- they opted in", but "when, and what happened before that".
--
-- The row is never deleted. A person who opts out, back in, and out again is one
-- row with a history, and the last pair of dates is the answer.
ALTER TABLE sms_opt_outs ADD COLUMN IF NOT EXISTS opted_in_at timestamptz;--> statement-breakpoint

COMMENT ON COLUMN sms_opt_outs.opted_in_at IS
  'When START/UNSTOP last re-opted this number in. Opted out when opted_out_at is set and opted_in_at is null or earlier. Never a status column: which is later is the whole question.';--> statement-breakpoint

-- `keyword` is NOT NULL and records what they actually texted, which is the
-- evidence — STOP, STOPALL, UNSUBSCRIBE, CANCEL, END and QUIT are all opt-outs
-- and a complaint may quote the exact word. Existing rows predate the column
-- being written by our own code, so they keep whatever they have.
ALTER TABLE sms_opt_outs ALTER COLUMN keyword SET DEFAULT 'STOP';

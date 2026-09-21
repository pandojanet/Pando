-- 0048 — the phone verification that survives a deploy.
--
-- `lib/server/verify.ts` has kept its state in `globalThis` since 5 Aug, and its
-- own header has described this table since the day it was written: *"when this
-- moves to Supabase it becomes a `phone_verifications` table with the same
-- fields and the same TTL."* The trade was stated and was right for a
-- five-minute code — it survives a page reload and not a deploy.
--
-- What made it wrong is that the code stopped being a five-minute thing. On
-- 12 Aug it moved to the front of the flow and a *confirmed* number began
-- standing for twelve hours (VERIFICATION_SESSION_HOURS), because it now opens a
-- whole visit rather than ending one. This app ships several times a day, so in
-- practice that promise was kept for however long it was between deploys: a
-- parent with a saved, verified profile came back to change one answer and was
-- asked for a fresh code, with nothing on screen able to say why. Reported
-- twice.
--
-- Two smaller things went with it, and they are the §19 half rather than the
-- convenience half:
--
--   * the **15-minute lock** after three wrong guesses, and
--   * the **five-codes-an-hour** ceiling on a number,
--
-- both of which a deploy reset. Neither is a nuisance: the first is the only
-- thing standing between a six-digit code and somebody working through it, and
-- the second is what stops one number being texted repeatedly at our expense
-- and our carrier reputation. A restart cleared both.

CREATE TABLE IF NOT EXISTS "phone_verifications" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "phone" text NOT NULL,
  -- A keyed hash, never the code: a dump of this table must not be a list of
  -- live codes. Same rule the in-memory version already followed.
  "code_hash" text NOT NULL,
  -- When the *code* dies. A confirmed row outlives it by the session window,
  -- which the reader adds rather than the column carrying two meanings.
  "expires_at" timestamptz NOT NULL,
  -- One timestamp per code sent, so the per-hour ceiling on a number can be
  -- counted across every session and cookie that number ever had. A bare
  -- counter cannot express "in the last hour", and a second table would be a
  -- log of what a phone number did, which this schema does not keep.
  "sent_at" timestamptz[] DEFAULT '{}' NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  -- Set once, when they got it right. This is what the submit gate reads.
  "verified_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "phone_verifications_attempts_check" CHECK ("attempts" >= 0),
  -- A row exists because a code was sent, so it always carries at least one.
  CONSTRAINT "phone_verifications_sent_check" CHECK (cardinality("sent_at") >= 1)
);--> statement-breakpoint

-- Both reads are by phone: the hourly ceiling, and the most recent attempt.
CREATE INDEX IF NOT EXISTS "phone_verifications_phone_idx"
  ON "phone_verifications" ("phone", "created_at" DESC);--> statement-breakpoint

-- ⚠ Keyed on the **phone**, not on a verification, and that is the whole point
-- of §19's lock: on the verification it is worth nothing, because dropping the
-- cookie asks for a fresh one and three more guesses. One row per number, so a
-- browser cannot reset it and neither can a deploy.
CREATE TABLE IF NOT EXISTS "phone_verification_locks" (
  "phone" text PRIMARY KEY NOT NULL,
  "until" timestamptz NOT NULL
);

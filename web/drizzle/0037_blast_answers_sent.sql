-- M7's exit: when the approved answers actually reached the asker.
--
-- Reviewed end to end on 7 Sep, the blast chain had no way out. A parent could
-- pay $15, five parents could answer, an admin could approve every reply --
-- and the asker would hear nothing. `blast.fulfil` set a status and a note;
-- `blast_response.approve` wrote the reply into the graph. Neither addressed
-- the person who asked, and the only outbound path to a parent was
-- `answer.send`, whose rows are created by the *inbound* pipeline.
--
-- `blast.deliver` is that exit, and this column is what makes it a state with
-- a beginning and an end rather than a button somebody has to remember
-- pressing. Exactly the argument `credit_granted_at` records one migration ago
-- (0033), and the one 14.2 makes for the answer queue: an approved answer
-- nobody sent is a parent still waiting, so the page has to be able to see the
-- difference.
--
-- Deliberately NOT folded into `fulfilled_at`. Those are two decisions taken at
-- different moments and often by different people -- marking an Ask answered is
-- a judgement with a note, delivering is a carrier round trip that can fail and
-- be retried without anybody re-judging anything. One column would make a
-- failed send look like an un-made decision, which is the fault 14.2 split
-- `answer.approve` from `answer.send` to avoid.
--
-- Nullable, and null keeps its plain meaning -- not sent. That is the direction
-- that matters: a deployment with no messaging provider delivers nothing, and
-- the page must read that as "the asker is still waiting" rather than as done.
ALTER TABLE blasts
  ADD COLUMN IF NOT EXISTS answers_sent_at timestamp with time zone;
--> statement-breakpoint

COMMENT ON COLUMN blasts.answers_sent_at IS
  'When the approved replies were texted to the asker (blast.deliver). Null means they were not.';

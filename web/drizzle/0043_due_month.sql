-- 16 Sep — the month picker follows the child's status.
--
--   "коли дитина Expecting, то показувати цей і наступні місяці в році, а не
--    ті, що пройшли. Коли дитина народилась - показувати, які місяці пройшли
--    з теперішнім, а не наступні"
--
-- A born child's month is `birth_month` (0031), and that constraint is right to
-- refuse a month on an expecting row: a birth month there would claim a baby
-- was born in a month it has not reached. What an expecting parent is telling
-- us is a different fact — when the baby is due — so it gets its own column
-- rather than a relaxed constraint on the old one.
--
-- Optional, like the birth month: the year stays the required tap.
ALTER TABLE children ADD COLUMN IF NOT EXISTS due_month integer;--> statement-breakpoint

ALTER TABLE children DROP CONSTRAINT IF EXISTS children_due_month_check;--> statement-breakpoint
ALTER TABLE children ADD CONSTRAINT children_due_month_check
  CHECK (due_month IS NULL OR (due_month >= 1 AND due_month <= 12));--> statement-breakpoint

-- A due month belongs to an expecting child and to nothing else.
ALTER TABLE children DROP CONSTRAINT IF EXISTS children_due_month_needs_expecting;--> statement-breakpoint
ALTER TABLE children ADD CONSTRAINT children_due_month_needs_expecting
  CHECK (due_month IS NULL OR (expecting AND due_year IS NOT NULL));--> statement-breakpoint

COMMENT ON COLUMN children.due_month IS
  '1-12, optional, expecting rows only. The month the parent said the baby is due; due_year_precision is then stated.';

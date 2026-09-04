-- 3 Sep — her instruction: collect month and year, not a date of birth.
--
--   "Вік дітей (+Expecting): Замість точної дати народження збиратимуть лише
--    місяць і рік."
--
-- ## What was already true, and what this adds
--
-- Nothing in Pando has ever asked for a date of birth — `grep` finds no date
-- input anywhere, and the screen reads "Your kids — tap a birth year for each
-- one". So her sentence is not a reduction from a full date; read as intent it
-- is **month and year is what we should hold**, and the year alone is one field
-- short of that.
--
-- ## Why the month is worth a column rather than being waved away
--
-- Age bands. `matching.ts` recomputes a child's band from the birth year on
-- every run — deliberately, because a stored band goes stale — and a year is a
-- blunt instrument at exactly the boundaries that matter to a parent: a child
-- born December 2019 and one born January 2019 are a school year apart, and
-- "who has a child the same stage as mine" is the strongest signal in the
-- graph after a shared school. A month makes that comparison right instead of
-- roughly right.
--
-- ## Nullable, and that is the design
--
-- The child-ages screen is one of only **two required questions** in the whole
-- profile, and the tap-first rule is that every extra required field is a
-- measurable drop-off. So the year stays the required tap and the month is
-- offered beside it as optional — a parent who skips it is not blocked and
-- their band is computed from the year exactly as it is today.
--
-- Which means every consumer must keep working with a null here, and they do:
-- nothing reads this column yet. It is the record; using it to sharpen the band
-- is a separate change, and doing that first would have meant a migration whose
-- effect nobody could see.
ALTER TABLE children ADD COLUMN IF NOT EXISTS birth_month integer;--> statement-breakpoint

ALTER TABLE children DROP CONSTRAINT IF EXISTS children_birth_month_check;--> statement-breakpoint
ALTER TABLE children ADD CONSTRAINT children_birth_month_check
  CHECK (birth_month IS NULL OR (birth_month >= 1 AND birth_month <= 12));--> statement-breakpoint

-- A month belongs to a birth year, not to a due date. An expecting child has no
-- birth year (the `year_shape` CHECK enforces that), so it can have no birth
-- month either — and letting it would produce a row claiming a baby was born in
-- a month it has not reached.
ALTER TABLE children DROP CONSTRAINT IF EXISTS children_month_needs_year;--> statement-breakpoint
ALTER TABLE children ADD CONSTRAINT children_month_needs_year
  CHECK (birth_month IS NULL OR (NOT expecting AND birth_year IS NOT NULL));--> statement-breakpoint

COMMENT ON COLUMN children.birth_month IS
  '1-12, optional. The year is the required tap and this sharpens the age band at a year boundary (a December and a January child are a school year apart). Null wherever a parent skipped it, and every consumer must work from the year alone.';

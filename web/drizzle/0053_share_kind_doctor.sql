-- Doctors & medical providers become a fifth contribution kind (8 Oct, the
-- client's card: "Which practice or doctor? … Is it your child's doctor? …").
--
-- A file of its own: `ALTER TYPE … ADD VALUE` cannot be *used* in the transaction
-- that adds it, and every pending migration runs in one transaction (db-migration
-- skill, rule 6). 0054 beside it only adds columns and never reads the value, so
-- the two can apply in one run; nothing in a migration may insert a 'doctor' row
-- until a later run.
ALTER TYPE share_kind ADD VALUE IF NOT EXISTS 'doctor';

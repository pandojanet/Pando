-- Doctors in SMS answers (21 Oct): their freshness policy.
--
-- Until today a doctor record was never answered with (8 Oct), so it had no
-- `freshness_policy` row and fell to the strictest fallback. A family keeps a
-- pediatrician or a dentist for years, so a doctor ages slower than a class:
-- "ageing" after 180 days, "old" after 365 — the same as places and tips.
-- Idempotent, so an environment that already has a row keeps its own numbers.
INSERT INTO freshness_policy (kind, ageing_days, stale_days)
VALUES ('doctor', 180, 365)
ON CONFLICT (kind) DO NOTHING;

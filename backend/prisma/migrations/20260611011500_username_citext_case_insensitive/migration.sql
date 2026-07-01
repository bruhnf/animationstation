-- Case-insensitive username uniqueness ("Bruhn" and "bruhn" may not coexist).
-- citext makes equality comparisons — and therefore the existing unique index
-- on username — case-insensitive at the database level, so every lookup and
-- constraint inherits the behavior without app-side normalization.
-- Verified before this migration: no case-variant duplicates on dev or prod.
CREATE EXTENSION IF NOT EXISTS citext;

ALTER TABLE "users" ALTER COLUMN "username" TYPE CITEXT;

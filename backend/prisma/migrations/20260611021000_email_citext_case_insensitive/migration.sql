-- Case-insensitive email uniqueness and lookups, matching the username
-- treatment ("Bruhn@x.com" and "bruhn@x.com" may not coexist, and either
-- form matches at login / forgot-password / resend-verification).
-- NULL emails (guest accounts) are unaffected: Postgres permits multiple
-- NULLs under a unique index regardless of column type.
-- Verified before this migration: no case-variant duplicates on dev or prod.
-- (citext extension already created by 20260611011500.)
ALTER TABLE "users" ALTER COLUMN "email" TYPE CITEXT;

-- Anti-farming: a canonical form of `email` (lowercased, "+tag" subaddress
-- stripped, Gmail/googlemail dots removed) so aliased addresses from a single
-- inbox can't be used to mint multiple accounts and farm welcome + referral
-- credits. Mirrors utils/emailNormalize.ts. Display/transactional mail keeps
-- using the verbatim `email`; this column is only for duplicate detection.
-- (citext extension already created by an earlier migration.)
ALTER TABLE "users" ADD COLUMN "emailNormalized" CITEXT;

-- Backfill existing real accounts (guests have NULL email → stay NULL).
UPDATE "users"
SET "emailNormalized" =
  CASE
    WHEN lower(split_part(email::text, '@', 2)) IN ('gmail.com', 'googlemail.com')
      THEN replace(regexp_replace(lower(split_part(email::text, '@', 1)), '\+.*$', ''), '.', '')
           || '@' || lower(split_part(email::text, '@', 2))
    ELSE regexp_replace(lower(split_part(email::text, '@', 1)), '\+.*$', '')
         || '@' || lower(split_part(email::text, '@', 2))
  END
WHERE email IS NOT NULL AND position('@' in email::text) > 0;

-- Enforce dedup for real accounts (multiple NULLs allowed for guests).
CREATE UNIQUE INDEX "users_emailNormalized_key" ON "users"("emailNormalized");

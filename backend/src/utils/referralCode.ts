import { randomInt } from 'crypto';

// Referral codes are short, human-shareable, and unambiguous: uppercase, with
// the visually-confusable characters removed (no 0/O, 1/I/L). Pure + seedable
// so the generation logic is unit-testable. Collisions are handled by the
// caller (retry on the unique-constraint).
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const REFERRAL_CODE_LENGTH = 7;

export function generateReferralCode(rand: (max: number) => number = randomInt): string {
  let out = '';
  for (let i = 0; i < REFERRAL_CODE_LENGTH; i += 1) {
    out += ALPHABET[rand(ALPHABET.length)];
  }
  return out;
}

// Normalize user-entered codes (trim, uppercase, strip spaces/dashes) so
// "abc-1234" pasted from a message still resolves.
export function normalizeReferralCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const cleaned = raw
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '');
  if (cleaned.length === 0 || cleaned.length > 20) return null;
  return cleaned;
}

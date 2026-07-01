// Email normalization for anti-abuse (credit-farming) deduplication.
//
// A single inbox can otherwise mint unlimited "distinct" accounts — and thus
// unlimited welcome + referral credits — using provider aliasing:
//   • "+tag" subaddressing: a+1@x.com, a+2@x.com all deliver to a@x.com
//   • Gmail dot-insensitivity: a.b@gmail.com === ab@gmail.com
//
// `normalizeEmail` collapses those variants to one canonical string so the
// signup/claim uniqueness check can treat them as the same account. Pure +
// dependency-free so it's unit-testable in isolation (see emailNormalize.test.ts).
//
// NOTE: this is a deliberately conservative folding. We always strip a "+tag"
// suffix (RFC 5233 subaddressing — distinct +tags are virtually never used to
// register genuinely separate accounts), and additionally strip dots for Gmail.
// We do NOT touch other provider-specific quirks. The original address is still
// stored verbatim in User.email (for display + transactional mail); this value
// lives in a separate User.emailNormalized column used only for dedup.

const GMAIL_DOMAINS = new Set(['gmail.com', 'googlemail.com']);

/**
 * Canonicalize an email for duplicate detection. Returns null when the input is
 * not a usable email (not a string, or missing a single "@" with non-empty
 * local + domain parts) — callers should treat null as "nothing to dedup on"
 * and fall back to the raw value's own uniqueness.
 */
export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim().toLowerCase();
  const at = trimmed.lastIndexOf('@');
  if (at <= 0 || at === trimmed.length - 1) return null; // no local or no domain

  let local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);
  // Reject anything with a stray "@" or whitespace in either part — not a
  // single well-formed address, so there's nothing meaningful to canonicalize.
  if (local.includes('@') || local.includes(' ')) return null;
  if (domain.includes('@') || domain.includes(' ')) return null;

  // Drop everything from the first "+" (subaddressing) for ALL providers.
  const plus = local.indexOf('+');
  if (plus !== -1) local = local.slice(0, plus);

  // Gmail (and its googlemail alias) ignore dots in the local part.
  if (GMAIL_DOMAINS.has(domain)) {
    local = local.replace(/\./g, '');
  }

  if (local.length === 0) return null; // e.g. "+tag@x.com" → empty local
  return `${local}@${domain}`;
}

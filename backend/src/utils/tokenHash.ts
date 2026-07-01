import crypto from 'crypto';

/**
 * Hash a refresh token for storage / lookup.
 *
 * Refresh tokens are JWTs signed with JWT_REFRESH_SECRET, so they already carry
 * an unguessable signature — a deterministic SHA-256 (no per-row salt) is enough
 * and, crucially, keeps the value usable as a unique lookup key. We store only
 * this hash in the RefreshToken table so a database leak cannot yield tokens that
 * are directly replayable against the API.
 */
export const hashRefreshToken = (raw: string): string =>
  crypto.createHash('sha256').update(raw).digest('hex');

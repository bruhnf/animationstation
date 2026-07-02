import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';
import jwt, { SignOptions } from 'jsonwebtoken';
import { env } from '../config/env';
import type { UserTier } from '@prisma/client';

interface AccessTokenPayload {
  userId: string;
  // Null for guest accounts, which have no email until they convert.
  email: string | null;
  tier: UserTier;
  credits: number;
  // True for anonymous guest sessions. Baked into the token so blockGuests can
  // gate writes without a DB hit. Because it lives in the token, converting a
  // guest to a real user must invalidate their tokens (claimGuest deletes the
  // refresh-token family, forcing a fresh login that mints a token with
  // isGuest=false).
  isGuest: boolean;
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing authorization header' });
    return;
  }
  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, env.jwtSecret) as AccessTokenPayload;
    req.user = payload;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

/**
 * Populates req.user if a valid Bearer token is present, but does not block requests
 * that are missing or have an invalid token. Use for routes that vary their response
 * based on whether a viewer is signed in (e.g., public profile shows isFollowing).
 */
export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    next();
    return;
  }
  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, env.jwtSecret) as AccessTokenPayload;
    req.user = payload;
  } catch {
    // Ignore — proceed without auth
  }
  next();
}

/**
 * Rejects guest (anonymous) sessions with 403 GUEST_SIGNUP_REQUIRED. Mount AFTER
 * requireAuth so req.user is populated. Used to gate social write actions
 * (like/comment/follow/report/block/notifications) that should prompt a guest to
 * sign up. Reads (feed, profiles, comments) and the guest's own creation path
 * (upload, ai-consent, transform submit) are intentionally NOT gated. Tokens minted
 * before isGuest existed have it undefined → treated as real users.
 */
export function blockGuests(req: Request, res: Response, next: NextFunction): void {
  if (req.user?.isGuest) {
    res.status(403).json({ error: 'GUEST_SIGNUP_REQUIRED' });
    return;
  }
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const key = req.headers['x-admin-key'];
  if (key !== env.adminApiKey) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }
  next();
}

export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, env.jwtSecret, { expiresIn: env.jwtExpiresIn } as SignOptions);
}

export function signRefreshToken(userId: string): string {
  // jti makes every refresh token unique even when two are issued in the same
  // second (JWT `iat` is only second-granular). Rotation depends on this: without
  // a jti, a freshly rotated token could be byte-identical to the one it replaced,
  // so the "new" token would collide with the old hash and rotation would be a
  // silent no-op. The claim is ignored by verifyRefreshToken (extra claims are
  // harmless), so tokens minted before this change still verify normally.
  return jwt.sign({ userId, jti: randomUUID() }, env.jwtRefreshSecret, {
    expiresIn: env.jwtRefreshExpiresIn,
  } as SignOptions);
}

export function verifyRefreshToken(token: string): { userId: string } {
  return jwt.verify(token, env.jwtRefreshSecret) as { userId: string };
}

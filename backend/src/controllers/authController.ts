import { Request, Response } from 'express';
import type { User } from '@prisma/client';
import { randomInt } from 'crypto';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { env } from '../config/env';
import prisma from '../lib/prisma';
import { hashPassword, verifyPassword, DUMMY_PASSWORD_HASH } from '../utils/password';
import { hashRefreshToken } from '../utils/tokenHash';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../middleware/auth';
import {
  sendVerificationEmail,
  sendPasswordResetEmail,
  sendNewUserAlert,
} from '../services/emailService';
import { adminDashboardUrl } from '../utils/adminUrl';
import { recordLoginLocation } from '../services/locationService';
import { logAuth, logSecurity, createChildLogger } from '../services/logger';
import { isAdminEmail } from '../utils/admin';
import { isUniqueConstraintError } from '../utils/prismaErrors';
import { normalizeEmail } from '../utils/emailNormalize';
import { presignUserPhotos } from '../services/imageUrlService';
import { getGuestCreditGrant, getSignupCreditGrant } from '../services/appSettingsService';
import { recordPendingReferral, processReferralReward } from '../services/referralService';

const log = createChildLogger('AuthController');

// Request-body schemas live in validation/authSchemas.ts (dependency-free) so
// unit tests can exercise them without this module's prisma/email/env imports.
import { signupSchema, loginSchema } from '../validation/authSchemas';

// Generate a unique user####### handle (7 digits), retrying on the rare
// collision before falling back to a longer suffix. Used for guest accounts
// and for email+password-only signups that don't pick a username up front.
async function generateUniqueUsername(): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = `user${randomInt(1_000_000, 10_000_000)}`;
    const taken = await prisma.user.findFirst({
      where: { username: { equals: candidate, mode: 'insensitive' } },
    });
    if (!taken) return candidate;
  }
  return `user${randomInt(1_000_000, 10_000_000)}${randomInt(100, 1000)}`;
}

export async function signup(req: Request, res: Response): Promise<void> {
  const parse = signupSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: parse.error.flatten() });
    return;
  }
  const {
    firstName,
    lastName,
    username: requestedUsername,
    email,
    password,
    referralCode,
  } = parse.data;

  // Anti-farming: canonicalize the email so "+tag" aliases and Gmail-dot
  // variants of one inbox can't each register a fresh account (and farm the
  // welcome + referral credit grants). Stored verbatim in `email`; deduped on
  // `emailNormalized`. See utils/emailNormalize.ts.
  const emailNormalized = normalizeEmail(email);

  // Email + username matches are case-insensitive ("Bruhn" may not join when
  // "bruhn" exists) — backed at the DB level by the citext column type, but
  // kept explicit here so the check holds even on a box that hasn't migrated.
  // The emailNormalized clause additionally catches aliased duplicates.
  const existing = await prisma.user.findFirst({
    where: {
      OR: [
        { email: { equals: email, mode: 'insensitive' } },
        ...(emailNormalized ? [{ emailNormalized }] : []),
        ...(requestedUsername
          ? [{ username: { equals: requestedUsername, mode: 'insensitive' as const } }]
          : []),
      ],
    },
  });
  if (existing) {
    logAuth('signup', {
      email,
      success: false,
      reason:
        existing.email?.toLowerCase() === email.toLowerCase() ? 'email_exists' : 'username_exists',
      ip: req.ip,
    });
    // Generic message so the response can't be used to enumerate which emails /
    // usernames are already registered. The specific reason is still logged
    // server-side above for support/debugging.
    res.status(409).json({ error: 'That email or username is already taken.' });
    return;
  }

  const username = requestedUsername ?? (await generateUniqueUsername());
  const passwordHash = await hashPassword(password);
  const verifyToken = uuidv4();
  const verifyTokenExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000);

  let user: User;
  try {
    user = await prisma.user.create({
      data: {
        firstName,
        lastName,
        username,
        email,
        emailNormalized,
        passwordHash,
        verifyToken,
        verifyTokenExpiry,
      },
    });
  } catch (err) {
    // Concurrent signup lost the race past the pre-check above — same outcome,
    // same 409, instead of surfacing the unique-index violation as a 500.
    if (isUniqueConstraintError(err)) {
      logAuth('signup', { email, success: false, reason: 'unique_race', ip: req.ip });
      res.status(409).json({ error: 'That email or username is already taken.' });
      return;
    }
    throw err;
  }

  // Capture a pending referral if they signed up with someone's code. Best-
  // effort; never blocks signup (the reward fires at email verification).
  await recordPendingReferral(user.id, referralCode);

  await sendVerificationEmail(email, verifyToken);

  logAuth('signup', {
    userId: user.id,
    email,
    success: true,
    ip: req.ip,
    userAgent: req.headers['user-agent'],
  });

  res.status(201).json({
    message: 'Account created. Check your email to verify your account.',
    userId: user.id,
  });
}

// The welcome bonus (credits granted ONCE when a real account verifies its
// email) is admin-configurable at runtime via the Admin Dashboard → Settings
// tab (stored in AppSettings, read through getSignupCreditGrant). Default 10;
// set to 0 to discontinue the offer. This lets the "free credits when you join"
// promotion be turned into a limited-time campaign — raised, lowered, or ended —
// without a redeploy or an app rebuild.

export async function verifyEmail(req: Request, res: Response): Promise<void> {
  const { token } = req.params;
  const user = await prisma.user.findFirst({ where: { verifyToken: token } });

  if (!user || (user.verifyTokenExpiry && user.verifyTokenExpiry < new Date())) {
    res.status(400).send('<h2>Invalid or expired verification link.</h2>');
    return;
  }

  // Read the live grant once, before the transaction. 0 = the welcome bonus is
  // discontinued: the email still verifies, but no credits are granted and no
  // GRANT transaction is written.
  const signupGrant = await getSignupCreditGrant();

  // Consume the token CONDITIONALLY (WHERE verifyToken still matches) so the
  // welcome grant fires at most once. The findFirst above and this write are
  // not one atomic step: concurrent hits on the same link — a double-click,
  // or an email client prefetching the URL before the user taps it — would
  // all pass the findFirst and each grant the bonus (demonstrated empirically
  // in scripts/raceChecks.mjs). With the conditional update, the first commit
  // clears the token and every racer matches zero rows.
  const granted = await prisma.$transaction(async (tx) => {
    const consumed = await tx.user.updateMany({
      // `verified: false` is belt-and-suspenders: the welcome bonus can fire at
      // most once per account even if some future path were to hand an already-
      // verified user a fresh verifyToken (today resendVerification refuses
      // verified users and claimGuest refuses non-guests, so it can't).
      where: { id: user.id, verifyToken: token, verified: false },
      data: {
        verified: true,
        verifyToken: null,
        verifyTokenExpiry: null,
        ...(signupGrant > 0 ? { credits: { increment: signupGrant } } : {}),
      },
    });
    if (consumed.count === 0) return false;
    if (signupGrant > 0) {
      await tx.creditTransaction.create({
        data: {
          userId: user.id,
          type: 'GRANT',
          amount: signupGrant,
          description: 'Welcome bonus — email verified',
        },
      });
    }
    return true;
  });

  if (!granted) {
    // A concurrent request already consumed the token — the account is
    // verified and the bonus was granted exactly once. Land on the same
    // success page; from the user's perspective both clicks worked.
    res.redirect('/verified');
    return;
  }

  // Referral reward: if this user signed up with someone's code, pay BOTH sides
  // now (once). Self-contained + idempotent — never breaks verification.
  await processReferralReward(user.id);

  // Admin heads-up: a verified email is the moment a real, reachable user
  // exists (raw signups and guests are noise — see TODOS §1.5 B1). Fire-and-
  // forget and fully self-contained: an alert failure must never break the
  // user's verification. The token consume above is atomic, so this fires
  // exactly once per user.
  void (async () => {
    try {
      if (env.adminEmails.length === 0) return;
      const [totalUsers, verifiedUsers] = await Promise.all([
        prisma.user.count({ where: { isGuest: false } }),
        prisma.user.count({ where: { isGuest: false, verified: true } }),
      ]);
      // deviceId stays set on a guest row through conversion and is never set
      // by direct app/web signups, so it distinguishes the signup path.
      const signupPath = user.deviceId ? ('guest_conversion' as const) : ('direct' as const);
      const adminUrl = adminDashboardUrl(env.appUrl);
      await Promise.allSettled(
        env.adminEmails.map((to) =>
          sendNewUserAlert(to, {
            userId: user.id,
            username: user.username,
            email: user.email,
            signupPath,
            totalUsers,
            verifiedUsers,
            adminUrl,
          }),
        ),
      );
      log.info('New-user alert emailed to admins', { userId: user.id, signupPath });
    } catch (alertErr) {
      log.error('Failed to send new-user alert', {
        userId: user.id,
        error: (alertErr as Error).message,
      });
    }
  })();

  // Redirect to a small success page rather than the bare `tryon://` deep
  // link. The deep link alone breaks on desktop browsers (no scheme handler =
  // blank "can't open URL" screen) and even on mobile shows an ugly system
  // prompt before opening the app. The /verified page renders a clear success
  // state and an "Open the TryOn app" button that triggers the deep link.
  res.redirect('/verified');
}

export async function login(req: Request, res: Response): Promise<void> {
  const parse = loginSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: parse.error.flatten() });
    return;
  }
  const { email, password } = parse.data;
  const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0] ?? req.ip ?? '0.0.0.0';

  const user = await prisma.user.findUnique({ where: { email } });
  // Always run a bcrypt comparison — against the real hash if the user exists,
  // otherwise against a constant dummy hash. This pays the same CPU cost either
  // way, so response time can't be used to tell whether an email is registered.
  // A guest row has email=null so it can never be matched here; the extra
  // passwordHash null-coalesce also covers any guest that somehow lacked a hash.
  const passwordOk = await verifyPassword(password, user?.passwordHash ?? DUMMY_PASSWORD_HASH);
  if (!user || user.isGuest || !passwordOk) {
    logAuth('failed_login', {
      email,
      success: false,
      reason: 'invalid_credentials',
      ip,
      userAgent: req.headers['user-agent'],
    });
    res.status(401).json({ error: 'Invalid email or password' });
    return;
  }

  if (!user.verified) {
    logAuth('failed_login', {
      email,
      userId: user.id,
      success: false,
      reason: 'email_not_verified',
      ip,
    });
    res.status(403).json({
      error: 'EMAIL_NOT_VERIFIED',
      message: 'Please verify your email before logging in.',
    });
    return;
  }

  const accessToken = signAccessToken({
    userId: user.id,
    email: user.email,
    tier: user.tier,
    credits: user.credits,
    isGuest: user.isGuest,
  });
  const rawRefresh = signRefreshToken(user.id);
  const refreshExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  // Store only the hash — the raw token is returned to the client below but
  // never persisted, so a DB leak can't yield replayable refresh tokens.
  await prisma.refreshToken.create({
    data: { userId: user.id, token: hashRefreshToken(rawRefresh), expiresAt: refreshExpiry },
  });

  // Housekeeping: purge this user's already-expired refresh tokens so the table
  // doesn't accumulate dead rows. Fire-and-forget — a cleanup failure must never
  // block login.
  prisma.refreshToken
    .deleteMany({ where: { userId: user.id, expiresAt: { lt: new Date() } } })
    .catch((err) => {
      log.error('Failed to purge expired refresh tokens', { userId: user.id, error: err.message });
    });

  // Record location in background - errors are logged by locationService.
  // `email` (the validated login input) is non-null here; user.email is now
  // typed string|null because of guest accounts.
  recordLoginLocation(user.id, ip, 'login', email).catch((err) => {
    log.error('Failed to record login location', { userId: user.id, error: err.message });
  });

  logAuth('login', {
    userId: user.id,
    email,
    success: true,
    ip,
    userAgent: req.headers['user-agent'],
  });

  const presignedPhotos = await presignUserPhotos({
    avatarUrl: user.avatarUrl,
    fullBodyUrl: user.fullBodyUrl,
    mediumBodyUrl: user.mediumBodyUrl,
  });

  res.json({
    accessToken,
    refreshToken: rawRefresh,
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
      tier: user.tier,
      credits: user.credits,
      tryOnCount: user.tryOnCount,
      verified: user.verified,
      bio: user.bio,
      avatarUrl: presignedPhotos.avatarUrl,
      fullBodyUrl: presignedPhotos.fullBodyUrl,
      mediumBodyUrl: presignedPhotos.mediumBodyUrl,
      followingCount: user.followingCount,
      followersCount: user.followersCount,
      likesCount: user.likesCount,
      aiProcessingConsentAt: user.aiProcessingConsentAt,
      isAdmin: isAdminEmail(user.email),
    },
  });
}

// Mint an anonymous guest account on first app open. The guest carries real JWT
// tokens (so feed/profile/comment reads work) but is rejected from social writes
// by blockGuests, and their try-on results are forced private until they convert
// via claimGuest. App Store 5.1.1(v): lets users experience the app without a
// forced sign-in wall.
// Mint fresh access+refresh tokens for a guest User row and return the standard
// guest session payload. Shared by the create-new and reuse-existing paths of
// createGuest. Presigns any body photos the guest already has (a reused guest
// may have uploaded some), so the client gets usable URLs.
async function issueGuestSession(res: Response, user: User): Promise<void> {
  const accessToken = signAccessToken({
    userId: user.id,
    email: null,
    tier: user.tier,
    credits: user.credits,
    isGuest: true,
  });
  const rawRefresh = signRefreshToken(user.id);
  const refreshExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  await prisma.refreshToken.create({
    data: { userId: user.id, token: hashRefreshToken(rawRefresh), expiresAt: refreshExpiry },
  });

  const presigned = await presignUserPhotos({
    avatarUrl: user.avatarUrl,
    fullBodyUrl: user.fullBodyUrl,
    mediumBodyUrl: user.mediumBodyUrl,
  });

  res.status(201).json({
    accessToken,
    refreshToken: rawRefresh,
    user: {
      id: user.id,
      username: user.username,
      email: null,
      tier: user.tier,
      credits: user.credits,
      tryOnCount: user.tryOnCount,
      verified: user.verified,
      isGuest: true,
      bio: user.bio,
      avatarUrl: presigned.avatarUrl,
      fullBodyUrl: presigned.fullBodyUrl,
      mediumBodyUrl: presigned.mediumBodyUrl,
      followingCount: user.followingCount,
      followersCount: user.followersCount,
      likesCount: user.likesCount,
      aiProcessingConsentAt: user.aiProcessingConsentAt,
      isAdmin: false,
    },
  });
}

export async function createGuest(req: Request, res: Response): Promise<void> {
  const deviceId =
    typeof req.body?.deviceId === 'string' && req.body.deviceId.length > 0
      ? req.body.deviceId
      : null;
  // Welcome credits = the new-visitor "try before signup" hook. Suppressed with
  // { welcomeCredits:false } (e.g. a real user logging out drops to a browsable
  // guest session but must NOT be handed a fresh free-try-on grant). The flag
  // can only WITHHOLD the fixed grant, never increase it, so it's not a farm lever.
  const welcomeCredits = req.body?.welcomeCredits !== false;

  // Device-scoped reuse: if this device already has a guest, hand back a fresh
  // session for that row instead of minting another. Eliminates logout/reopen
  // churn, and means the welcome grant + the guest_create sign-up metric happen
  // once per device rather than on every call. Filters isGuest=true so a device
  // whose guest has since converted gets a fresh guest.
  if (deviceId) {
    const existingGuest = await prisma.user.findFirst({
      where: { deviceId, isGuest: true },
      orderBy: { createdAt: 'desc' },
    });
    if (existingGuest) {
      log.info('Guest session reused for device', { userId: existingGuest.id });
      await issueGuestSession(res, existingGuest);
      return;
    }
  }

  const username = await generateUniqueUsername();

  // Anti-farming: only grant the welcome credits to a guest that supplied a
  // stable device id. A null/empty deviceId (web, simulator, or a pre-rebuild
  // dev client) can't be deduped server-side, so without this gate every such
  // call would mint a fresh grant — the easiest farm. Real iOS App Store /
  // TestFlight devices always supply IDFV, so legitimate users are unaffected;
  // only test/edge contexts lose the grant (they still get a working guest).
  // Random-deviceId spoofing still gets one grant but stays bounded by the
  // 10/hour/IP limiter on /api/auth/guest + the guest-abuse monitor.
  const grantCredits = welcomeCredits && deviceId ? await getGuestCreditGrant() : 0;
  const userId = uuidv4();
  // verified=true is deliberate: guests never hit /login (the only path that
  // checks `verified`), and leaving it false risks a future code path treating
  // them as "pending email verification". claimGuest resets it to false so the
  // newly attached email must be verified.
  const user = await prisma.user.create({
    data: {
      id: userId,
      username,
      isGuest: true,
      verified: true,
      credits: grantCredits,
      deviceId,
    },
  });
  // Audit row for the welcome grant — only when credits were actually granted.
  if (grantCredits > 0) {
    await prisma.creditTransaction.create({
      data: {
        userId: user.id,
        type: 'GRANT',
        amount: grantCredits,
        description: 'Guest welcome credits',
      },
    });
  }

  log.info('Guest account created', { userId: user.id, username, deviceScoped: !!deviceId });

  // Record the creation IP as a 'guest_create' sign-up for the abuse monitor /
  // dashboard — ONLY for genuine new-visitor guests (welcomeCredits). Logout-
  // minted 0-credit guests (and reused sessions above) are not new sign-ups and
  // must not inflate those metrics. Goes through recordLoginLocation so the
  // row gets geo data (country/city) like login rows do — the admin dashboard
  // showed "Unknown" for guests when this wrote the bare IP directly. The
  // suspicious-location branch is inert here (a brand-new guest has no prior
  // location to compare against, and the email arg is empty anyway).
  // Fire-and-forget; never block guest creation. Gated on grantCredits (not
  // just welcomeCredits) so a deviceId-less guest that received NO grant doesn't
  // inflate the new-visitor sign-up metric / abuse counters.
  if (grantCredits > 0) {
    const ip =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ?? req.ip ?? '0.0.0.0';
    recordLoginLocation(user.id, ip, 'guest_create', '').catch((err) =>
      log.error('Failed to record guest creation location', {
        userId: user.id,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
  }

  await issueGuestSession(res, user);
}

// Convert (claim) the current guest account into a real account. Authenticated
// with the guest's token (requireAuth, NOT blockGuests — this is the one write a
// guest must reach). Upgrades the SAME user row, so the guest's try-ons, credits
// and AI consent carry over. Mirrors signup: no tokens returned; the user must
// verify their email and then log in (which mints an isGuest=false token).
export async function claimGuest(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  if (!req.user.isGuest) {
    res.status(409).json({ error: 'ALREADY_REAL_USER' });
    return;
  }

  const parse = signupSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: parse.error.flatten() });
    return;
  }
  // username omitted = keep the guest's existing user####### handle (the
  // email+password-only signup path). It stays renameable in Edit Profile.
  const { firstName, lastName, username, email, password, referralCode } = parse.data;
  const guestId = req.user.userId;

  // Same anti-farming dedup as signup (a guest converting with an aliased
  // duplicate of an existing account's email must be rejected).
  const emailNormalized = normalizeEmail(email);

  const existing = await prisma.user.findFirst({
    where: {
      OR: [
        { email: { equals: email, mode: 'insensitive' } },
        ...(emailNormalized ? [{ emailNormalized }] : []),
        ...(username ? [{ username: { equals: username, mode: 'insensitive' as const } }] : []),
      ],
      NOT: { id: guestId },
    },
  });
  if (existing) {
    logAuth('signup', {
      email,
      success: false,
      reason:
        existing.email?.toLowerCase() === email.toLowerCase() ? 'email_exists' : 'username_exists',
      ip: req.ip,
    });
    res.status(409).json({ error: 'That email or username is already taken.' });
    return;
  }

  const passwordHash = await hashPassword(password);
  const verifyToken = uuidv4();
  const verifyTokenExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000);

  try {
    await prisma.$transaction([
      prisma.user.update({
        where: { id: guestId },
        data: {
          firstName,
          lastName,
          // Only overwrite the handle when the user chose one; otherwise the
          // guest's generated username carries over unchanged.
          ...(username ? { username } : {}),
          email,
          emailNormalized,
          passwordHash,
          isGuest: false,
          verified: false,
          verifyToken,
          verifyTokenExpiry,
        },
      }),
      // Kill the guest session. The old access token still carries isGuest=true
      // until it expires, but with no refresh row its next refresh fails and the
      // client routes to Login — the desired end state.
      prisma.refreshToken.deleteMany({ where: { userId: guestId } }),
    ]);
  } catch (err) {
    // Concurrent claim/signup lost the race past the pre-check above.
    if (isUniqueConstraintError(err)) {
      logAuth('signup', { email, success: false, reason: 'unique_race', ip: req.ip });
      res.status(409).json({ error: 'That email or username is already taken.' });
      return;
    }
    throw err;
  }

  // A claiming guest can also carry a referral code (referredUserId is the
  // guest's existing id). Best-effort; reward fires at verification.
  await recordPendingReferral(guestId, referralCode);

  await sendVerificationEmail(email, verifyToken);

  logAuth('signup', {
    userId: guestId,
    email,
    success: true,
    ip: req.ip,
    userAgent: req.headers['user-agent'],
  });

  res.status(201).json({
    message: 'Account created. Check your email to verify your account.',
  });
}

export async function refreshToken(req: Request, res: Response): Promise<void> {
  const { refreshToken: token } = req.body as { refreshToken?: string };
  if (!token) {
    res.status(400).json({ error: 'refreshToken is required' });
    return;
  }

  // Verify the signature first, in its own try. A bad signature or a JWT that has
  // expired on its own is simply invalid — it is NOT a reuse signal, so we must
  // not revoke the family for it.
  let userId: string;
  try {
    ({ userId } = verifyRefreshToken(token));
  } catch {
    res.status(401).json({ error: 'Invalid refresh token' });
    return;
  }

  const stored = await prisma.refreshToken.findUnique({
    where: { token: hashRefreshToken(token) },
  });

  // Reuse detection. The signature is valid and the JWT is unexpired, yet no row
  // matches its hash. With rotation ON, a token's row is deleted the instant it
  // is rotated (below), so the only way to present a still-valid-but-unknown
  // token is a replay of one we already consumed — i.e. a stolen/captured token.
  // Treat it as a theft signal: revoke the user's entire refresh-token family so
  // neither the attacker nor the legitimate client can keep using captured
  // tokens. Both are forced to log in again. (Benign edge: a logged-out client
  // whose stale request retries lands here too — revoking is still the safe
  // outcome.) With rotation OFF, rows are never deleted by refresh, so an absent
  // row just means an invalid/logged-out/expired token — NOT a replay — and we
  // must not nuke the family (that would log out legacy clients that legitimately
  // reuse the same token every refresh).
  if (!stored) {
    if (env.refreshTokenRotation) {
      await prisma.refreshToken.deleteMany({ where: { userId } });
      logSecurity('refresh_token_reuse', { userId });
    }
    res.status(401).json({ error: 'Invalid refresh token' });
    return;
  }

  if (stored.userId !== userId || stored.expiresAt < new Date()) {
    res.status(401).json({ error: 'Invalid refresh token' });
    return;
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    res.status(401).json({ error: 'User not found' });
    return;
  }

  const accessToken = signAccessToken({
    userId: user.id,
    email: user.email,
    tier: user.tier,
    credits: user.credits,
    isGuest: user.isGuest,
  });

  // Rotation disabled: legacy behaviour — keep the existing refresh token and
  // hand back only a fresh access token. Safe for app builds that don't persist
  // a rotated refreshToken. Flip REFRESH_TOKEN_ROTATION=true once such a build is
  // live for the users hitting this server.
  if (!env.refreshTokenRotation) {
    res.json({ accessToken });
    return;
  }

  // ── Rotation ON ──────────────────────────────────────────────────────────
  // The presented token's row exists (absent rows were already handled as reuse
  // above). It is either still ACTIVE (rotatedAt null) or already-rotated
  // (tombstoned). A tombstoned token reappearing is the subtle case:
  //
  //   • Crash-in-the-gap — the client received this token, rotated it once
  //     (server minted a successor), then force-closed BEFORE persisting that
  //     successor. The client still holds THIS token; the successor it never saw
  //     is idle (never itself rotated). Re-presenting is benign — recover by
  //     minting a fresh token instead of bouncing the user to a guest session.
  //   • Genuine reuse — the client already advanced past this token (its
  //     successor was itself rotated), so a captured/stale copy is being
  //     replayed. Revoke the whole family.
  //
  // "Successor still idle" is the signal that separates the two. Recovery is
  // still strictly safer than this server's current no-rotation default (where a
  // stolen refresh token is valid for its full 30-day life); every recovery is
  // logged so a real attack pattern is visible.
  if (stored.rotatedAt) {
    const successor = stored.replacedByToken
      ? await prisma.refreshToken.findUnique({ where: { token: stored.replacedByToken } })
      : null;
    const successorIdle =
      !!successor && successor.rotatedAt === null && successor.expiresAt > new Date();

    if (successorIdle) {
      const recoveredRaw = signRefreshToken(user.id);
      const recoveredHash = hashRefreshToken(recoveredRaw);
      // Mint a fresh token and point this tombstone at it. We deliberately do
      // NOT delete the idle successor — we can't distinguish it from a
      // legitimately-current active token, so deleting could log out a live
      // client; it simply expires unused instead.
      await prisma.$transaction([
        prisma.refreshToken.create({
          data: { userId: user.id, token: recoveredHash, expiresAt: stored.expiresAt },
        }),
        prisma.refreshToken.update({
          where: { id: stored.id },
          data: { replacedByToken: recoveredHash },
        }),
      ]);
      logSecurity('refresh_token_grace_recovery', { userId });
      res.json({ accessToken, refreshToken: recoveredRaw });
      return;
    }

    // Successor already advanced (or gone) → genuine reuse. Revoke the family.
    await prisma.refreshToken.deleteMany({ where: { userId } });
    logSecurity('refresh_token_reuse', { userId });
    res.status(401).json({ error: 'Invalid refresh token' });
    return;
  }

  // Active token → normal rotation. Tombstone the old row (rotatedAt +
  // replacedByToken) and mint the successor in one transaction, so there is
  // never a window with zero valid rows for this session. The new row inherits
  // the ORIGINAL absolute expiry, so repeatedly refreshing can't extend a
  // session past the 30-day lifetime anchored at login.
  const newRawRefresh = signRefreshToken(user.id);
  const newHash = hashRefreshToken(newRawRefresh);
  await prisma.$transaction([
    prisma.refreshToken.update({
      where: { id: stored.id },
      data: { rotatedAt: new Date(), replacedByToken: newHash },
    }),
    prisma.refreshToken.create({
      data: { userId: user.id, token: newHash, expiresAt: stored.expiresAt },
    }),
  ]);

  res.json({ accessToken, refreshToken: newRawRefresh });
}

export async function logout(req: Request, res: Response): Promise<void> {
  const { refreshToken: token } = req.body as { refreshToken?: string };
  if (token) {
    await prisma.refreshToken
      .deleteMany({ where: { token: hashRefreshToken(token) } })
      .catch(() => {});
  }
  res.json({ message: 'Logged out' });
}

export async function forgotPassword(req: Request, res: Response): Promise<void> {
  const { email } = req.body as { email?: string };
  if (!email) {
    res.status(400).json({ error: 'email is required' });
    return;
  }

  const user = await prisma.user.findUnique({ where: { email } });
  // Always respond 200 to prevent email enumeration
  if (!user) {
    res.json({ message: 'If an account exists, a reset email has been sent.' });
    return;
  }

  const resetToken = uuidv4();
  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordResetToken: resetToken,
      passwordResetTokenExpiry: new Date(Date.now() + 60 * 60 * 1000),
    },
  });

  await sendPasswordResetEmail(email, resetToken);
  res.json({ message: 'If an account exists, a reset email has been sent.' });
}

export async function resetPassword(req: Request, res: Response): Promise<void> {
  const { token, password } = req.body as { token?: string; password?: string };
  if (!token || !password) {
    res.status(400).json({ error: 'token and password are required' });
    return;
  }

  const schema = z
    .string()
    .min(8)
    .regex(/[A-Z]/)
    .regex(/[0-9]/)
    .regex(/[^A-Za-z0-9]/);
  if (!schema.safeParse(password).success) {
    res.status(400).json({ error: 'Password does not meet requirements' });
    return;
  }

  const user = await prisma.user.findFirst({ where: { passwordResetToken: token } });
  if (!user || !user.passwordResetTokenExpiry || user.passwordResetTokenExpiry < new Date()) {
    res.status(400).json({ error: 'Invalid or expired reset token' });
    return;
  }

  const passwordHash = await hashPassword(password);
  // Atomic: the password update and the refresh-token revocation must succeed or
  // fail together. Otherwise a crash between them leaves the password changed
  // but old sessions still valid — defeating the point of revoking them.
  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: { passwordHash, passwordResetToken: null, passwordResetTokenExpiry: null },
    }),
    prisma.refreshToken.deleteMany({ where: { userId: user.id } }),
  ]);

  res.json({ message: 'Password updated successfully' });
}

// Authenticated password change. Distinct from the forgot/reset flow: this
// requires the current password (re-auth) but no email round-trip.
//
// On success we delete every refresh token for the user, which means every
// session — including the one that just submitted this request — is invalid
// after this returns. The client should immediately drop tokens and route
// the user back to Login. This matches `resetPassword` semantics and is the
// safest default if the password change was prompted by suspected compromise.
export async function changePassword(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  const { currentPassword, newPassword } = req.body as {
    currentPassword?: string;
    newPassword?: string;
  };
  if (!currentPassword || !newPassword) {
    res.status(400).json({ error: 'currentPassword and newPassword are required' });
    return;
  }

  // Same complexity requirements as signup / reset-password.
  const newSchema = z
    .string()
    .min(8, 'Must be at least 8 characters')
    .regex(/[A-Z]/, 'Must contain at least one uppercase letter')
    .regex(/[0-9]/, 'Must contain at least one number')
    .regex(/[^A-Za-z0-9]/, 'Must contain at least one special character');
  const newParse = newSchema.safeParse(newPassword);
  if (!newParse.success) {
    res.status(400).json({ error: newParse.error.flatten() });
    return;
  }

  if (currentPassword === newPassword) {
    res.status(400).json({ error: 'New password must be different from the current password' });
    return;
  }

  const user = await prisma.user.findUnique({ where: { id: req.user.userId } });
  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  // Guests have no password to change (the route is also blockGuests-gated, but
  // guard here defensively against a null hash reaching bcrypt).
  if (!user.passwordHash) {
    res.status(400).json({ error: 'This account has no password set.' });
    return;
  }

  const ok = await verifyPassword(currentPassword, user.passwordHash);
  if (!ok) {
    logAuth('failed_login', {
      userId: user.id,
      email: user.email ?? undefined,
      success: false,
      reason: 'change_password_wrong_current',
      ip: req.ip,
    });
    res.status(403).json({ error: 'Current password is incorrect' });
    return;
  }

  const passwordHash = await hashPassword(newPassword);
  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: { passwordHash },
    }),
    prisma.refreshToken.deleteMany({ where: { userId: user.id } }),
  ]);

  log.info('Password changed', { userId: user.id });
  res.json({ message: 'Password updated successfully. Please sign in again.' });
}

export async function resendVerification(req: Request, res: Response): Promise<void> {
  const { email } = req.body as { email?: string };
  if (!email) {
    res.status(400).json({ error: 'email is required' });
    return;
  }

  // Respond immediately with a generic message regardless of whether the email
  // matches a real account. This prevents account enumeration via both response
  // body differences AND response-time differences (the DB lookup + SMTP send
  // would otherwise leak existence through latency).
  res.json({
    message:
      'If an account with that email exists and is unverified, a new verification email has been sent.',
  });

  // Fire-and-forget the real work. Any failure is logged but never surfaced to
  // the caller, since doing so would reintroduce the enumeration vector.
  void (async () => {
    try {
      const user = await prisma.user.findUnique({ where: { email } });
      if (!user || user.verified) return;

      const verifyToken = uuidv4();
      await prisma.user.update({
        where: { id: user.id },
        data: { verifyToken, verifyTokenExpiry: new Date(Date.now() + 24 * 60 * 60 * 1000) },
      });
      await sendVerificationEmail(email, verifyToken);
    } catch (err) {
      log.error('resendVerification background failure', {
        email,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  })();
}

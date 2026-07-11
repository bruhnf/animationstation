// MUST be first — initializes Sentry (when SENTRY_DSN is set) before Express/http
// are loaded so the SDK can auto-instrument them. No-op when SENTRY_DSN is unset.
import './instrument';
import * as Sentry from '@sentry/node';
import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { env } from './config/env';
import { logger, logApp, logSecurity } from './services/logger';
import { httpLogger, errorLogger } from './middleware/httpLogger';
import prisma from './lib/prisma';
import { metricsMiddleware, metricsHandler } from './lib/metrics';
import { connection as redisConnection } from './queue/transformQueue';

import authRoutes from './routes/auth';
import uploadRoutes from './routes/upload';
import creationsRoutes from './routes/creations';
import transformRoutes from './routes/transform';
import profileRoutes from './routes/profile';
import friendsRoutes from './routes/friends';
import feedRoutes from './routes/feed';
import adminRoutes from './routes/admin';
import creditsRoutes from './routes/credits';
import notificationsRoutes from './routes/notifications';
import likesRoutes from './routes/likes';
import appleWebhookRoutes from './routes/appleWebhook';
import moderationRoutes from './routes/moderation';
import commentsRoutes from './routes/comments';
import smsRoutes from './routes/sms';
import splashRoutes from './routes/splash';
import closetRoutes from './routes/closet';
import configRoutes from './routes/config';
import shareRoutes, { pageRouter as sharePageRouter } from './routes/share';
import referralRoutes from './routes/referral';
import looksRoutes from './routes/looks';
import videoRoutes from './routes/video';
import billingRoutes from './routes/billing';
import stripeWebhookRoutes from './routes/stripeWebhook';

// BullMQ workers (consumers) + their schedulers are started below, AFTER the
// server is listening, and ONLY when env.workerEnabled (WORKER_ENABLED !==
// 'false'). On an API-only instance behind the load balancer (WORKER_ENABLED=
// false) the workers don't run — but the queue PRODUCERS (imported by the
// controllers) still enqueue jobs for the worker instance(s) to process. The
// worker modules are imported DYNAMICALLY in startWorkers() so a disabled
// instance never loads/creates them. (vulnerabilityWorker is also imported by
// admin.ts for triggerImmediateScan, so it self-guards too — see that file.)

const app = express();

// Trust first proxy (needed for rate limiting behind reverse proxy)
app.set('trust proxy', 1);

// HTTP request logging (replaces console.log based logging)
app.use(httpLogger);
// Prometheus metrics — times every request (records on response 'finish')
app.use(metricsMiddleware);

// Serve admin dashboard BEFORE helmet (needs inline scripts)
app.get('/admin', (_req, res) => {
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; script-src-attr 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; connect-src 'self'",
  );
  res.sendFile(path.join(__dirname, '../public/admin.html'));
});

// Post-verification success page. Loaded via redirect from /api/auth/verify/:token
// after the DB update succeeds. Has an "Open the AnimationStation app" button that triggers
// the animationstation:// deep link — works on both mobile (opens the app) and desktop
// (shows a clear success state instead of a broken "page can't be displayed").
app.get('/verified', (_req, res) => {
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:",
  );
  res.sendFile(path.join(__dirname, '../public/verified.html'));
});

// Security headers
app.use(
  helmet({
    crossOriginResourcePolicy: env.isDev ? false : { policy: 'same-origin' },
    contentSecurityPolicy: env.isDev ? false : undefined,
  }),
);

// CORS configuration
app.use(
  cors({
    origin: env.isDev ? true : env.allowedOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'ngrok-skip-browser-warning'],
  }),
);

// Stripe webhook signature verification needs the EXACT raw request body
// bytes, so its raw-body parser must run before the global express.json()
// below swallows the stream. Must be registered on the specific path, not
// globally, or every other route would receive a Buffer instead of parsed JSON.
app.use('/api/webhooks/stripe', express.raw({ type: 'application/json' }));

// Body parsing with size limits
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Global rate limiter (fallback, less aggressive)
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // 1000 requests per 15 minutes
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
  skip: (req) => req.path.startsWith('/health') || req.path.startsWith('/api/webhooks/'),
  handler: (req, res) => {
    logSecurity('rate_limit', { ip: req.ip, path: req.path, limiter: 'global' });
    res.status(429).json({ error: 'Too many requests, please try again later.' });
  },
});
app.use(globalLimiter);

// Auth rate limiter (strict - prevent brute force)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // 20 attempts per 15 minutes
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many authentication attempts, please try again later.' },
  handler: (req, res) => {
    logSecurity('rate_limit', { ip: req.ip, path: req.path, limiter: 'auth' });
    res.status(429).json({ error: 'Too many authentication attempts, please try again later.' });
  },
});
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/signup', authLimiter);
app.use('/api/auth/forgot-password', authLimiter);
// reset-password submits a token that volume could brute-force, so cap it with
// the strict bucket too (legit users hit it rarely). /refresh is deliberately
// NOT strict-limited: every active session refreshes through it, so a 20/15min
// per-IP cap would lock out users sharing a NAT (office/cafe). Refresh-token
// rotation + reuse detection is its theft protection instead.
app.use('/api/auth/reset-password', authLimiter);

// Dedicated stricter limit for verification-email resends. Each request triggers
// a real SES send, so cost and abuse potential are higher than for other auth
// endpoints. Per-IP, 5 requests per 15 minutes is enough headroom for a
// legitimate user retrying a typo + retrying once more, but blocks scripted abuse.
const verificationEmailLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many verification email requests, please try again later.' },
  handler: (req, res) => {
    logSecurity('rate_limit', { ip: req.ip, path: req.path, limiter: 'verification_email' });
    res
      .status(429)
      .json({ error: 'Too many verification email requests, please try again later.' });
  },
});
app.use('/api/auth/resend-verification', verificationEmailLimiter);

// Stricter per-IP limit for anonymous guest-session creation. Each call writes a
// User row + grants free credits, so this is the throttle on uninstall→reinstall
// credit farming. 10/hour/IP leaves room for a few legitimate reinstalls but
// blocks scripted abuse.
const guestCreateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many guest sessions from this network, please try again later.' },
  handler: (req, res) => {
    logSecurity('rate_limit', { ip: req.ip, path: req.path, limiter: 'guest_create' });
    res
      .status(429)
      .json({ error: 'Too many guest sessions from this network, please try again later.' });
  },
});
app.use('/api/auth/guest', guestCreateLimiter);

// Upload rate limiter
const uploadLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // 10 uploads per minute
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Upload limit reached, please wait.' },
  handler: (req, res) => {
    logSecurity('rate_limit', { ip: req.ip, path: req.path, limiter: 'upload' });
    res.status(429).json({ error: 'Upload limit reached, please wait.' });
  },
});
app.use('/api/upload', uploadLimiter);

// SMS opt-in rate limiter — public, unauthenticated endpoint, so guard against
// someone scripting bogus opt-ins. 10/hour/IP is plenty for real signups.
const smsOptInLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests from this network, please try again later.' },
  handler: (req, res) => {
    logSecurity('rate_limit', { ip: req.ip, path: req.path, limiter: 'sms_opt_in' });
    res.status(429).json({ error: 'Too many requests from this network, please try again later.' });
  },
});
app.use('/api/sms', smsOptInLimiter);

// Transform rate limiter (POST only - generation submissions)
import { Request, Response, NextFunction } from 'express';
const generationPostLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 5, // 5 transform submissions per minute
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Generation limit reached, please wait.' },
  handler: (req, res) => {
    logSecurity('rate_limit', { ip: req.ip, path: req.path, limiter: 'transform' });
    res.status(429).json({ error: 'Generation limit reached, please wait.' });
  },
});
app.use('/api/transform', (req: Request, res: Response, next: NextFunction) => {
  if (req.method === 'POST') {
    return generationPostLimiter(req, res, next);
  }
  next();
});
// Bulk-delete and other creation writes share the same modest POST cap.
app.use('/api/creations', (req: Request, res: Response, next: NextFunction) => {
  if (req.method === 'POST') {
    return generationPostLimiter(req, res, next);
  }
  next();
});

// Outfit-designer generation limiter. Each call is a real (credit-charged)
// Grok Imagine generation taking ~10–20s, so cap the request rate well below
// anything a human designing outfits would hit.
const closetGenerateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Outfit generation limit reached, please wait a minute.' },
  handler: (req, res) => {
    logSecurity('rate_limit', { ip: req.ip, path: req.path, limiter: 'closet_generate' });
    res.status(429).json({ error: 'Outfit generation limit reached, please wait a minute.' });
  },
});
app.use('/api/closet/generate', closetGenerateLimiter);
// Cleanup is the same kind of credit-charged Grok call — rate-limit it identically.
app.use('/api/closet/cleanup', closetGenerateLimiter);
// Video generation is an even heavier (credit-charged, async) Grok call — cap
// POSTs at the same low rate.
app.use('/api/video', (req: Request, res: Response, next: NextFunction) => {
  if (req.method === 'POST') return closetGenerateLimiter(req, res, next);
  next();
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/transform', transformRoutes);
app.use('/api/creations', creationsRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/friends', friendsRoutes);
app.use('/api/feed', feedRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/credits', creditsRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/likes', likesRoutes);
app.use('/api/sms', smsRoutes);
app.use('/api/splash', splashRoutes);
app.use('/api/config', configRoutes);
app.use('/api/share', shareRoutes);
app.use('/api/referral', referralRoutes);
app.use('/api/looks', looksRoutes);
app.use('/api/closet', closetRoutes);
app.use('/api/video', videoRoutes);
app.use('/api/billing', billingRoutes);
app.use('/api/webhooks', appleWebhookRoutes);
app.use('/api/webhooks', stripeWebhookRoutes);
app.use('/api', moderationRoutes);
// Mounted at /api so paths can be `/creations/:jobId/comments` (extending the
// existing /api/creations namespace without modifying creationsRoutes) and
// `/comments/:commentId` for delete.
app.use('/api', commentsRoutes);

// Public shareable creation pages: GET /t/<jobId> -> server-rendered HTML with
// OpenGraph/Twitter meta (rich link previews). Mounted at the root, not under
// /api, so the share URL is short. See routes/share.ts.
app.use('/t', sharePageRouter);

// Liveness — shallow, dependency-free. This is what the Docker healthcheck hits:
// it must report healthy as long as the Express process can serve requests, so a
// transient Postgres/Redis blip does NOT cause Docker to kill and restart an
// otherwise-fine container.
// Prometheus scrape endpoint (keep internal via nginx in prod; dev nginx 404s it).
app.get('/metrics', metricsHandler);

app.get('/health/live', (_req, res) =>
  res.json({ status: 'ok', timestamp: new Date().toISOString() }),
);

// Readiness — deep. Probes Postgres + Redis in parallel, each with a hard 2s
// timeout, and returns 503 if any dependency is unreachable. UptimeRobot points
// here so external monitoring catches dependency outages, not just a dead
// process. Kept at /health (the long-standing path) for backward compatibility.
const HEALTH_TIMEOUT_MS = 2000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

app.get('/health', async (_req, res) => {
  const [postgres, redis] = await Promise.all([
    withTimeout(prisma.$queryRaw`SELECT 1`, HEALTH_TIMEOUT_MS)
      .then(() => true)
      .catch(() => false),
    withTimeout(redisConnection.ping(), HEALTH_TIMEOUT_MS)
      .then((reply) => reply === 'PONG')
      .catch(() => false),
  ]);

  const healthy = postgres && redis;
  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    dependencies: {
      postgres: postgres ? 'up' : 'down',
      redis: redis ? 'up' : 'down',
    },
  });
});

// Marketing + account website (static HTML/CSS/JS). Served at the site root so
// animationstation.ai shows the site, while /api/* stays the API.
// Mounted AFTER every /api route and the health/share/admin/verified routes so
// it can never shadow them — only otherwise-unmatched GETs fall through to a
// static file. `extensions: ['html']` gives clean URLs (/login → login.html).
// The directory is bind-mounted from ./website in docker-compose (not baked into
// the image), so site edits deploy without a backend rebuild.
const websiteDir = path.join(__dirname, '../website');

// The static site (login / signup / account / creations / …) drives every button
// with inline <script> blocks and inline event handlers (onclick / onsubmit).
// Helmet's strict default CSP — script-src 'self'; script-src-attr 'none' — blocks
// both, so the inline handlers never run: clicking "Log In" silently does nothing
// (the form falls back to a native submit that just clears the inputs). Relax
// script-src for the site the same way /admin does above, and additionally allow
// img-src/media-src/connect-src over https so the feed + account pages can load
// and download AI results from presigned S3 URLs (else images/videos are blocked
// and the feed shows blank black boxes). Runs after Helmet set the strict header,
// and only
// for GETs that fell through every /api and system route to the static site.
// Skipped in dev (Helmet CSP is disabled there, mirroring that intent).
if (!env.isDev) {
  app.use((_req, res, next) => {
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self';base-uri 'self';connect-src 'self' https:;font-src 'self' https: data:;form-action 'self';frame-ancestors 'self';img-src 'self' data: https:;media-src 'self' data: blob: https:;object-src 'none';script-src 'self' 'unsafe-inline';script-src-attr 'unsafe-inline';style-src 'self' https: 'unsafe-inline';upgrade-insecure-requests",
    );
    next();
  });
}

app.use(express.static(websiteDir, { extensions: ['html'], index: false }));
app.get('/', (_req, res) => res.sendFile(path.join(websiteDir, 'index.html')));

// 404 handler
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Sentry error handler — must come AFTER all controllers/routes but BEFORE our
// own error middleware. It captures errors that reach Express's error pipeline
// (default: 5xx / unhandled throws) then calls next(err), so errorLogger and the
// global handler below still run and shape the client response. No-op when Sentry
// is disabled. Unhandled rejections / uncaught exceptions are captured separately
// by the SDK's default integrations.
Sentry.setupExpressErrorHandler(app);

// Error logging middleware (before error handler)
app.use(errorLogger);

// Global error handler
app.use((err: Error, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  // Error already logged by errorLogger middleware

  // Don't leak error details in production
  if (env.isDev) {
    res.status(500).json({ error: err.message, stack: err.stack });
  } else {
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.listen(env.port, () => {
  logApp('startup', {
    component: 'express',
    message: `AnimationStation backend running on port ${env.port}`,
    port: env.port,
    environment: env.nodeEnv,
    logLevel: process.env.LOG_LEVEL || (env.isDev ? 'debug' : 'info'),
  });

  if (env.workerEnabled) {
    // Loudly surface a worker-startup failure (e.g. a dynamic import throwing)
    // rather than swallowing the rejection with `void` — on the single-box
    // deployment the workers are essential, so a silent failure to start them
    // must not go unnoticed.
    startWorkers().catch((err) => {
      logger.error('Failed to start BullMQ workers', {
        error: err instanceof Error ? err.message : String(err),
      });
      Sentry.captureException(err);
    });
  } else {
    logApp('startup', {
      component: 'workers',
      message: 'WORKER_ENABLED=false — BullMQ workers + schedulers NOT started (API-only instance)',
    });
  }
});

// Start the BullMQ workers (consumers) and register their repeatable schedulers.
// Dynamic imports so a WORKER_ENABLED=false instance never even loads the worker
// modules. Each module creates its Worker as a side effect of being imported.
async function startWorkers(): Promise<void> {
  await Promise.all([
    import('./queue/transformWorker'),
    import('./queue/videoWorker'),
    import('./queue/appleNotificationWorker'),
  ]);
  const [vuln, orphan, guestCleanup, guestAbuse, queueHealth] = await Promise.all([
    import('./queue/vulnerabilityWorker'),
    import('./queue/orphanScanWorker'),
    import('./queue/guestCleanupWorker'),
    import('./queue/guestAbuseMonitorWorker'),
    import('./queue/queueHealthMonitorWorker'),
  ]);
  vuln
    .scheduleVulnerabilityScans()
    .catch((err) => logger.error('Failed to schedule vulnerability scans', { error: err.message }));
  orphan
    .scheduleOrphanScans()
    .catch((err) => logger.error('Failed to schedule S3 orphan scans', { error: err.message }));
  guestCleanup
    .scheduleGuestCleanup()
    .catch((err) => logger.error('Failed to schedule guest cleanup', { error: err.message }));
  guestAbuse
    .scheduleGuestAbuseMonitor()
    .catch((err) => logger.error('Failed to schedule guest abuse monitor', { error: err.message }));
  queueHealth
    .scheduleQueueHealthMonitor()
    .catch((err) =>
      logger.error('Failed to schedule queue health monitor', { error: err.message }),
    );
  logApp('startup', { component: 'workers', message: 'BullMQ workers + schedulers started' });
}

// Flush buffered Sentry events on shutdown so the last errors before a deploy/stop
// aren't lost. Best-effort with a short timeout so a slow network can't wedge the
// container stop; Docker SIGTERMs on `compose up`/`stop`. No-op when Sentry is off.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    logApp('shutdown', { component: 'express', message: `received ${signal}, flushing Sentry` });
    Sentry.close(2000)
      .catch(() => undefined)
      .finally(() => process.exit(0));
  });
}

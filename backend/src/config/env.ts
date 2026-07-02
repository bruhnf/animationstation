import dotenv from 'dotenv';
dotenv.config();

function required(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env var: ${key}`);
  return val;
}

function optional(key: string, fallback = ''): string {
  return process.env[key] ?? fallback;
}

// Lightweight email shape check — RFC 5322 has plenty of edge cases, but for an
// admin allowlist sanity check this catches the common typos (missing @, stray
// spaces, trailing commas). Anything that doesn't pass is dropped from the list
// AND announced via console.warn so an operator can see they had a typo.
function parseAdminEmails(raw: string): string[] {
  const entries = raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const valid: string[] = [];
  const dropped: string[] = [];
  const looksLikeEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  for (const e of entries) {
    if (looksLikeEmail.test(e)) valid.push(e);
    else dropped.push(e);
  }
  if (dropped.length > 0) {
    // env.ts loads before the Winston logger is constructed, so use console
    // directly. The message will appear in container logs at startup.

    console.warn(
      `[env] ADMIN_EMAILS: dropped ${dropped.length} malformed entr${dropped.length === 1 ? 'y' : 'ies'}: ${dropped.join(', ')}`,
    );
  }
  return valid;
}

export const env = {
  port: parseInt(optional('PORT', '3000'), 10),
  nodeEnv: optional('NODE_ENV', 'development'),
  isDev: optional('NODE_ENV', 'development') === 'development',

  jwtSecret: required('JWT_SECRET'),
  jwtRefreshSecret: required('JWT_REFRESH_SECRET'),
  jwtExpiresIn: '15m',
  jwtRefreshExpiresIn: '30d',
  // Refresh-token rotation + reuse detection. OFF by default because enabling it
  // against an app build that doesn't store the rotated token would log every
  // such client out on its second refresh (it keeps replaying the now-deleted
  // token → reuse detection revokes the family). Only turn this ON once a build
  // that persists the rotated refreshToken is live for the users hitting this
  // server. Dev: ON. Prod: keep OFF until the rotation-aware app build ships.
  refreshTokenRotation: optional('REFRESH_TOKEN_ROTATION', 'false').toLowerCase() === 'true',

  // Whether THIS instance runs the BullMQ workers (consumers) + their schedulers.
  // Default ON (single-box behavior). Set WORKER_ENABLED=false on extra API-only
  // instances behind the load balancer so they serve traffic but don't process
  // jobs (the queue producers still enqueue for the worker instance). See
  // DEPLOYMENT.md §17 + index.ts startWorkers().
  workerEnabled: optional('WORKER_ENABLED', 'true').toLowerCase() !== 'false',

  adminApiKey: required('ADMIN_API_KEY'),
  // Comma-separated list of email addresses with admin UI access in the app.
  // Backend admin routes also require ADMIN_API_KEY; this list controls
  // whether the Admin Console button is even shown in Settings.
  adminEmails: parseAdminEmails(optional('ADMIN_EMAILS', '')),
  allowedOrigins: optional('ALLOWED_ORIGINS', 'http://localhost:8081').split(','),

  aws: {
    accessKeyId: optional('AWS_ACCESS_KEY_ID'),
    secretAccessKey: optional('AWS_SECRET_ACCESS_KEY'),
    region: optional('AWS_REGION', 'us-east-1'),
    s3Bucket: optional('AWS_S3_BUCKET', 'animationstation-uploads-dev'),
  },

  redis: { url: optional('REDIS_URL', 'redis://localhost:6379') },

  grok: {
    apiKey: optional('GROK_API_KEY'),
    apiUrl: optional('GROK_API_URL', 'https://api.x.ai/v1'),
  },

  email: {
    fromAddress: optional('SES_FROM_ADDRESS', 'noreply@animationstation.bruhnfreeman.com'),
    smtpHost: optional('SMTP_HOST'),
    smtpPort: parseInt(optional('SMTP_PORT', '587'), 10),
    smtpUser: optional('SMTP_USER'),
    smtpPass: optional('SMTP_PASS'),
  },

  // Directory holding the optional splash/announcement image (splash.jpg/png/
  // webp). Bind-mounted in docker-compose so an admin can publish/replace the
  // splash without rebuilding. No file in the dir = no splash shown in the app.
  splashDir: optional('SPLASH_DIR', './splash'),

  appUrl: optional('APP_URL', 'http://localhost:3000'),
  frontendDeepLink: optional('FRONTEND_DEEP_LINK', 'animationstation://'),
  // Public-facing website root, used for redirects in flows that finish on the
  // marketing site (e.g. the post-verification success page).
  websiteUrl: optional('WEBSITE_URL', 'https://animationstation.ai'),

  apple: {
    // iOS bundle identifier — must match the receipt's bundleId.
    bundleId: optional('APPLE_BUNDLE_ID', 'com.bruhnfreeman.animationstation'),
    // Numeric App Store ID for this app (find in App Store Connect URL).
    appAppleId: parseInt(optional('APPLE_APP_APPLE_ID', '0'), 10),
    // Which Apple environment this server is configured to verify notifications from.
    // "Production" or "Sandbox". Sandbox notifications carry environment="Sandbox" and
    // we only accept those when this is also set to Sandbox (or unset in dev).
    environment: optional('APPLE_ENVIRONMENT', 'Sandbox'),
    // Directory containing Apple's root CA .cer files used for JWS verification.
    // Download from https://www.apple.com/certificateauthority/ — at minimum AppleRootCA-G3.cer.
    rootCertsDir: optional('APPLE_ROOT_CERTS_DIR', './certs/apple'),
    // App Store Server API credentials. Generate an "In-App Purchase" key in
    // App Store Connect → Users and Access → Integrations → In-App Purchase tab.
    // Store the .p8 in the same dir as the root certs (gitignored).
    // All three are optional in dev — server API calls throw a clean error if missing.
    serverApiKeyId: optional('APPLE_API_KEY_ID'), // 10-char key identifier
    serverApiIssuerId: optional('APPLE_API_KEY_ISSUER_ID'), // UUID from App Store Connect
    serverApiKeyPath: optional('APPLE_API_KEY_PATH'), // absolute or relative path to the .p8 file
  },
};

// Fail loud at boot if obvious misconfigurations are present in production.
// The signup verification flow constructs links like `${APP_URL}/api/auth/verify/<token>`
// — if APP_URL is the localhost default in production, every signup email will
// contain a broken link and users won't be able to verify. Better to crash the
// container at boot than to silently bounce real users.
if (env.nodeEnv === 'production') {
  const productionMisconfigurations: string[] = [];
  if (!env.appUrl || env.appUrl === 'http://localhost:3000') {
    productionMisconfigurations.push(
      'APP_URL is unset or still the localhost default. Set it to the public API URL (e.g. https://animationstation.ai).',
    );
  }
  if (productionMisconfigurations.length > 0) {
    throw new Error(
      `Production env misconfiguration:\n  - ${productionMisconfigurations.join('\n  - ')}`,
    );
  }
}

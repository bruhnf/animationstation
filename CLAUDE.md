# CLAUDE.md 6-15-2026  v 1.3.0

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Environment Notice

**This is a test and development environment.** There is no need to preserve existing users, tokens, or data when making schema changes or migrations. Feel free to drop and recreate the database as needed.

---

## ⚠️ DEPLOYMENT CHECKLIST

There are **two** Lightsail servers, each with its own compose file. Pick the one
that matches the branch you're deploying — using the wrong `-f` file targets the
wrong stack and the wrong nginx config (`nginx.conf` vs `nginx.dev.conf`).

| Environment | Branch | Server | Compose file |
|---|---|---|---|
| **Production** | `main` | `api.tryon-mirror.ai` | `docker-compose.prod.yml` |
| **Dev** | `develop` | `api-dev.tryon-mirror.ai` | `docker-compose.dev.yml` |

**Production deploy — run ALL of these commands:**

```bash
ssh ubuntu@<prod-lightsail-ip>
cd /opt/evofaceflow/TryOn
git pull
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml exec backend npx prisma migrate deploy  # ⚠️ DON'T SKIP!
```

**Dev deploy — same steps, but `docker-compose.dev.yml`:**

```bash
ssh ubuntu@<dev-lightsail-ip>
cd /opt/evofaceflow/TryOn
git pull
docker compose -f docker-compose.dev.yml up -d --build
docker compose -f docker-compose.dev.yml exec backend npx prisma migrate deploy  # ⚠️ DON'T SKIP!
```

> **🚨 The `prisma migrate deploy` step is REQUIRED after any schema changes or the backend will crash!**

> **🟢 Zero-gap ordering when the NEW code reads a NEW column (additive migrations).**
> The plain `up -d --build` → `migrate deploy` order above has a window: the new
> container starts serving *before* the migration runs, so any request whose code
> path `SELECT`s a not-yet-added column **500s until the migration lands** (e.g.
> the `add_throttle_reset` migration adds `User.throttleResetAt`, which
> `computeQueueDelayMs` selects on **every try-on AND video submit** — so those
> two endpoints fail in the gap). Migration files are baked into the image at
> build time, so you can't run the new migration from the *old* container. The
> fix is to apply the migration with a **throwaway container built from the new
> image**, while the old container keeps serving (an additive *nullable* column
> is invisible to the old code), then swap:
> ```bash
> cd /opt/evofaceflow/TryOn
> git pull
> docker compose -f docker-compose.prod.yml build backend                       # build new image (contains the migration)
> docker compose -f docker-compose.prod.yml run --rm backend npx prisma migrate deploy  # apply via throwaway new-image container; old container still serving
> docker compose -f docker-compose.prod.yml up -d --build                        # now swap to the new code — column already exists
> ```
> This only matters for **additive** migrations (new nullable column / table) the
> new code reads immediately. **Destructive** migrations (dropping/renaming/adding
> a NOT-NULL column) are NOT safe to run while the old code is live — those need a
> brief maintenance window or a multi-step expand/contract migration. When in
> doubt, check whether the old running code can tolerate the schema mid-state.

> **nginx-only changes** (editing `nginx/*.conf`, with no backend code or schema
> change) don't need a backend rebuild, but `nginx -s reload` alone will **not**
> pick them up after a `git pull`. The config is bind-mounted as a *single file*,
> so Docker pins the running container to that file's inode at start time. `git
> pull` replaces the file via rename (a new inode), leaving the container — and
> any `reload` — reading the stale original. You must **force-recreate** the
> nginx container so it remounts the current file (swap `dev`/`prod` to match the
> box you're on):
> ```bash
> # Optional: validate the NEW file first via a throwaway container (the running
> # one is pinned to the old inode, so `nginx -t` there tests stale config).
> docker run --rm -v "$PWD/nginx/nginx.dev.conf:/etc/nginx/nginx.conf:ro" nginx:alpine nginx -t
> # Apply: recreate just nginx so it re-resolves the bind-mount to the new inode.
> docker compose -f docker-compose.dev.yml up -d --force-recreate nginx
> # Confirm the running container now has your change (grep for a known new line):
> docker compose -f docker-compose.dev.yml exec nginx grep -n verified /etc/nginx/nginx.conf
> ```
> (`docker compose restart nginx` is **not** enough — it restarts the same
> container with the same pinned inode. You need a *new* container.)

---

## Project Overview

TryOn Mirror is an AI-powered virtual clothing try-on mobile app, using tryon-mirror.ai for its domain (legacy domain: evofaceflow.com — see the Domain migration note above; the iOS bundle id and IAP SKUs permanently keep the `com.evofaceflow.tryon.*` prefix). It is a monorepo with two main packages: 
- `backend/` — Node.js/Express REST API with TypeScript
- `frontend/` — React Native (Expo) mobile app

Users upload personal body photos to their profile (full body front, medium/waist-up, close-up), then photograph articles of clothing or full outfits while shopping. The app calls the xAI Grok Imagine API to generate images of the user wearing those items, returned in the perspective(s) matching whichever body photos the user has on file.

## Commands

### Backend
```bash
cd backend
npm run dev      # Development server with hot reload (ts-node-dev)
npm run build    # Compile TypeScript to dist/
npm start        # Run compiled production build
npm run migrate  # Run Prisma migrations
npm run seed     # Seed development data
```

### Frontend (local Expo dev only — not for distribution)
```bash
cd frontend
npm run start:dev          # ⭐ Dev server for the EAS dev-client (tunnel) — sets APP_VARIANT=development so the QR uses the tryon-dev:// scheme. USE THIS when an App Store build is also installed.
npm run start:dev:lan      # Same, LAN (no tunnel)
npx expo start -c          # Dev server with cache clear — open the dev client app to load
npx expo start --tunnel    # ⚠️ Dev server with the PROD scheme (tryon://). If the App Store app is also installed, scanning this QR opens the STORE app, not the dev client (scheme collision) — use npm run start:dev instead.
npm run android            # Local native build via Xcode/Android Studio (expo run:android)
npm run ios                # Local native build via Xcode (expo run:ios)
npm run web                # Web preview (limited — most native modules don't work on web)
npm test                   # jest-expo unit tests (src/**/__tests__/*.test.ts)
```

> **Expo Go does NOT work for this app.** See the "Local Development Setup" section below — the app depends on native modules outside Expo Go's fixed module set, so every device test requires a dev client built via `expo run:*` or EAS Build.

For TestFlight or App Store distribution, use **EAS Build** instead — see DEPLOYMENT.md §11. EAS is required for any build that includes native code that the user will install (the app uses `expo-iap`, `expo-secure-store`, etc. which all require a native build).

### Switching Between Local, Dev, and Live Backend

The frontend can target the local backend, the dev server, or production. Configure this in `frontend/src/config/api.ts` via the three-way `ENV` switch:

```typescript
type ApiEnv = 'local' | 'dev' | 'prod';
const ENV = 'prod' as ApiEnv;   // flip to 'dev' or 'local' for testing

const LOCAL_URL = 'http://localhost:3000/api';
const DEV_URL   = 'https://api-dev.tryon-mirror.ai/api';   // dev box also answers as api-dev.evofaceflow.com (legacy)
const LIVE_URL  = 'https://api.tryon-mirror.ai/api';
```

> **Domain migration (2026-06-12):** the brand moved from `evofaceflow.com` / "evoFaceFlow" to **`tryon-mirror.ai` / "TryOn Mirror"** (`.com`/`.net`/`.app` 301 to it). Both boxes answer on BOTH domains (certs + nginx `server_name` cover each pair). The cutover is **additive** — shipped 1.0.17 app builds hardcode `api.evofaceflow.com`, so the legacy domain stays registered and serving the API until the 1.1.0 build is live on the App Store and old installs die off. Legacy website pages 301 to the new apex, EXCEPT `evofaceflow.com/sms.html`, which keeps serving directly because the AWS toll-free SMS registration cites that URL. (That registration is now **APPROVED + the number is ACTIVE** as of 2026-06-13, so the carve-out can be lifted; it's kept serving as a safety margin against AWS re-verification.)

> **Committed code must always say `'prod'`.** CI has a guard that fails the build otherwise ([.github/workflows/ci.yml](.github/workflows/ci.yml)), because a committed `'dev'`/`'local'` would point an App Store build at the wrong backend. Flip it locally, flip it back before committing. (This guard caught a real near-miss before the 1.0.17 production build.)

> **🚨 Expo Go does NOT work for this app.** The app depends on native modules that ship outside Expo Go's fixed module set (`expo-iap`, `expo-secure-store`, etc.). Launching in Expo Go fails at startup with `Cannot find native module 'ExpoIap'` and "App entry not found" on the device. Every device-testing flow below assumes a **dev client build** — either a simulator/emulator build via `expo run:*`, or an installed dev-client app via EAS Build. Once the dev client is installed, JS still hot-reloads from `npx expo start` like normal.

**One-time: build a dev client**

Pick the path that matches your machine and target device:

- **iOS Simulator (Mac only):** `cd frontend && npx expo run:ios` — builds and installs the dev client into the simulator. Requires Xcode.
- **Android Emulator (Mac/Windows/Linux):** `cd frontend && npx expo run:android` — builds and installs into the running emulator. Requires Android Studio.
- **Physical iPhone from Windows or without a Mac:** use **EAS Build** with the development profile:
  ```bash
  cd frontend
  npm install -g eas-cli           # one-time
  eas login                        # one-time
  eas build:configure              # one-time, creates eas.json if missing
  eas build --profile development --platform ios
  ```
  When the build finishes, EAS gives you a QR/install link. Install the resulting dev-client app on your iPhone (TestFlight or internal distribution). Rebuild only when you add or upgrade a native module — JS changes do not require a rebuild.
- **Physical Android device:** same flow with `--platform android`, or run `npx expo run:android` against the device with USB debugging enabled.

**Local Development Setup (Simulator/Emulator):**
1. Set `ENV = 'local'` in `frontend/src/config/api.ts`
2. Start backend: `cd backend && npm run dev`
3. Start frontend: `cd frontend && npx expo start`
4. Press `a` for Android emulator or `i` for iOS simulator (the dev client launches automatically once it's been built once via `expo run:*`)

**Local Development Setup (Physical Device — iPhone/Android):**

Requires the dev client to already be installed on the device (see one-time setup above). Then pick one approach for the backend:

**Option A: Use Live or Dev Backend (Recommended for quick testing)**
1. Set `ENV = 'prod'` (live) or `ENV = 'dev'` (dev server) in `frontend/src/config/api.ts`
2. Start the metro bundler: `cd frontend && npm run start:dev` (sets `APP_VARIANT=development` so the QR's deep link uses `tryon-dev://` and reaches the dev client — see the scheme-collision note below)
3. **Open the dev client app on your phone** (NOT Expo Go) and scan the QR code, or tap the project under "Recently opened" inside the dev client
4. Backend is already running on Lightsail — no local backend needed

**Option B: Use Local Backend with ngrok (Full local stack)**
1. Install ngrok: https://ngrok.com/download
2. Start backend services: `docker-compose up -d` (or `cd backend && npm run dev`)
3. Expose backend with ngrok: `ngrok http 3000`
4. Copy the ngrok URL (e.g., `https://abc123.ngrok-free.app`)
5. Update `frontend/src/config/api.ts`:
   ```typescript
   const LOCAL_URL = 'https://abc123.ngrok-free.app/api';  // Your ngrok URL (do NOT commit it)
   const ENV = 'local' as ApiEnv;
   ```
6. Start the metro bundler: `cd frontend && npm run start:dev`
7. **Open the dev client app on your phone** (NOT Expo Go) and scan the QR code
8. Admin Dashboard remains reachable at http://localhost:3000/admin from your dev machine

> **Note:** The frontend already includes the `ngrok-skip-browser-warning` header to bypass ngrok's browser warning page.

> **🚨 Dev-client QR scheme collision (why scanning can open the App Store app).** The EAS `development` build is an "app variant" ([frontend/app.config.js](frontend/app.config.js)): when built with `APP_VARIANT=development` (set in [eas.json](frontend/eas.json)) it gets its own identity — name **TryOn Dev**, bundle `com.evofaceflow.tryon.app.dev`, scheme **`tryon-dev://`** — so it can sit beside the App Store build (`com.evofaceflow.tryon.app`, scheme `tryon://`). But `expo start` builds the QR's deep link from the *resolved scheme*, and `APP_VARIANT` is **not** set in your shell when you run plain `npx expo start`, so the QR uses `tryon://` — which the **App Store app** claims, opening it (showing prod data) instead of the dev client. With the store app deleted, scanning that QR yields "no usable data found" (nothing claims `tryon://`); pasting the URL under the QR into the dev client's manual-entry field works because it bypasses scheme routing. **Fix: always start the dev server with `npm run start:dev`** (= `cross-env APP_VARIANT=development expo start --tunnel`) so the QR uses `tryon-dev://` and reaches the dev client. The bare `npx expo start` path is only correct when no App Store build is installed.

**Important:** Always set `ENV = 'prod'` before committing — CI enforces it.

### Docker (Backend Services Only)

Docker Compose runs the **backend infrastructure only** (PostgreSQL, Redis, and the Express API). The frontend must always be started separately with Expo.

```bash
# Start backend services (PostgreSQL + Redis + Backend API on port 3000)
docker-compose up --build

# Then in a separate terminal, start the frontend:
cd frontend && npx expo start

# For production-like environment (includes nginx, fail2ban):
docker-compose -f docker-compose.prod.yml up --build
```

**What Docker Compose includes:**
- `postgres` — PostgreSQL 15 database on port 5432
- `redis` — Redis 7 for BullMQ job queue on port 6379
- `backend` — Express API on port 3000 with hot reload

**What Docker Compose does NOT include:**
- Frontend (React Native/Expo) — always run separately
- ngrok tunnel — set up separately if needed for physical device testing

### CI/CD
**Deploys are manual; CI is tests-only.** [.github/workflows/ci.yml](.github/workflows/ci.yml) runs on every push/PR to `develop`/`main`: backend `tsc` + tests (Node 20, matching the prod image — `node --test` via [scripts/run-tests.js](backend/scripts/run-tests.js); mostly pure unit tests, plus a **supertest integration test** [src/routes/video.upload.test.ts](backend/src/routes/video.upload.test.ts) that exercises the real video-upload multer middleware + source selection), frontend `tsc` + jest-expo, a guard that fails if the committed [frontend/src/config/api.ts](frontend/src/config/api.ts) targets anything but `prod`, and an informational `npm audit`. [.github/dependabot.yml](.github/dependabot.yml) opens weekly grouped dependency PRs (bump expo-managed packages via `npx expo install`, not by merging those PRs blindly). **No workflow deploys anything.** Production changes happen only when you SSH into Lightsail and run `git pull` + `docker compose -f docker-compose.prod.yml up -d --build` (see the DEPLOYMENT CHECKLIST at the top of this file and DEPLOYMENT.md §13). This is deliberate: it prevents accidental pushes from reaching production, which is especially important during App Store review windows.

### Git workflow
The branch-PR-merge workflow for making code changes lives in [CONTRIBUTING.md](CONTRIBUTING.md). When the user asks "how do I commit / merge / branch / push" type questions, refer them to the relevant section there rather than re-explaining inline.

---

## Logging

The backend uses **Winston** for structured logging with daily file rotation.

### Log Levels
- `error` - Application errors, exceptions, failed operations
- `warn` - Warnings, deprecations, suspicious activity (e.g., suspicious login locations)
- `info` - Key business events, state changes, successful operations
- `http` - HTTP request/response logging
- `debug` - Detailed debugging information (verbose in dev)

### Environment Variables
```bash
LOG_LEVEL=debug       # Set log level (default: debug in dev, info in prod)
LOG_DIR=/var/log/tryon  # Log file directory (default: ./logs)
LOG_TO_FILE=true      # Enable file logging in development
```

### Log Files (Production)
Located at `/var/log/tryon/` (Docker volume `backend_logs`):
- `combined-YYYY-MM-DD.log` - All logs, rotated daily, 14-day retention
- `error-YYYY-MM-DD.log` - Errors only, 30-day retention
- `exceptions-YYYY-MM-DD.log` - Unhandled exceptions
- `rejections-YYYY-MM-DD.log` - Unhandled promise rejections

### Viewing Logs

After SSHing into Lightsail and `cd /opt/evofaceflow/TryOn`:

```bash
# All services together (most useful for live debugging) — backend + postgres
# + redis + nginx in one stream. Each line is prefixed with the container name.
docker compose -f docker-compose.prod.yml logs -f --tail=200

# Just the backend Express app
docker compose -f docker-compose.prod.yml logs -f backend --tail=200

# Structured backend logs (JSON lines with correlationId, userId, service —
# higher fidelity than `docker compose logs`; best when chasing a specific
# request)
docker compose -f docker-compose.prod.yml exec backend tail -f /var/log/tryon/combined-$(date +%Y-%m-%d).log

# Just errors (lower noise)
docker compose -f docker-compose.prod.yml exec backend tail -f /var/log/tryon/error-$(date +%Y-%m-%d).log

# Filter live for one user / correlation ID
docker compose -f docker-compose.prod.yml logs -f backend | grep --line-buffered "<userId>"

# Or mount the log volume directly from the host (no `exec` needed)
docker volume inspect www_backend_logs  # Find mount point
tail -f /var/lib/docker/volumes/www_backend_logs/_data/combined-*.log
```

Hit `Ctrl+C` to stop tailing. Day-to-day, the first command (all services, last 200 lines) is the one you'll reach for most.

### Log Management Strategy
1. **Daily rotation** prevents single files from growing too large
2. **14-day retention** for combined logs (configurable)
3. **30-day retention** for error logs (useful for debugging recurring issues)
4. **Gzip compression** of rotated logs saves disk space
5. **Correlation IDs** in `x-correlation-id` header trace requests across services

### What's Logged
- HTTP requests/responses (method, path, status, duration, user ID)
- Authentication events (login, signup, failed attempts, token refresh)
- External API calls (Grok/xAI, ip-api, SMTP) with timing and status
- Job processing (try-on queue events)
- File uploads (S3 operations)
- Security events (rate limiting, suspicious locations)
- Database errors and slow queries (>1s)

---

## Error Tracking & Observability (Sentry)

The backend integrates **Sentry** (`@sentry/node`) for exception/crash reporting — stack traces, breadcrumbs, release tagging, and alerting — on top of the Winston logs above. Winston answers "what happened over time"; Sentry answers "what broke, where in the code, and how often."

**The whole integration is gated on `SENTRY_DSN`.** When that env var is unset (local dev, or any box not yet wired up), `Sentry.init()` is never called and every `captureException` / `setupExpressErrorHandler` call is a cheap no-op. Turning Sentry on in an environment is purely a matter of setting `SENTRY_DSN` in that box's `backend/.env` — **no code change, no redeploy logic**. (As of 2026-06-08, `SENTRY_DSN` is set on **both prod and dev**, so error capture is **live** on both boxes. Local dev still runs without it = disabled no-op.)

**Files:**
- [backend/src/instrument.ts](backend/src/instrument.ts) — owns `Sentry.init()`. Imported as the **very first line** of [index.ts](backend/src/index.ts) (before Express/http) so the SDK's auto-instrumentation can patch them at require time. Exports `sentryRuntime` (a secrets-free status snapshot for the dashboard).
- [backend/src/utils/scrub.ts](backend/src/utils/scrub.ts) — pure PII/secret scrubber wired in as Sentry's `beforeSend`. Redacts sensitive request headers (incl. `authorization`, `cookie`, **`x-admin-key`**), all cookies, sensitive request-body fields, and the user's email/IP/username (keeps `user.id` for correlation). Unit-tested in `scrub.test.ts` — run `npm test` in `backend/`.
- [backend/src/services/sentryService.ts](backend/src/services/sentryService.ts) — dashboard read-side: config status, "recent unresolved issues" via Sentry's REST API (optional), and a "send test event" helper.

**What's captured:**
- Unhandled errors that reach the Express error pipeline (5xx) — via `Sentry.setupExpressErrorHandler(app)`, registered after routes and before our own error middleware.
- Unhandled promise rejections / uncaught exceptions — via the SDK's default integrations.
- **Terminal** worker failures in the revenue/entitlement-critical queues: `tryonWorker` (excludes expected content-moderation blocks — those are policy, not errors) and `appleNotificationWorker` (final attempt only, so retries don't spam).

**Privacy:** `sendDefaultPii: false` plus the `beforeSend` scrubber. Keep `scrub.ts`'s `SENSITIVE_KEY` list in sync with anything new that counts as a secret. Tracing is **off by default** (`SENTRY_TRACES_SAMPLE_RATE=0`) to preserve the free-tier quota — errors are the goal.

**Environment separation (production / development / local):** every event carries a Sentry `environment` tag — prod box = `production` (explicit `SENTRY_ENVIRONMENT` in its `.env`), dev box = `development` (derived from `APP_URL` containing `api-dev`), and the local-dev `.env` sets `SENTRY_ENVIRONMENT=local` so laptop errors never mix into the dev box's view. The admin dashboard's recent-issues feed and its "Open in Sentry" link are **scoped to the box's own environment** (`fetchRecentIssues` passes `&environment=` — before 2026-06-12 it didn't, so both dashboards showed the union of all environments). In the Sentry UI, use the environment selector (top bar) or the env-pinned dashboards **TryOn Backend — 🟢 Production** / **🛠 Development** to view one environment at a time.

**Crons (scheduled-job monitoring):** the four meaningful BullMQ scheduled jobs check in to Sentry Crons via [utils/cronMonitor.ts](backend/src/utils/cronMonitor.ts) (`withCronMonitor` wraps each worker's processor): `vulnerability-scan` (daily 2:00), `guest-cleanup` (daily 3:00), `guest-abuse-monitor` (hourly), `s3-orphan-scan` (weekly Sun 3:00). Monitors are upserted on first check-in (no manual UI setup) and Sentry alerts when a run errors, overruns `maxRuntime`, or **never starts** — the failure mode logs can't catch. Check-ins are skipped outside the `production`/`development` environments so a laptop backend doesn't page "missed run" all day. The 5-minute queue-health check is deliberately not monitored (too chatty; it's itself a monitor). If a job's schedule changes, keep `withCronMonitor`'s crontab in sync with the BullMQ `repeat.pattern` beside it.

See the Environment Variables section for `SENTRY_*`, and the Admin Dashboard's **🩺 Diagnostics** tab (below) for live status + a test button.

**Mobile (React Native) Sentry** mirrors this posture and is **LIVE as of the 1.0.17 production builds (2026-06-10)**. `@sentry/react-native` is initialized in [frontend/App.tsx](frontend/App.tsx), **gated on `EXPO_PUBLIC_SENTRY_DSN`** — unset = no-op passthrough (so local dev clients without the env var stay dark). `sendDefaultPii: false` and errors-only (`tracesSampleRate` 0), matching the backend. The activation lives in **EAS production env vars** (project `@bruhnf/tryon`): `EXPO_PUBLIC_SENTRY_DSN` + `EXPO_PUBLIC_SENTRY_ENVIRONMENT=production` (plaintext) and `SENTRY_AUTH_TOKEN` (secret, write-scoped) for source-map/dSYM upload via the Expo config plugin. ⚠️ The plugin **hard-fails the iOS archive** if `SENTRY_AUTH_TOKEN` is missing or lacks upload permission (two builds were lost to this — escape hatch: `SENTRY_DISABLE_AUTO_UPLOAD=true`). The RN project is `bruhnfreemancom/react-native` (separate DSN from the backend's `node-express` project). Five monitoring dashboards live at https://bruhnfreemancom.sentry.io/dashboards/ (Mission Control, Mobile Crash Watch, Backend API Health, User Impact, Release Quality).

---

## Architecture

### Website (`website/`)
Static landing page for TryOn Mirror with web authentication. Hosted via the nginx container (mounted as `/var/www/website` per `docker-compose.prod.yml`).

- **index.html** — Main landing page promoting TryOn app
- **login.html** — Web login page
- **signup.html** — Web signup page
- **account.html** + **js/account.js** — logged-in account page
- **tryons.html** + **js/tryons.js** — logged-in "My Try-Ons" page (the user-facing web portal for try-on history, via `GET /api/tryon/history`). Each session card shows **only two input thumbnails** — the body photo and the clothing item — plus the optional caption, date, privacy toggle and delete. Tapping either thumbnail (or "View all") opens a **full-screen carousel** that pages through *every* image in that session (both inputs, no badge, and the AI results, each with the ✨ AI-generated badge) with prev/next arrows, a counter, and keyboard (←/→/Esc) navigation.
- **sms.html** — SMS opt-in page
- **privacy.html** — **Privacy Policy** (linked from Settings, Signup consent, and PurchaseScreen disclosures). Required by App Store Review.
- **terms.html** — **Terms of Service** (same link surfaces). Required by App Store Review.
- **css/style.css** — Black/white minimal design
- **js/auth.js** — Client-side authentication (calls backend API)

**URLs:**
- `https://tryon-mirror.ai` — Landing page
- `https://tryon-mirror.ai/privacy.html` — Privacy Policy (referenced from `frontend/src/constants/legal.ts`)
- `https://tryon-mirror.ai/terms.html` — Terms of Service (same)
- `https://www.tryon-mirror.ai` — Redirects to non-www
- `https://api.tryon-mirror.ai` — Backend API
- `https://api.tryon-mirror.ai/admin` — Admin web dashboard (requires `ADMIN_API_KEY`)

**Note:** The website makes API calls to `api.tryon-mirror.ai`. Ensure `ALLOWED_ORIGINS` in backend `.env` includes `https://tryon-mirror.ai`. Website files (`privacy.html`, `terms.html`, etc.) are bind-mounted into the nginx container (`./website:/var/www/website:ro` in `docker-compose.prod.yml`), so a plain `git pull` on Lightsail surfaces them immediately — no container restart or rebuild needed for HTML-only changes.

> **⚠️ Gotcha — world-readable perms after `git pull`.** The prod host's umask is `007`, so files **created or modified** by `git pull` land as `rw-rw----` (660, no world-read). The nginx worker runs as a non-root user inside the container and returns **403** for any website file it can't read — so a *new* page (e.g. `sms.html`) or a *changed* page (e.g. an edited `privacy.html`) 403s while untouched files keep serving. Fix after any website change: `chmod -R a+rX website` on the prod host (bind-mounted, takes effect immediately, no restart). Symptom: 403 on the new/changed page, other pages fine.

### Backend (`backend/src/`)
Express app with JWT authentication and BullMQ job queue for async AI image generation.

- **Entry point**: `index.ts` — mounts all middleware (Helmet, CORS, rate limiting) and routes
- **Routes**: `routes/` — `auth` (signup / login / refresh / logout / forgot-password / reset-password / resend-verification, plus authenticated `POST /change-password` which requires the current password and rotates the bcrypt hash + revokes every refresh token for the user; plus the **guest-mode** pair `POST /guest` — mints an anonymous account — and authenticated `POST /claim` — converts the current guest into a real account; see Guest Mode in Key Business Rules), `upload`, `tryon` (submit / `GET /history` / `GET /:jobId` / `POST /bulk-delete` / `PATCH /:jobId/privacy` (blockGuests) / `PATCH /:jobId/title` — set or clear the optional caption, owner-only, requireAuth only since captioning isn't a publish action), `admin`, `friends`, `feed`, `profile` (includes `POST /me/ai-consent` and `DELETE /me/ai-consent` — see AI Processing Consent in Key Business Rules), `credits`, `notifications`, `likes`, `appleWebhook` (mounted at `/api/webhooks/apple`), `moderation` (mounted under `/api`, exposes `/reports`, `/users/:id/block`, `/users/me/blocks`), `comments` (mounted under `/api`, exposes `GET/POST /tryon/:jobId/comments` and `DELETE /comments/:commentId`), `closet` (mounted at `/api/closet` — Outfit Designer: `POST /generate` text-to-outfit via Grok Imagine, `GET /` list, `PATCH /:itemId` rename, `DELETE /:itemId`; requireAuth + blockGuests, 3/min rate limit on generate — see Outfit Designer & Closet in Key Business Rules), `video` (mounted at `/api/video` — AI image-to-video: `POST /` submit (multipart `photo` OR `sourceJobId` OR `bodyPhoto`), `GET /` the caller's completed videos; requireAuth + blockGuests, 3/min rate limit — see AI Video in Key Business Rules)
- **Controllers**: `controllers/` — one per route group
- **Services**: `services/grokService.ts` — calls xAI Grok Imagine API for AI image generation
- **Services**: `services/locationService.ts` — geo-IP lookup and suspicious-location detection
- **Services**: `services/emailService.ts` — sends account verification and transactional emails
- **Queue**: `queue/` — BullMQ workers consume try-on job payloads backed by Redis
- **Middleware**: `middleware/` — JWT verification, subscription gating, upload validation
- **Prisma**: `prisma/schema.prisma` — database schema; migrations in `prisma/migrations/`

**Try-on flow:**
1. Client uploads 1 item of clothing or outfit photo → S3 via multer-s3
2. Backend determines which user body photos exist (full body, medium — never close-up/profile)
3. If neither full body nor medium exists → return 422 with `NO_BODY_PHOTOS` error code; frontend shows the upload prompt dialog
4. Weekly + storage caps enforced (`TRYON_LIMIT_REACHED` if user has 500 stored sessions; `WEEKLY_LIMIT_REACHED` for subscribers without credits)
5. Credit deduction tagged with `(job=<jobId>)` in the `CreditTransaction.description` so the worker can refund on terminal failure
6. **Soft throttle** runs (`services/throttleService.ts`) — see "Soft per-user throttle" under Key Business Rules. Computes a BullMQ `delay` and stores the effective start time on `TryOnJob.scheduledStartAt` so the client can render a "starts in X:XX" countdown.
7. Job queued in Redis (BullMQ) with S3 keys for clothing photo + available user body photo keys
8. Worker calls Grok Imagine API once per available body photo perspective
9. Result images stored in S3; job result written back to DB
10. Client polls or receives push notification on completion
11. **Terminal failure path:** after BullMQ exhausts retries (3 attempts with exponential backoff), the worker's `failed` handler marks the row `FAILED`, looks up the `(job=<jobId>)`-tagged `USAGE` CreditTransaction, and — if found — creates a matching `REFUND` transaction + increments `User.credits`. Idempotent on the REFUND tag so duplicate failure events don't double-refund. **Every terminal failure (and every partial moderation block) also emails `ADMIN_EMAILS`** via `sendTryOnFailureAlert` (still email-only from the backend — the toll-free SMS number `+18337624449` is approved/active as of 2026-06-13 and usable for manual/ops texts, but no backend SMS sender is wired into the alert path yet).
12. **Partial-results handling (moderation AND transient failures):** per-perspective outcomes are classified by [utils/moderationGrace.ts](backend/src/utils/moderationGrace.ts) (`classifyOutcomes`, unit-tested). If at least one perspective generates, the job **COMPLETEs with the survivors** (`perspectivesUsed` lists only what was delivered) and a user-facing note is stored in the COMPLETE job's `errorMessage` (rendered by `TryOnScreen`'s ResultView): (a) a **moderation partial** (Grok blocked one view) → no strike, no refund — a result was delivered and the surviving perspective passing is evidence of a filter false positive; (b) a **transient partial** (Grok 5xx/S3/download error still failing on the FINAL retry attempt) → **credit refunded** + note saying so. Earlier attempts still rethrow so BullMQ retries the whole job (persisted perspectives are skipped on retry). Total losses: ALL perspectives moderated → `CONTENT_MODERATED` failure with a strike, where the first `MODERATION_GRACE_WARNINGS` (3) strikes are refunded **warnings** ("warning N of 3") and strike 4+ applies the ToS §5.4 no-refund policy; ALL lost with ≥1 transient error → ordinary terminal failure (refund, **no** strike — an error, not the filter, may explain the miss).

**Body photo priority rule (enforced in service layer):**
- Primary output: full body photo perspective
- Fallback: medium/waist-up photo perspective
- Close-up/profile photo: NEVER used as input to Grok Imagine

### Frontend (`frontend/src/`)
React Native app using Expo with React Navigation and Zustand for state.

- **Screens**: `screens/`
  - `LoginScreen` — email + password
  - `SignupScreen` — email + password only (1.0.17; no photo required to proceed). No username field: a claiming guest keeps their `user#######` handle and a direct signup gets one generated server-side — changeable later in EditProfile. Consent checkbox links to Privacy Policy and Terms of Service.
  - `OnboardingPhotoScreen` — soft prompt to upload body photos after signup; can skip
  - `HomeScreen` — scrollable feed of community try-on results. The author's optional caption (`TryOnJob.title`) renders under the result image, above the like/comment footer. **VIDEO** posts render the poster (source image) with a ▶ overlay → tap opens `VideoPlayerModal`. Three-dot menu on each card for Report/Block (own posts: Make Private/Share/Delete).
  - `TryOnScreen` — main feature; upload 1 clothing/outfit photo, view AI results. Has an optional **caption** field (`TryOnJob.title`) and a prominent **"Design Your Own Outfit"** card (gold-on-black, below the privacy toggle) linking to the Closet. The "Photograph an outfit…" helper text sits below the clothing photos.
  - `VideoScreen` — AI **image-to-video**: pick a source (a completed try-on, a camera-roll photo, or a profile body photo) + a motion prompt ("wave and smile", "do a spin"), optional caption, privacy toggle; surfaces `AiConsentModal`; polls `GET /api/tryon/:jobId` and shows the result in an `expo-video` `VideoView`. The **Video** bottom tab + the 3-dot "Animate a Photo (Video)" item open it. See AI Video in Key Business Rules.
  - `ProfileScreen` — avatar, full body photo, medium photo, stats, results grid (VIDEO entries show their poster with a ▶ overlay → open `VideoPlayerModal`)
  - `PublicProfileScreen` — view another user's public profile and try-on history. Header three-dot menu for Report/Block. Shows "you've blocked this user" empty state when applicable.
  - `EditProfileScreen` — edit bio, username, body photos
  - `FriendsScreen` — Following / Followers tabs + search
  - `InboxScreen` — in-app notifications (FOLLOW / LIKE / COMMENT / COMMENT_REPLY / COMMENT_LIKE / TRYON_COMPLETE). LIKE / COMMENT / COMMENT_REPLY / COMMENT_LIKE taps open the relevant try-on's comment thread (deep-linking to the specific comment when `commentId` is set); FOLLOW taps open the actor's profile.
  - `TryOnCommentsScreen` — full-screen comment thread for a single TryOn. Reached from the comments icon on every Home feed card and from COMMENT / COMMENT_REPLY / COMMENT_LIKE / LIKE notifications. Supports single-level replies (Instagram-style) and per-comment likes. Comment authors can delete their own comments; TryOn owners can delete any comment on their own post (cascade-deletes its replies); other users can Report.
  - `SettingsScreen` — account (Email, Username, Tier, Credits, Change Password), subscription (Restore Purchases, Manage Subscription deep link), Privacy & Data (Blocked Users, AI Processing Consent status + Revoke button when granted, Delete Body Photos, Export My Data, Delete Account), Announcements ("Show Announcement at Launch" switch for the currently published splash — see Splash / Announcement Screen under Key Business Rules), Legal (Privacy/Terms in WebBrowser), Admin (only visible to admin allowlist)
  - `ChangePasswordScreen` — modal launched from Settings → Account → Change Password. Requires current password as re-auth, enforces the same complexity rules as signup, and forces re-login on success (server invalidates all refresh tokens).
  - `BlockedUsersScreen` — list and unblock previously-blocked users (modal presentation so it stacks above Settings)
  - `AdminConsoleScreen` — admin-only screen, route only registered when `__DEV__ || user.isAdmin`
  - `PurchaseScreen` — StoreKit-driven purchase flow. Fetches localized prices from Apple, presents tiers + credit packs, real Restore Purchases. Auto-renew disclosure rendered adjacent to each subscribe button (App Store Guideline 3.1.2(a)).
- **Components**: `components/` — shared UI:
  - `CreditDisplay`, `HeaderMenu`
  - `TryOnResultCard`, `TryOnDetailModal`, `FullScreenImageModal` — each renders `AiGeneratedBadge` over result images
  - `AiGeneratedBadge` — visible "✨ AI-generated" pill required by Guideline 4.0
  - `AiConsentModal` — explicit opt-in dialog naming xAI / Grok Imagine, listing what is sent / not sent, with links to our and xAI's privacy policies. Surfaced by `TryOnScreen.handleSubmit` **and `VideoScreen`** whenever `user.aiProcessingConsentAt` is null; on agree it posts `/api/profile/me/ai-consent`, updates the user store, then calls back so the caller retries the submit. Required by App Store Guidelines 5.1.1(i) / 5.1.2(i).
  - `VideoPlayerModal` — full-screen looping `expo-video` player (with `AiGeneratedBadge`) for an AI video result. Opened from the HomeScreen feed card and the ProfileScreen grid when a job is `kind:VIDEO`. (`expo-video` is a native module — requires a dev-client/EAS rebuild, not just a JS reload.)
  - `ReportSheet` — bottom-sheet modal with 6 reason options (INAPPROPRIATE, HARASSMENT, IMPERSONATION, SPAM, COPYRIGHT, OTHER) + free-text details. Used by HomeScreen, PublicProfileScreen, and TryOnCommentsScreen.
  - `SplashAnnouncementModal` — backend-controlled launch announcement. Mounted once in `navigation/index.tsx` inside the NavigationContainer; fetches `GET /api/splash` on cold start and shows the published image full-screen behind an OK gate ("Don't show this again" appears from the second showing of the same splash). Local seen/dismiss state lives in SecureStore keyed by the splash id (`utils/splash.ts` — pure decision logic unit-tested). Renders nothing when no splash is published or on any fetch error — it must never block startup. See Splash / Announcement Screen under Key Business Rules.
- **Services**: `services/iap.ts` — wraps `expo-iap`. Manages connection lifecycle, fetches localized products, initiates StoreKit purchases with `appAccountToken: user.id`, posts signed JWS to backend `/api/credits/verify-receipt`, finishes transactions only after backend confirms.
- **State**: `store/useUserStore.ts` — Zustand store holding authenticated user (including `isAdmin` flag from server). `store/useNotificationStore.ts` — unread count for inbox tab badge.
- **API config**: `config/api.ts` — base URL switching between dev and production
- **Constants**: `constants/legal.ts` — Privacy Policy URL, Terms of Service URL, support / privacy email addresses
- **Hooks**: `hooks/useTryOn.ts`, `hooks/useBodyPhotos.ts`

**Navigation structure:**
- **Guest sessions are always signed in.** On first open, `useUserStore.initialize()` mints an anonymous guest (`POST /auth/guest`) when **no token is stored**. The root navigator branches on `user.isGuest`: a guest gets the main tabs (browsable feed + a free try-on) with the Profile and Inbox tabs replaced by `GuestProfileScreen` / `GuestPromptScreen`, and the Login/Signup flow (`AuthNavigator`) presented as a **modal** named `Auth`. On successful login/conversion the store flips `isGuest` to false and the whole guest branch is swapped for the real-user screens (no manual modal dismissal). See Guest Mode in Key Business Rules.
- **Returning real user with a dead session → Login, not guest.** A stored token belongs to either a `'real'` or `'guest'` session (persisted as `session_kind` in SecureStore alongside the tokens). If bootstrap (or a mid-session refresh failure) finds the token unusable (4xx / refresh failed), it routes a **real** session to the full-screen `AuthNavigator` (re-authenticate into the real account) by setting `sessionEnded`, while a **guest** or genuinely tokenless session falls back to a fresh guest. This prevents silently demoting a verified user to a credited guest. `setUser` clears `sessionEnded`; a true network/5xx error sets `bootstrapError` (retry screen) instead.
- Authenticated tabs (1.3.0): Home | Friends | Design | [Camera FAB — TryOn] | Video | Inbox | Profile (7 tabs). **Design** opens the Closet / Outfit Designer (`ClosetScreen`; guests → `GuestPromptScreen`). **Video** opens `VideoScreen` (AI image-to-video; guests → `GuestPromptScreen`). The `Closet` card route still exists for picker mode (TryOn → "pick from closet") and the 3-dot menu; ClosetScreen hides its back chevron when it's the Design tab root (`navigation.canGoBack()`).
- Modal screens: Settings, EditProfile, AdminConsole (dev/admin-only), Purchase, BlockedUsers, Auth (guest only)
- Card screens: PublicProfile, TryOnComments (both reachable by guests — browsing is open)

**UI style:** Clean white/minimal design (see design screenshots). Black-and-white accent palette. Bottom tab bar with prominent centered camera FAB for quick try-on access. Typography: bold headers, light body text. Rounded pill-shaped toggle buttons for option selection.

---

## Database Schema (PostgreSQL via Prisma)

### Users
```
id                       String    @id @default(uuid())
username                 String    @unique @db.Citext  // citext = case-INSENSITIVE uniqueness + lookups ("Bruhn" can't join when "bruhn" exists). App-level conflict checks also use mode:'insensitive'; creation paths map the P2002 check-then-create race to 409, not 500
email                    String?   @unique @db.Citext  // null for guest accounts until they convert (Postgres allows multiple NULLs under a unique index). citext = case-insensitive uniqueness AND login/forgot-password lookups
emailNormalized          String?   @unique @db.Citext  // anti-farming canonical form of email (lowercased, "+tag" stripped, Gmail dots removed — utils/emailNormalize.ts). Deduped at signup/claim so one inbox can't mint many accounts to farm welcome+referral credits. Display/mail still use verbatim `email`. Null for guests.
passwordHash             String?                       // null for guest accounts
isGuest                  Boolean   @default(false)     // anonymous guest session (see Guest Mode). Real tokens, but rejected from social writes by blockGuests; their try-ons are forced private
deviceId                 String?                       // iOS identifierForVendor (or Android SSAID) of the device that created the guest. Lets POST /auth/guest reuse one guest per device instead of churning a new row each logout/reopen. Indexed; stays set after conversion (reuse lookup filters isGuest=true)
verified                 Boolean   @default(false)
verifyToken              String?
verifyTokenExpiry        DateTime?
passwordResetToken       String?
passwordResetTokenExpiry DateTime?
tier                     UserTier  @default(FREE)   // FREE | BASIC | PREMIUM
credits                  Int       @default(0)
tryOnCount               Int       @default(0)      // lifetime successful try-ons
moderationBlockCount     Int       @default(0)      // lifetime try-on generations blocked by xAI content moderation (banned-content attempts); incremented by the worker on terminal CONTENT_MODERATED failure; drives the admin strike badge + repeat-offender alert
lastModerationBlockAt    DateTime?                  // timestamp of the most recent content-moderation block
lastFreeCreditGrantAt    DateTime?                  // set once at email verification; retained for audit only
aiProcessingConsentAt    DateTime?                  // most recent explicit consent to send body+clothing photos to xAI/Grok; null = consent required (App Store 5.1.1(i)/5.1.2(i))
throttleResetAt          DateTime?                  // soft try-on throttle ignores jobs before this time; stamped on credit purchase / subscription so a paying user starts with a clean burst (see Soft per-user throttle)
firstName                String?
lastName                 String?
bio                      String?
avatarUrl                String?   // S3 key — close-up; profile display only, never sent to Grok
fullBodyUrl              String?   // S3 key — full-body front; primary Grok input
mediumBodyUrl            String?   // S3 key — waist-up; fallback Grok input
followingCount           Int       @default(0)
followersCount           Int       @default(0)
likesCount               Int       @default(0)
address                  String?
city                     String?
state                    String?
createdAt                DateTime  @default(now())
updatedAt                DateTime  @updatedAt
```

### ApplePurchase
One row per StoreKit transaction. `originalTransactionId` ties renewals together so the active entitlement can be resolved.
```
id                    String    @id @default(uuid())
userId                String
transactionId         String    @unique  // unique per renewal
originalTransactionId String              // stable across renewals
productId             String              // e.g. com.evofaceflow.tryon.basic.monthly
tier                  UserTier            // tier this purchase grants
expiresAt             DateTime?           // null for non-subscription IAPs
rawReceipt            String?             // signed JWS payload, kept for audit
revokedAt             DateTime?           // set on REFUND / REVOKE
autoRenewStatus       Boolean?            // latest auto-renew preference from Apple's signedRenewalInfo. true = will renew at expiresAt, false = pending cancellation (entitlement valid until expiresAt then drops to FREE), null = unknown / credit pack
appleStatus           Int?                // Apple Status enum from App Store Server API (1=ACTIVE, 2=EXPIRED, 3=BILLING_RETRY, 4=GRACE_PERIOD, 5=REVOKED). Null until admin runs "Refresh from Apple". Webhooks alone can't surface BILLING_RETRY or GRACE_PERIOD.
lastSyncedFromAppleAt DateTime?           // timestamp of last successful Server API pull for this row (admin-triggered)
createdAt             DateTime  @default(now())
updatedAt             DateTime  @updatedAt
```

### Like
```
id        String   @id @default(uuid())
userId    String
jobId     String   // TryOnJob being liked
createdAt DateTime @default(now())
@@unique([userId, jobId])
```

### Notification
In-app notifications shown on the Inbox screen. Distinct from Apple Server Notifications.
```
id        String           @id @default(uuid())
userId    String           // recipient
type      NotificationType // FOLLOW | LIKE | TRYON_COMPLETE | COMMENT | COMMENT_REPLY | COMMENT_LIKE
actorId   String?          // who triggered it
jobId     String?          // related TryOnJob, if any (set for LIKE / COMMENT / COMMENT_REPLY / COMMENT_LIKE / TRYON_COMPLETE)
commentId String?          // set for COMMENT_REPLY (the parent comment that was replied to) and COMMENT_LIKE (the comment that was liked). Lets the inbox deep-link straight to that comment in the thread.
read      Boolean          @default(false)
createdAt DateTime         @default(now())
```

### RefreshToken
Only the SHA-256 `token` hash is stored (never the raw token). When
`REFRESH_TOKEN_ROTATION` is on, a refresh **tombstones** the old row (sets
`rotatedAt` + `replacedByToken`) instead of deleting it, so a crash-in-the-gap
replay can be recovered rather than revoking the family — see the refresh-token
rotation note under Security Notes.
```
id              String    @id @default(uuid())
userId          String
token           String    @unique   // SHA-256 hash of the refresh token
expiresAt       DateTime
createdAt       DateTime  @default(now())
rotatedAt       DateTime?            // set when consumed by a rotation; null = active
replacedByToken String?              // SHA-256 hash of the successor token minted at rotation
```

### TryOnJobs
```
id                String    @id @default(uuid())
userId            String
status            JobStatus  // PENDING | PROCESSING | COMPLETE | FAILED
isPrivate         Boolean   @default(false)
kind              TryOnKind @default(IMAGE)  // IMAGE = clothing try-on; VIDEO = AI image-to-video clip (see AI Video). Videos reuse this table so feed/profile/looks/comments/likes/share/moderation/S3-cleanup all work unchanged.
clothingPhoto1Url String?    // S3 key — NULLABLE: video jobs have no clothing item (their single input is bodyPhotoUrl). Always set for IMAGE try-ons.
clothingPhoto2Url String?    // S3 key
resultFullBodyUrl String?    // S3 key — result image for full body perspective (IMAGE only)
resultMediumUrl   String?    // S3 key — result image for medium perspective (IMAGE only)
bodyPhotoUrl      String?    // S3 key — IMAGE: body photo input (full preferred, medium fallback). VIDEO: the source image being animated, which also serves as the poster/thumbnail.
videoUrl          String?    // S3 key (tryon-videos/) of the generated .mp4 — VIDEO only
motionPrompt      String?    @db.VarChar(300)  // VIDEO only — the user's motion/animation prompt
perspectivesUsed  String[]   // ["full_body", "medium"] — records which inputs were used
likesCount        Int        @default(0)  // denormalized for feed performance
commentsCount     Int        @default(0)  // denormalized for feed performance
creditsAtTime     Int?       // user's credit balance at submit time (pre-deduction)
scheduledStartAt  DateTime?  // set when the soft throttle deferred this submission; null = run immediately. Used by the client to render a "starts in X:XX" countdown.
title             String?    @db.VarChar(140)  // optional user-authored caption shown under the result image on the feed + web "My Try-Ons". Trimmed / control-chars stripped / length-capped by sanitizeTryOnTitle; plain text, never rendered as HTML. Captured at submit time and editable via PATCH /api/tryon/:jobId/title.
errorMessage      String?
createdAt         DateTime  @default(now())
updatedAt         DateTime  @updatedAt
```

### Comment
User-authored comment on a public TryOnJob. Stored in the `comments` table. **Threading is single-level** (Instagram-style): a top-level comment has `parentId = null`; a reply has `parentId` set to a top-level comment's id. Replies cannot themselves have replies — the API rejects `parentId` pointing to a non-top-level comment. Deleting a parent cascades to its replies via FK ON DELETE CASCADE; `TryOnJob.commentsCount` is decremented by 1 + replies on cascade. The frontend renders comments oldest-first below the TryOn image in `TryOnCommentsScreen`, with replies nested under their parent.
```
id        String   @id @default(uuid())
jobId     String   // parent TryOnJob
userId    String   // author
body      String   // 1-500 chars, trimmed
parentId  String?  // null = top-level; set = reply to a top-level comment
createdAt DateTime @default(now())
updatedAt DateTime @updatedAt
```

### CommentLike
Per-(user, comment) like. Backs the heart icon on each comment in `TryOnCommentsScreen`. Unique constraint enforces idempotency — a second POST is a no-op rather than a duplicate row. Notifies the comment author with type `COMMENT_LIKE` (skipped on self-like and on relike-after-unlike).
```
id        String   @id @default(uuid())
userId    String
commentId String
createdAt DateTime @default(now())
@@unique([userId, commentId])
```

### UserLocations
Stores up to the last 10 login/session locations per user. A trigger or service layer prunes older rows when count exceeds 10.
```
id                String   @id @default(uuid())
userId            String
ip                String
country           String?
region            String?
city              String?
latitude          Float?
longitude         Float?
timezone          String?
trigger           String?  // "login" | "token_refresh" | "manual"
suspiciousLocation Boolean @default(false)
distanceFromLast  Float?   // km from previous location
timestamp         DateTime @default(now())
```

### Follows
```
followerId  String
followingId String
createdAt   DateTime @default(now())
@@id([followerId, followingId])
```

### AppSettings (admin-controlled)
Key/value store for runtime-tunable values that can change without a redeploy. Known keys: `guestCreditGrant` (guest welcome-credit grant), `signupCreditGrant` (real-account welcome-bonus / "join offer" grant — default 10, 0 = discontinued; see Free credit policy), `referralCreditGrant` (referral reward to BOTH sides — default 5, 0 disables; see Engagement & Growth Features), `referralMaxPerWindow` (anti-farming per-referrer cap — max REWARDED referrals one referrer can earn per rolling `REFERRAL_REWARD_WINDOW_DAYS`=30; default 20, 0 = unlimited; over the cap the referrer's payout is withheld but the invitee is still paid), `videoCreditCost` (credits charged per AI video — default 2, min 1; see AI Video), `throttleConfig` (the soft try-on queue config as a JSON blob — window + per-tier burst + delay ladder; read/written via [services/throttleService.ts](backend/src/services/throttleService.ts), default 15-min window / burst 6·8·10 / ladder 10·20·30·40s; see Soft per-user throttle) — all edited via Admin Dashboard → ⚙️ Settings and read through [services/appSettingsService.ts](backend/src/services/appSettingsService.ts) (except `throttleConfig`, owned by `throttleService.ts`) — and the alert-debounce timestamps `guestAbuseLastAlertAt` + `referralAbuseLastAlertAt`.
```
key       String @id
value     String
updatedAt DateTime @updatedAt
```

### CreditTransaction
```
id          String   @id @default(uuid())
userId      String
type        CreditTransactionType  // PURCHASE | GRANT | USAGE | REFUND
amount      Int                    // positive for grants/purchases, negative for usage
description String?
createdAt   DateTime @default(now())
```

### Report
User-submitted content/user reports. Required by App Store Review Guideline 1.2.
```
id           String           @id @default(uuid())
reporterId   String
targetType   ReportTargetType // TRYON_JOB | USER | COMMENT
targetId     String           // TryOnJob.id or User.id depending on targetType
reason       ReportReason     // INAPPROPRIATE | HARASSMENT | IMPERSONATION | SPAM | COPYRIGHT | OTHER
details      String?          // optional free-text from reporter
status       ReportStatus     // OPEN | REVIEWING | RESOLVED_REMOVED | RESOLVED_NO_ACTION
resolverNote String?          // admin note when resolving
resolvedAt   DateTime?
createdAt    DateTime         @default(now())
```

### UserBlock
Mutual-invisibility between two users. The blocked party also cannot see the blocker's content (prevents retaliation discovery).
```
blockerId String
blockedId String
createdAt DateTime @default(now())
@@id([blockerId, blockedId])
```

---

## Key Business Rules

### Body Photo Handling
- **avatarUrl** (close-up): displayed as profile photo everywhere. Never sent to Grok Imagine.
- **fullBodyUrl**: primary input to Grok Imagine. Priority 1 for output.
- **mediumBodyUrl**: fallback input. Used when fullBodyUrl is absent.
- If neither fullBodyUrl nor mediumBodyUrl exist: block try-on and prompt user to upload.
- If only avatarUrl exists: block try-on and prompt user to upload a medium or full body photo.
- The number of result images returned matches the number of available body photo perspectives (max 2).

### Onboarding / Photo Upload Consent
- Sign-up requires only: valid email + strong password (1.0.17). `username` is optional in the signup/claim schemas — the app omits it (a claimed guest keeps their generated `user#######`; a direct signup gets one minted server-side via `generateUniqueUsername()`), and it stays renameable in Edit Profile. The website signup form is email+password too.
- Email verification is required before the user can use try-on features.
- After signup, an onboarding screen encourages uploading body photos. It is skippable.
- Photo upload screens (Onboarding, Profile, EditProfile) display a passive consent notice acknowledging that body photos are stored on cloud infrastructure and may be processed by AI to generate try-on results, and that users may delete them from Settings at any time. This notice covers the *storage* of photos.
- Body photo upload is also accessible at any time from Profile > Manage Body Photos.
- **Sending photos to xAI is gated by a separate explicit consent step** (see AI Processing Consent below). The passive upload notice is not, by itself, sufficient for Apple Guidelines 5.1.1(i) / 5.1.2(i) — the explicit per-user opt-in modal at try-on time is.

### AI Processing Consent (App Store Guidelines 5.1.1(i) / 5.1.2(i))
Apple requires explicit per-user opt-in before any personal data is transmitted to a third-party AI service. This is **independent** of the Privacy Policy disclosure — Apple's rejection text says "only including this information in the app's Terms of Service or Privacy Policy is not sufficient."

- `User.aiProcessingConsentAt: DateTime?` records the timestamp of the user's most recent explicit consent. Null = no consent on file or revoked.
- The mobile app's `AiConsentModal` ([frontend/src/components/AiConsentModal.tsx](frontend/src/components/AiConsentModal.tsx)) is surfaced from `TryOnScreen.handleSubmit` whenever `user.aiProcessingConsentAt` is null. It names xAI by full legal name ("xAI, Inc."), lists exactly what is sent (full-body and/or waist-up photo + clothing photo), states what is NOT sent (close-up profile photo), links to both our Privacy Policy and xAI's Privacy Policy, and requires an affirmative `I Agree and Continue` tap.
- On agree, the client POSTs `/api/profile/me/ai-consent`, updates the user store, then retries the try-on submit.
- Revocation: `DELETE /api/profile/me/ai-consent`. Surfaced as "Revoke AI Processing Consent" in Settings → Privacy & Data (only shown when consent is currently granted).
- Server-side enforcement: `tryonController.submitTryOn` refuses with `403 { error: 'AI_CONSENT_REQUIRED' }` when `aiProcessingConsentAt` is null. The check runs before any S3 upload or credit deduction. The frontend re-opens the consent modal on this error code so a stale client cache can recover.
- **Companion documentation:** the in-app consent modal is the primary control, but Apple also requires the privacy policy and EULA to describe the AI processing in detail. `website/privacy.html` §5 covers what is sent, the no-AI-training commitment, equivalent-third-party-protection language, and revocation; `website/terms.html` §5 covers AI output ownership, prohibited uses (deepfakes, NCII, model-training, etc.), and the Apple-mandated minimum EULA clauses. Both must stay in sync with the modal's claims — if the consent dialog text changes, those documents need matching updates.
- **Camera-permission UX:** `TryOnScreen.pickClothingPhoto` shows the source-choice action sheet (Take Photo / Choose from Library / Cancel) **before** requesting any iOS Camera permission. Camera permission is only requested when the user explicitly picks "Take Photo". Denial routes to a helpful "Camera Access Needed" alert with Choose-from-Library / Open-Settings / Cancel buttons. This pattern follows Apple HIG (ask in context, when the user expresses intent) and was a contributor to the original reviewer's 5.1.1(i) confusion — they reached only the Camera permission's purpose string and concluded the app had no AI-data-sharing disclosure beyond that string. Don't revert to up-front permission requests.

### Guest Mode (browse & try before signup)
New users open the app straight into the browsable feed instead of a sign-in wall — they can scroll the feed, view public profiles, read comment threads, and run a couple of free try-ons before creating an account. This reduces signup friction and is favorable under App Store Guideline 5.1.1(v).

- **Identity:** On first open, `useUserStore.initialize()` calls `POST /api/auth/guest` ([authController.createGuest](backend/src/controllers/authController.ts)) when no token is stored. This creates a real `User` row with `isGuest=true`, a generated `user#######` username, `email=null`, `passwordHash=null`, `verified=true`, and `credits=<guest welcome grant>` (admin-configurable, default 2), and returns normal access+refresh tokens. The grant amount is read at runtime via `getGuestCreditGrant()` ([services/appSettingsService.ts](backend/src/services/appSettingsService.ts)) from the `AppSettings` row keyed `guestCreditGrant`, editable in the Admin Dashboard → **⚙️ Settings** tab without a redeploy. **Anti-farming: the welcome grant is only applied when the request carries a non-empty `deviceId`** — a null/empty deviceId (web, simulator, pre-rebuild dev client) still gets a working guest but **0 credits**, since those calls can't be deduped server-side and would otherwise mint a fresh grant every time. The `guest_create` metric/abuse-counter row is likewise only recorded when a grant was actually made.
- **Device-scoped reuse (no row churn):** the client sends its `deviceId` (iOS identifierForVendor via `expo-application`, Android SSAID) on `POST /auth/guest`. If a guest already exists for that device (`isGuest=true`), the endpoint hands back a fresh session for that **same** row instead of minting a new one — so logout/reopen don't churn a new guest each time, and the welcome grant + the `guest_create` sign-up metric happen **once per device**. The reuse lookup filters `isGuest=true`, so a device whose guest already converted gets a fresh guest. IDFV resets only on a full uninstall-of-all-vendor-apps (≈ a genuinely new install). `getIosIdForVendorAsync` is a native module → requires a dev-client/EAS rebuild, not just a JS reload. The guest is a genuine authenticated user, so every existing `requireAuth` **read** endpoint (feed, profile, comments) works unchanged — the work was adding *restrictions* on writes, not opening up reads. `isGuest` is baked into the JWT access-token payload so middleware can gate without a DB hit.
- **Write gating:** `blockGuests` ([middleware/auth.ts](backend/src/middleware/auth.ts)) returns `403 { error: 'GUEST_SIGNUP_REQUIRED' }` for guest sessions. Applied to all social writes: likes, follow/unfollow, comment create/delete + comment likes, reports, block/unblock, notifications, and change-password. **Not** applied to feed, profile reads, `ai-consent`, upload, or try-on submit — a guest's free try-on must reach those. The mobile client gates the same actions proactively via `requireRealUser()` ([frontend/src/utils/guestGate.ts](frontend/src/utils/guestGate.ts)) and the `api.ts` response interceptor catches `GUEST_SIGNUP_REQUIRED` centrally as a safety net.
- **Guest try-ons are forced private.** `tryonController.submitTryOn` sets `isPrivate=true` when `req.user.isGuest`, so anonymous accounts never publish public UGC (keeps the Guideline 1.2 moderation surface small). The try-on still requires a body-photo upload + the AiConsentModal — surface those as honest steps, not hidden behind the "free try-on" CTA.
- **Logout drops to a 0-credit guest.** Logging out of a real account mints a browsable guest session but passes `welcomeCredits:false` to `POST /auth/guest`, so the former real user is NOT handed a fresh 2-credit grant (that would be surprising and a trivial farm). The `welcomeCredits` flag can only *withhold* the fixed grant, never increase it, so it's not an abuse lever. First-open guests still get the full grant.
- **Conversion (claim):** `POST /api/auth/claim` ([authController.claimGuest](backend/src/controllers/authController.ts), `requireAuth` only — NOT blockGuests) upgrades the SAME guest row in place: sets name/username/email/passwordHash, flips `isGuest=false`, `verified=false`, issues a verify token, sends the verification email, and deletes the guest's refresh tokens. The guest's try-ons, credits, and AI consent carry over. The client (`SignupScreen`) posts to `/auth/claim` instead of `/auth/signup` when `user.isGuest`. After the user verifies their email and logs in, `verifyEmail` adds the standard `+10` welcome bonus **on top of** any remaining guest credits (additive — no double-grant; the verify token is single-use).
- **Abuse / cost:** the farming vector is wiping local state to mint a fresh guest grant. Note `expo-secure-store` is the iOS **Keychain**, which persists across app delete/reinstall by default — so a *casual* reinstall normally resumes the SAME guest (0 credits), not a new grant; only a full device erase / Keychain wipe yields a fresh guest. (Android SecureStore is cleared on uninstall, but the app is iOS-first.) Layered mitigations: small grant (2), re-upload-photo + re-consent friction each cycle, and a per-IP rate limit on `/auth/guest` (10/hour). iOS DeviceCheck is the real reinstall-proof prevention but is deliberately **not** built yet (native module + Apple key + can't test on simulator) — add it only if the monitor below shows real abuse.
- **Abuse monitoring (alerts, not prevention):** every genuine new-visitor guest creation (welcomeCredits granted, not a logout-minted 0-credit guest and not a device-reused session) records its IP as a `UserLocation` row with `trigger='guest_create'` via `recordLoginLocation` (geo-resolved like login rows since 2026-06-11 — earlier rows stored the bare IP, which the admin dashboard rendered as "Unknown" location). [queue/guestAbuseMonitorWorker.ts](backend/src/queue/guestAbuseMonitorWorker.ts) runs **hourly**, aggregates `guest_create` rows over a rolling window, and emails `ADMIN_EMAILS` (via `sendGuestAbuseAlert`, mirroring the S3-orphan alert) when sign-ups cross a global or per-IP threshold. Debounced via an `AppSetting` (`guestAbuseLastAlertAt`) so it won't re-alert within the cooldown. This is the "tell me if it's happening" layer since logs aren't watched daily.
- **Cleanup:** unconverted guests older than `GUEST_RETENTION_DAYS` (30) are deleted daily at 3:00 AM by [queue/guestCleanupWorker.ts](backend/src/queue/guestCleanupWorker.ts), which reuses [services/accountDeletionService.ts](backend/src/services/accountDeletionService.ts) `deleteUserAndAssets()` (extracted from `profileController.deleteAccount`) so the cascade + S3 cleanup stay in one place. (Cleanup keys on `createdAt`, so a long-lived same-device guest is also pruned at 30 days and re-minted fresh on next open.)
- **Tunables:** the guest welcome-credit grant (admin-editable at runtime via Admin Dashboard → **⚙️ Settings**, stored in `AppSettings.guestCreditGrant`; default `DEFAULT_GUEST_CREDIT_GRANT` in [services/appSettingsService.ts](backend/src/services/appSettingsService.ts)), `GUEST_RETENTION_DAYS` (guestCleanupWorker), the `/auth/guest` rate-limit bucket (index.ts), and the monitor's env vars `GUEST_ABUSE_WINDOW_HOURS` (24), `GUEST_ABUSE_GLOBAL_THRESHOLD` (100), `GUEST_ABUSE_PER_IP_THRESHOLD` (20), `GUEST_ABUSE_COOLDOWN_HOURS` (12) — raise the global threshold once you know your organic guest volume so a real launch spike doesn't page you.

### Outfit Designer & Closet (text-to-outfit → try-on)
Users describe an outfit in words; Grok Imagine generates it as a catalog-style clothing image; it's saved to the user's **closet** as virtual "custom clothing" and can be tried on like a photographed item.

- **Schema:** `ClosetItem` (`closet_items`: id, userId, name, description, imageUrl, timestamps; cascade on user delete; cap `CLOSET_ITEM_LIMIT` = 100/user). Images live under the **`closet/` S3 prefix** (4th TryOn prefix — included in the orphan scan, account deletion, admin user delete, and GDPR export).
- **Moderation surface (the E1/E2 concern) is wrapped server-side** in [backend/src/utils/outfitPrompt.ts](backend/src/utils/outfitPrompt.ts) (pure, unit-tested): the description is sanitized (control chars stripped, whitespace collapsed, 3–300 chars), screened against a conservative denylist of unambiguous violations (rejects pre-charge with `INVALID_DESCRIPTION`), then embedded inside a **fixed catalog-product-shot template** (`buildOutfitPrompt`) — raw user text is never the prompt; the template pins output to ordinary clothing, plain background, **no people**. xAI's filters are the next layer: a Grok moderation block throws `ContentModeratedError` → `recordModerationStrike` → same 3-warning refund grace as try-on (`MODERATION_GRACE_WARNINGS`), then ToS §5.4 no-refund.
- **Economics:** each generation charges **1 credit** (conditional decrement in a transaction, `CreditTransaction` tagged `(closet=<itemId>)`); any failure after the charge refunds (refund failures are Sentry-paged, `area: closet-generate-refund`). Generations are NOT covered by the subscription weekly try-on allowance. Endpoint is synchronous (~10–30s; 90s Grok timeout, client uses a 90s per-request timeout) — acceptable at the 3/min/IP rate limit; queue it like try-on if usage grows.
- **Try-on from the closet:** `POST /api/tryon` accepts a `closetItemId` multipart field **instead of** a photo. The closet image is **server-side copied** (`copyWithinS3`) into `clothing-photos/` so the job owns its key — deleting a closet item can never dangle a job's image reference, and all existing S3-cleanup paths work unchanged. The generated image is already 1024px JPEG (generation runs through `resizeImageForTryOn`).
- **"Clean Up a Photo" (1.2.0):** `POST /api/closet/cleanup` (multipart `photo`) takes a *messy* clothing photo — a website screenshot full of text/prices/UI, a person wearing the item, a cluttered scene — and runs a single fixed-prompt Grok image-edit (`cleanupClothingImage` in [grokService.ts](backend/src/services/grokService.ts), `CLEANUP_PROMPT` strips background/people/text/logos → clean catalog product shot), saved as a closet item. Same money-safety as generate (1 credit, conditional charge, refund on failure w/ Sentry `area: closet-cleanup-refund`, moderation strike/grace), same 3/min rate limit. This is the mitigation for the recurring "user uploads a screen-cap and the try-on looks wrong" problem (see also the screenshot tip in `UploadTipsSheet`). Mobile: a "Clean Up a Photo" button in `ClosetScreen` (library pick → product shot).
- **Guests are blocked** (`blockGuests` on all closet routes; the app gates the entry points with `requireRealUser`) — keeps the free-text generation surface behind signup.
- **Mobile:** `ClosetScreen` (designer text box + saved-outfits grid; opened from the TryOn screen's closet link, or with `{ picker: true }` from the add-clothing sheet). Selection handoff to TryOnScreen goes through `store/useClosetStore` (consume-once, unit-tested). Closet images carry the `AiGeneratedBadge` (Guideline 4.0).

### AI Video (image-to-video) — 1.3.0
Users animate a source image into a short clip via a motion prompt. Videos **reuse the `TryOnJob` table** (`kind=VIDEO`) so every existing surface (feed, profile, looks, comments, likes, share, moderation, S3 cleanup, presign) works unchanged.

- **Schema:** `TryOnJob.kind` (`IMAGE`|`VIDEO`, enum `TryOnKind`), `videoUrl` (mp4 S3 key), `motionPrompt` (VARCHAR 300); `clothingPhoto1Url` made **nullable** (videos have no clothing). For a video row: `bodyPhotoUrl` = the primary source image (also the **poster/thumbnail**), `videoUrl` = the result mp4, and `clothingPhoto1Url` = the **optional second/transition image** (otherwise null). Migration `add_video_jobs`. New S3 prefix **`tryon-videos/`** (avoids the legacy `videos/` prefix; sources + the mp4 live here so the job owns its keys — included in bulk-delete cleanup).
- **AI service:** xAI Grok Imagine video. `grokService.generateVideo(imageRef, motionPrompt, { referenceImageRefs? })` submits `POST /v1/videos/generations` (model `grok-imagine-video`; images inlined as data URIs like the try-on path) → `{ request_id }`, then **polls** `GET /v1/videos/{request_id}` until `status:"done"` → `video.url` (≤6 min). **Two modes, MUTUALLY EXCLUSIVE** (sending both `image` and `reference_images` is a 400 `invalid-argument`): with **no** second image → **image-to-video** (single `image`); with a second image (the "transition") → **reference-to-video** — ALL images go in `reference_images` (no `image`) and the prompt describes the transition/blend. xAI has **no** literal first→last-frame interpolation; R2V uses the images as a visual guide, prompt-driven. **Moderation detection is structural** (`respect_moderation === false` with no usable video), decided by the pure, unit-tested `classifyVideoPoll` ([utils/videoPoll.ts](backend/src/utils/videoPoll.ts)) — NEVER a substring match on the body (`respect_moderation` is a normal success field; an early substring bug discarded every good video).
- **Queue/worker:** separate `video` BullMQ queue + [queue/videoWorker.ts](backend/src/queue/videoWorker.ts) (mirrors tryonWorker: PROCESSING → generate+poll → download mp4 → `uploadToS3('tryon-videos', …)` → COMPLETE; `failed` handler → FAILED + refund (USAGE tagged `video=<jobId>`, refunds the actual charged amount) + moderation strike/grace + admin email). Registered in `index.ts`.
- **Endpoints:** [routes/video.ts](backend/src/routes/video.ts) — `POST /api/video` (requireAuth + **blockGuests**; `uploadVideoSources` multer `.fields` for `photo` + optional `photo2`). Each of the **primary** and the **optional second/transition** source is one of: `photo`/`photo2` (camera roll), `sourceJobId`/`sourceJobId2` (a completed try-on), or `bodyPhoto`/`bodyPhoto2`=`full`|`medium` (profile body photo) — resolved by a shared `resolveVideoSource` helper into `tryon-videos/` keys. Fields `motionPrompt`, `title`, `isPrivate`. `GET /api/video` = caller's completed videos. Status via the existing `GET /api/tryon/:jobId`. Same **AI-consent gate** + storage cap as try-on. Rate-limited 3/min.
- **Economics:** `videoCreditCost` (admin setting, default **2**, min 1; no weekly allowance — videos always cost credits). Also echoed in the public `GET /api/config` so `VideoScreen`'s "Create Video · N credits" button shows the live value. Charged in a `FOR UPDATE`-locked conditional-decrement transaction; refunded on terminal failure.
- **Throttle (parity with try-on):** `submitVideo` runs the same **soft per-user throttle** as try-on (`computeQueueDelayMs`) — bursts beyond the tier free quota get a short BullMQ delay + a `scheduledStartAt` countdown, and the per-IP cap is 3/min. Images + videos share one rolling-window budget, and a credit purchase resets it (`User.throttleResetAt`). See Soft per-user throttle under Key Business Rules.
- **Frontend:** `VideoScreen` — **two side-by-side source picker boxes** (the 2nd optional → transition), a motion/transition prompt (label + placeholder adapt when a 2nd image is set), chips, caption, privacy, AiConsentModal, poll → `expo-video` `VideoView` result. **`expo-video` is a native module** → a JS reload won't load it; a dev-client/EAS rebuild is required. Public videos render in the Home feed + profile grid as the poster with a ▶ overlay (`components/VideoPlayerModal` plays them full-screen). The ✨AI badge uses `placement="center"` over video so it clears the native player controls. Share page `/t/:id` renders an inline `<video>` + OG video meta (stable `/api/share/:id/video` byte-proxy). "Animate a Photo (Video)" is in the 3-dot menu (`HeaderMenu` + `ProfileScreen` mirror).

### Splash / Announcement Screen (backend-controlled)
An optional full-screen announcement (promotions, app logo, service-degradation notices) shown by the mobile app on launch. Entirely controlled by a single image file on the backend — **no app rebuild and no backend redeploy to publish, replace, or remove it.**

- **Backing store:** a SINGLETON image object in **S3** under the `splash/` prefix (e.g. `splash/announcement.jpg|png|webp`). Object present = splash active; absent = the app launches normally. Implemented in [backend/src/services/splashService.ts](backend/src/services/splashService.ts) (S3-backed since 2026-06-17, replacing the old local `SPLASH_DIR` file so it's consistent across multiple app instances behind the load balancer — see DEPLOYMENT.md §17). The `splash/` prefix is intentionally OUTSIDE the orphan-scan prefixes, so the reconciliation scan never flags it.
- **Identity:** each published file gets a stable `id` derived from its extension/size/mtime. Replacing the image changes the id, which is what makes a *new* splash show again to users who dismissed the previous one.
- **Public endpoints** (unauthenticated — shown to guests too, image loaded by a plain `<Image>` with no auth header): `GET /api/splash` → `{ active, id, imageUrl, publishedAt }`; `GET /api/splash/image` → the bytes (ETag = id, 5-min cache).
- **Publishing:** Admin Dashboard → ⚙️ Settings → "Splash / Announcement Screen" (upload/preview/remove, via `GET|POST|DELETE /api/admin/splash`). JPEG/PNG/WebP, max 10 MB; portrait ~1080×1920 fills a phone screen best. (The old "drop a file in `backend/splash/`" method is gone now that the splash lives in S3 — use the admin upload.)
- **Client behavior** ([SplashAnnouncementModal](frontend/src/components/SplashAnnouncementModal.tsx) + [utils/splash.ts](frontend/src/utils/splash.ts)): first launch after a splash is published → user must tap OK; second launch onward → a "Don't show this again" checkbox appears; dismissal is per-splash-id and can be flipped back in Settings → Announcements. Seen/dismiss state is stored in SecureStore. Any fetch/image error skips the splash silently — it never blocks startup.

### Engagement & Growth Features (1.2.0 — "enjoyment" batch)
A batch of features added 2026-06-13 to deepen engagement and growth. App-side pieces ride the **1.2.0** build; the web/backend pieces work for everyone immediately.

- **Share a try-on (web/backend, no app-review dependency).** Public shareable pages with rich link previews. [routes/share.ts](backend/src/routes/share.ts): `GET /api/share/:jobId` (JSON), `GET /api/share/:jobId/image` (stable byte-proxy via `s3Service.getS3ObjectBytes` so `og:image` survives presigned-URL expiry), and the server-rendered `GET /t/:jobId` page (OpenGraph/Twitter meta + "Get the app" CTA). Only **COMPLETE && !isPrivate** jobs are shareable (same rule as the feed); private/missing → 404 (no existence leak). App: `utils/share.ts` (`shareTryOn`) + a share button on the HomeScreen feed card and in Saved Looks. **nginx:** a `location /t/ { proxy_pass backend }` block is in BOTH `nginx.dev.conf` (live on dev) and `nginx.conf` (on-disk; **takes effect on prod only after the nginx container is force-recreated** at the 1.2.0 cutover — without it the static-website catch-all serves `/t/<id>` as index.html with no OG meta). Serving share pages on the apex (`tryon-mirror.ai/t/<id>`) instead of the API host is a future enhancement.
- **Outfit Designer "Surprise me" + style/occasion chips** (app, [constants/outfitIdeas.ts](frontend/src/constants/outfitIdeas.ts) + ClosetScreen). Pure UX scaffolding over the free-text box; everything still flows through the server-side validate + fixed catalog-product-shot template, so **no widening of the moderation surface**.
- **Compare Looks** (app, [CompareScreen](frontend/src/screens/CompareScreen.tsx)). Pick two completed try-ons → split-screen view. Reuses `/tryon/history`; no backend change. Reached from the Profile menu.
- **Referral program ("give N, get N")** — admin-tunable growth loop. Schema: `User.referralCode` (unique, lazily generated) + `Referral` model (one row per referred user; `referredUserId` unique; `rewardedAt`/`creditsAwarded` for an idempotent, transactional, claim-before-pay reward). [services/referralService.ts](backend/src/services/referralService.ts) + [utils/referralCode.ts](backend/src/utils/referralCode.ts) (unit-tested). Reward (BOTH sides) fires at the referred user's **email verification** when `referralCreditGrant > 0` (admin setting, default 5, 0 disables). Capture: optional `referralCode` on signup/claim. Endpoint `GET /api/referral/me` (code, share link, stats). App: [ReferralScreen](frontend/src/screens/ReferralScreen.tsx) + Settings "Invite Friends" + optional signup code field. **Anti-farming per-referrer cap:** `processReferralReward` counts the referrer's already-rewarded referrals in a rolling `REFERRAL_REWARD_WINDOW_DAYS` (30) window; past `referralMaxPerWindow` (admin setting, default 20, 0=unlimited) the **referrer's** payout is withheld (the row is still marked rewarded with `creditsAwarded=0`) while the **invitee is still paid** their join bonus. Combined with email normalization (`User.emailNormalized`) at signup/claim — which stops one inbox from registering many aliased accounts — and an hourly referral-velocity alert in [guestAbuseMonitorWorker](backend/src/queue/guestAbuseMonitorWorker.ts) (emails `ADMIN_EMAILS` via `sendReferralAbuseAlert` when rewarded-referral volume spikes globally or per-referrer; debounced via `referralAbuseLastAlertAt`).
- **Saved Looks** — bookmark try-on results. Schema: `SavedLook { userId, jobId }` (`@@unique`, idempotent). [routes/looks.ts](backend/src/routes/looks.ts): `GET /api/looks`, `POST/DELETE /api/looks/:jobId`. **Visibility is re-checked at READ time** (commit 8b894b2): `GET /api/looks` returns only COMPLETE jobs the viewer may still see (own, OR public & not blocked), and **nulls non-owner input photos** (body/clothing) — the feed only ever surfaces *results*, so a saved look must not leak the original's inputs even after the owner makes it private or blocks the viewer. POST also block-aware. App: [SavedLooksScreen](frontend/src/screens/SavedLooksScreen.tsx) + Profile/feed dropdown menus. **Saved-state UI:** the bookmark turns **yellow** (`Colors.gold`) when saved — on the feed card (toggle, optimistic; feed + `/tryon/history` return a `saved` flag), in Saved Looks, and as a **"Save Look"** button next to "Save All" in the profile detail modal (`TryOnDetailModal`).
- **Own-post feed menu (1.2.0):** the 3-dot menu on the user's *own* feed card now offers **Make Private** (removes it from the public feed), **Share**, and **Delete** (was previously a dead "Cancel"-only sheet); other users' cards keep Report/Block (Guideline 1.2).
- **Try-on captions (`TryOnJob.title`).** Users can name/caption a try-on. Captured at submit (an optional text field on `TryOnScreen`, ≤140 chars) and editable later via `PATCH /api/tryon/:jobId/title`. Server-side `sanitizeTryOnTitle()` ([tryonController.ts](backend/src/controllers/tryonController.ts), exported + unit-testable: must be a string, strips control chars via `\p{Cc}`, trims, caps at `TRYON_TITLE_MAX_LENGTH`=140, empty→null). The caption renders under the result image on the `HomeScreen` feed card, on the web "My Try-Ons" cards, and — when present — leads the OG/Twitter title + `<h1>` on the public `/t/:jobId` share page (HTML-escaped). Plain text only; never interpolated as raw HTML.
- **Public client config.** `GET /api/config` (unauthenticated, `Cache-Control: no-store` so admin changes show on the next launch) → `{ signupCreditGrant, signupCreditsOffer, videoCreditCost }`; `store/useConfigStore.ts` fetches it on launch to drive the dynamic join-offer copy (see Free credit policy) **and the per-video cost shown on the VideoScreen "Create Video · N credits" button** (admin-tunable via `/api/admin/settings/video-cost`; the server stays authoritative at submit time).
- **Data export (GDPR) schemaVersion 2:** `profileController` data export now includes the user's `savedLooks` and `referrals` alongside the existing data (8b894b2).

### Subscription & Credits
- **Tiered subscription model**: Each user has a `tier` of `FREE`, `BASIC`, or `PREMIUM` (see `UserTier` enum). There is **no** `isSubscribed` flag — check `tier !== 'FREE'` to gate subscriber-only features.
- **Tier configuration** lives in `backend/src/services/tierService.ts` (`TIER_CONFIG`). Current values:
  - `FREE`: 0 included try-ons, $0.60/credit
  - `BASIC`: 12 try-ons per rolling 7-day window, $0.50/credit
  - `PREMIUM`: 24 try-ons per rolling 7-day window, $0.25/credit
- The weekly window is **rolling**, not a calendar week — `tryonController` and the `/balance` endpoint count non-failed jobs whose `createdAt` is within the last 7 days. This avoids midnight-Sunday reset exploits.
- When a tiered user exhausts their weekly included try-ons, additional try-ons spend credits.
- Credit balance is displayed in the top-left corner of the app and tapping it opens `PurchaseScreen`.
- Credit transactions are tracked in the `CreditTransaction` model (`PURCHASE`, `GRANT`, `USAGE`, `REFUND`).
- Lifetime try-on count per user is tracked in `User.tryOnCount` (incremented on successful job completion).

#### Free credit policy (welcome bonus — admin-configurable "join offer")
- Each user receives the **welcome-bonus credit grant ONCE** at email verification (default **10**). There is no recurring grant.
- **The amount is admin-configurable at runtime**, exactly like the guest grant: stored in `AppSettings.signupCreditGrant`, read via `getSignupCreditGrant()` ([appSettingsService.ts](backend/src/services/appSettingsService.ts), default `DEFAULT_SIGNUP_CREDIT_GRANT=10`, bounded 0–1000), edited in Admin Dashboard → **⚙️ Settings → "Welcome Bonus Credits (join offer)"** (`GET /api/admin/settings` + `PATCH /api/admin/settings/signup-credits`). This lets the "free credits when you join" promotion be raised for a limited-time campaign, lowered, or **set to 0 to discontinue** — with no redeploy and no app rebuild.
- Implemented in `authController.verifyEmail` — reads the live grant once, then (only when > 0) atomically increments `User.credits` and writes a `CreditTransaction` of type `GRANT` with description "Welcome bonus — email verified". At **0** the email still verifies but no credit/transaction is granted.
- **Public offer endpoint:** `GET /api/config` (unauthenticated, like `/api/splash`) returns `{ signupCreditGrant, signupCreditsOffer }`. The app fetches it on launch (`store/useConfigStore.ts`) and renders the offer copy dynamically — "Limited time offer: N free credits when you join" on the signup/guest-prompt surfaces (`GuestPromptScreen`, `GuestProfileScreen`, `HomeScreen` guest banner, `PurchaseScreen`, `AboutScreen`) — and **hides the offer entirely when 0**. Defaults to the standing offer (10) until the fetch resolves so first render is honest.
- ⚠️ **Shipped-build caveat:** the dynamic copy only takes effect in builds that carry `useConfigStore` (1.2.0+). Builds ≤1.1.0 (incl. the 1.1.0 TestFlight build) have the old hardcoded "10 Free Credits" copy. So **do not set the grant to a value other than 10 while a ≤1.1.0 build is the live App Store version** — the live app would advertise 10 but grant a different number (false advertising / Apple metadata-accuracy risk). Safe sequence: ship 1.2.0, let it propagate, *then* run promotions / discontinue.
- `User.lastFreeCreditGrantAt` is set at verification time. The field is retained for audit but no longer drives any logic.
- Once a user exhausts their credits, they must purchase more or subscribe.

#### Legacy (dev-only) endpoints
The following endpoints exist but are gated to **dev only** and return **HTTP 410 Gone** in production with a message pointing users to the StoreKit flow:
- `POST /api/credits/subscribe` — direct tier mutation (use `/verify-receipt` instead)
- `POST /api/credits/purchase` — direct credit grant (use `/verify-receipt` instead)
- `POST /api/credits/unsubscribe` — direct downgrade to FREE (users cancel via iOS Settings; webhook fires EXPIRED)

Production uses **only** the `/api/credits/verify-receipt` path plus App Store Server Notifications. Granting entitlement via these legacy endpoints in production violates App Store Review Guideline 3.1.1.

### Soft per-user throttle (queue pacing in seconds)

A *soft* layer sitting above the existing per-IP rate limit (`tryonPostLimiter`: 5 POST/min; video: 3/min) and the weekly/credit gates. Where those refuse the request with a 429, this layer accepts it but defers execution by setting a BullMQ `delay`. Implemented in `backend/src/services/throttleService.ts`. It is deliberately **light**: total volume is already capped by credits / the weekly allowance, so this only *smooths bursts* (a "department-store shopper" trying on many outfits should sail through her whole burst) and backstops a runaway client. **Applies to BOTH try-on (IMAGE) and AI Video** submissions — they share one rolling-window budget (both are `tryon_jobs` rows; the count isn't kind-filtered), so a user's combined image+video generations pace together.

**Algorithm:** rolling window (default 15 min), per-user, counts non-`FAILED` jobs. The user's free burst is tier-scaled; beyond it, each subsequent submission steps down a short delay ladder. **The config is admin-tunable at runtime** (see below), so the table reflects the current default:

| Submission # in window | FREE | BASIC | PREMIUM |
|---|---|---|---|
| ≤ burst (6 / 8 / 10) | 0 | 0 | 0 |
| burst + 1 | 10s | 10s | 10s |
| burst + 2 | 20s | 20s | 20s |
| burst + 3 | 30s | 30s | 30s |
| burst + 4 and beyond | 40s (cap) | 40s | 40s |

**Admin-tunable config (no redeploy).** The window, per-tier burst, and delay ladder are stored as a single JSON blob in `AppSettings` under `throttleConfig`, read via `getThrottleConfig()` / written via `setThrottleConfig()` (validates + clamps, throws → 400). Edited in Admin Dashboard → **⚙️ Settings → "Try-On Throttle (Soft Queue)"** (`GET /api/admin/settings` + `PATCH /api/admin/settings/throttle`). A missing/corrupt row transparently falls back to `DEFAULT_THROTTLE_CONFIG`, so a bad value can never brick submission. **Hard ceiling: no single ladder rung may exceed 60s** (`MAX_LADDER_MS`) — a user must never wait more than a minute. `delayForOrdinal` is the pure, config-driven ladder math (unit-tested).

**Reset on purchase.** Buying credits or subscribing stamps `User.throttleResetAt = now` via `resetUserThrottle()`; `computeQueueDelayMs` ignores jobs before that timestamp, so a user who just paid starts with a clean burst and is **never stuck in the queue with credits they can't spend**. Wired into the verify-receipt consumable + subscription paths and the webhook `grantCreditsIfNew` (all fire-and-forget; a reset failure never breaks the purchase).

**Wire-up:** `tryonController.submitTryOn` **and `videoController.submitVideo`** both call `computeQueueDelayMs(userId, tier)` after the credit/weekly gates pass. The result is:
- Persisted on `TryOnJob.scheduledStartAt` (null when delay = 0)
- Passed as the `delay` option to `enqueueTryOn` / `enqueueVideo`
- Returned in the 202 response as `{ scheduledStartAt, queueDelayMs }`

Both `TryOnScreen` and `VideoScreen` render the one-shot "You're in the queue" alert + the live `M:SS` countdown from `scheduledStartAt`.

**Client UX:** `TryOnScreen.tsx` shows a one-shot **"You're in the queue"** Alert when `queueDelayMs > 0` (worded as a *shared queue with other members*, never as a "limit" / "too fast"; non-PREMIUM users also see "Subscribers get faster queues and shorter waits"), then the `ResultView` renders a live `M:SS` countdown that ticks every second until `scheduledStartAt` elapses, at which point it falls through to the normal "Generating…" view.

**Notes:**
- The BullMQ retry backoff is independent — `delay` only defers the initial run; retries still use the configured exponential backoff.
- Failed jobs are excluded from the count to match the weekly-limit semantics (a failed-and-refunded job didn't consume Grok cost, so it shouldn't penalize the user's pacing budget).
- App killed during countdown: the job lives in Redis/Postgres and runs anyway; the user finds it in Profile history. No data loss.

### Apple In-App Purchases
- Two ingestion paths run in parallel for redundancy. **Both are idempotent on `transactionId`**:
  1. **Fast path (client → backend):** `POST /api/credits/verify-receipt` — the mobile app posts the StoreKit JWS immediately after a purchase succeeds. Backend verifies the JWS via Apple's CA chain, checks `appAccountToken === userId`, and applies the entitlement. Used so credits / tier appear instantly in the UI. **Verification is dual-environment** (`verifyAndDecodeTransactionAnyEnv` in [appleNotificationService.ts](backend/src/services/appleNotificationService.ts)): the configured environment is tried first, and an `INVALID_ENVIRONMENT` failure retries against the opposite one — because **TestFlight testers and App Review both produce SANDBOX receipts against the production backend** (a Production-only verifier breaks App Review's IAP testing and was the Jim Morris lost-credits incident, 2026-06-11). Sandbox-verified grants are tagged `(sandbox)` in the CreditTransaction description. Verification failures log the `VerificationException` **status name** (the exception's `message` is empty — see [utils/appleVerifyStatus.ts](backend/src/utils/appleVerifyStatus.ts)) plus a PII-free shape of the posted JWS, and fire a Sentry event (`area: iap-verify-receipt`).
  2. **Authoritative path (Apple → backend):** **App Store Server Notifications V2** webhook at `POST /api/webhooks/apple`. Used for renewals, cancellations, refunds, and as a safety net if verify-receipt fails. See `backend/src/routes/appleWebhook.ts` and `backend/src/queue/appleNotificationWorker.ts`.
- StoreKit transactions are persisted in the `ApplePurchase` model (`transactionId` unique per renewal, `originalTransactionId` stable across the subscription lifetime, `productId`, `tier`, `expiresAt`, `revokedAt`).
- The product catalog (`backend/src/config/appleIap.ts`) is a discriminated union: products are either `{ type: 'subscription', tier }` or `{ type: 'credits', credits: N, tierVariant }`. Subscription notifications update `User.tier`; consumable notifications grant credits via a `CreditTransaction`.
- **Tier-priced credit packs.** Each credit-pack size has 3 SKU variants (`.free`, `.basic`, `.premium`) with different App Store Connect prices but identical credit grants. The client offers only the variant matching `user.tier`. If verify-receipt sees a tier-variant mismatch (race during a tier change, or a tampered client), it logs a warning and **still grants credits** — Apple already charged the user, so honest users aren't penalized.
- Product IDs (must match App Store Connect). Every SKU carries a `.v<N>` suffix matching the app version at which it was *last reissued* — currently `.v14`. The suffix is **not** bumped on every app release; it only changes when an IAP gets stuck in App Store Connect ("Needs Developer Attention") and must be reissued. App Store Connect treats deleted product IDs as permanently burned, so reissues update both [backend/src/config/appleIap.ts](backend/src/config/appleIap.ts) and [frontend/app.json](frontend/app.json) in lockstep with the new suffix. See those files for the authoritative mapping.
  - `com.evofaceflow.tryon.app.basic.monthly.v14` → BASIC tier subscription
  - `com.evofaceflow.tryon.app.premium.monthly.v14` → PREMIUM tier subscription
  - `com.evofaceflow.tryon.app.credits.{10,25,50,100}.{free,basic,premium}.v14` → 12 consumable credit packs (4 sizes × 3 tier variants).
- The mobile app sets `appAccountToken` (= our `User.id` as UUID) on every StoreKit purchase so notifications can be mapped back to a user. The verify-receipt endpoint requires this match. Fallback identification (webhook only) is by `originalTransactionId` against existing `ApplePurchase` rows.
- Frontend uses `expo-iap` via `frontend/src/services/iap.ts`. The service handles connection lifecycle, fetches localized prices (`displayPrice`) from the App Store at runtime — **never hardcode prices** (Guideline 3.1.1(a)).
- Restore Purchases is fully StoreKit-driven: the client calls `expo-iap`'s `getAvailablePurchases()` and re-posts each receipt to `/verify-receipt`. Both surfaces (PurchaseScreen and Settings) use this flow. There is no server-side restore endpoint — `verify-receipt` plus App Store Server Notifications are the only entitlement paths.
- iOS bundle identifier: `com.evofaceflow.tryon.app` (see `frontend/app.json`).
- **Apple root CA certificates** must be present in the backend at `backend/certs/apple/*.cer` (or wherever `APPLE_ROOT_CERTS_DIR` points). Download from https://www.apple.com/certificateauthority/ — at minimum `AppleRootCA-G3.cer`. Without these the JWS verifier cannot validate notifications. The Dockerfile `COPY certs ./certs` step bakes them into the production image.

### Content Moderation (App Store Guideline 1.2)
The app supports user-generated content (public try-on feed) and so must provide reporting, blocking, and content filtering.
- **Report:** Three-dot menu on every feed card (HomeScreen), on PublicProfileScreen, and on each comment in TryOnCommentsScreen. Opens `ReportSheet` with 6 reason options. Submits to `POST /api/reports`. Supported `targetType` values: `TRYON_JOB`, `USER`, `COMMENT`. Reports are listed in admin moderation endpoints (`GET /api/admin/moderation/reports`) and resolved with `PATCH /api/admin/moderation/reports/:id`. `removeContent: true` flips `TryOnJob.isPrivate = true` for `TRYON_JOB` targets and hard-deletes the comment (and decrements `TryOnJob.commentsCount`) for `COMMENT` targets.
- **Block:** Same three-dot menus expose Block. `POST /api/users/:userId/block` creates a `UserBlock` row; mutual filtering is applied to feed, public-profile, search, and comment-thread queries via `getInvisibleUserIds()` in `backend/src/utils/blocks.ts`. In comment threads this means a blocked user's comments and replies are hidden from the blocker in both directions, and attempting to comment on / reply to / like across a block returns `404`. Blocking also deletes any existing follow links between the two users.
- **Unblock:** Settings → Privacy & Data → Blocked Users (`BlockedUsersScreen`) lists current blocks and allows unblocking via `DELETE /api/users/:userId/block`.
- **Filtering objectionable material from posting:** combination of (a) ToS prohibition, (b) xAI Grok's built-in content filters on AI-generated images, (c) user reports, (d) admin removal. There is no automated image moderation — adding AWS Rekognition or similar would harden this further.
- **Per-user moderation-strike tracking (banned-content attempts).** When Grok blocks **every perspective** of a try-on (the `CONTENT_MODERATED` terminal path in `tryonWorker` — a partial block now completes the job with the surviving perspectives and records **no** strike), the worker calls `recordModerationStrike()` ([services/moderationService.ts](backend/src/services/moderationService.ts)), which increments `User.moderationBlockCount`, stamps `User.lastModerationBlockAt`, returns the new count, and — on every Nth strike (`MODERATION_STRIKE_ALERT_EVERY`, default 3; pure helper `shouldAlertOnStrike` in [utils/moderationStrike.ts](backend/src/utils/moderationStrike.ts), unit-tested) — emails `ADMIN_EMAILS` via `sendModerationStrikeAlert`. The returned count drives the **grace window**: strikes 1–3 (`MODERATION_GRACE_WARNINGS` in `tryonWorker.ts`) refund the credit with a "warning N of 3" message; strike 4+ applies the no-refund policy. Strike bookkeeping is self-contained (errors swallowed, null count = fall back to no-refund), so it never breaks the worker's failure path. The admin dashboard surfaces the count as a red **⚠ N** badge next to the username in the Users list and a **Moderation Blocks** field in the user-detail modal (both fed by `moderationBlockCount` / `lastModerationBlockAt` on the `/api/admin/users` + `/api/admin/user/:id` responses). Per-event detail isn't stored separately — a blocked attempt is already a `TryOnJob` row (status `FAILED` + the moderation `errorMessage`). **Caveat:** a single block can be a borderline-clothing false positive (observed live: a vegetable-print suit blocked on the medium perspective only); a *repeating* all-perspectives pattern is the strong signal — treat the badge as a flag for review, not an automatic ban.

### AI-Generated Content Disclosure (Guideline 4.0)
Every visible try-on result image carries an `AiGeneratedBadge` overlay ("✨ AI-generated"). Surfaces:
- `TryOnScreen` inline result image (the screen where the user first sees their generated try-on)
- `TryOnResultCard` (used in profile history)
- `HomeScreen` feed card result image
- `TryOnDetailModal` carousel
- `FullScreenImageModal` when caller passes `aiGenerated={true}` (HomeScreen passes false for clothing/body photo previews)

Profile-screen 3-column thumbnails are intentionally not badged — they're micro-previews that immediately open the detail modal where the badge is shown.

### Admin Access (UI gating)
- Backend admin endpoints require the `X-Admin-Key` header matching `ADMIN_API_KEY`.
- The mobile app's `AdminConsoleScreen` is gated by **two** independent layers:
  1. The Stack.Screen route is only registered when `__DEV__ || user.isAdmin`. Non-admin production users have no entry point at all.
  2. The Settings screen's "Admin Console" button is only shown when `user.isAdmin === true`.
- `user.isAdmin` is server-derived: `authController` and `profileController.getMyProfile` compute it via `isAdminEmail(email)` against the `ADMIN_EMAILS` env var (comma-separated allowlist).

#### Network-level admin allowlist (prod nginx) + lockout recovery
On **production only**, nginx IP-allowlists the admin surface as defense-in-depth on top of `X-Admin-Key`. Both `location = /admin` (the dashboard HTML) and `location /api/admin` (the admin API) carry `allow <ip>; deny all;` in [nginx/nginx.conf](nginx/nginx.conf). Any other IP gets a `403` before the request reaches the backend. `nginx.dev.conf` is intentionally left open, so the dev dashboard stays reachable from anywhere.

> **⚠️ The allowlisted IP is a residential/dynamic IP** (no static IP or VPN available). If the ISP rotates it, the admin **will get locked out** of `/admin` and `/api/admin` with a `403` — the rest of the app keeps working normally for users; only the admin surface is affected.

**Recovery when the admin IP changes (or you're locked out):**
1. Find your new public IP: `curl -s https://api.ipify.org` from the admin machine.
2. SSH into the prod box — **SSH is unaffected** (port 22, not behind nginx):
   ```bash
   ssh ubuntu@api.tryon-mirror.ai
   cd /opt/evofaceflow/TryOn
   ```
3. Update **both** `allow` lines in `nginx/nginx.conf` to the new IP (edit in place on the server, or change it in the repo, commit, merge to `main`, and `git pull`). There are two: one in `location = /admin`, one in `location /api/admin` — keep them in sync.
4. **Force-recreate** nginx so it remounts the changed file — a plain `reload`/`restart` will NOT pick it up (the config is bind-mounted as a single file, pinned to the old inode):
   ```bash
   docker compose -f docker-compose.prod.yml up -d --force-recreate nginx
   docker compose -f docker-compose.prod.yml exec nginx grep -n "allow " /etc/nginx/nginx.conf   # confirm the new IP
   ```
5. Verify from the new IP: `curl -s -o /dev/null -w "%{http_code}\n" https://api.tryon-mirror.ai/admin` → expect `200`.

> **Emergency open-up** (if you need admin access NOW and can't determine your IP): comment out the two `deny all;` lines in `nginx/nginx.conf`, force-recreate nginx as above, do what you need, then restore the allowlist. The `X-Admin-Key` is still required in this window, so the surface isn't fully exposed — but don't leave it open.

### Geo / Location Tracking
- Location is recorded on every login and token refresh.
- The last 10 records per user are retained; older records are deleted automatically.
- `distanceFromLast` is calculated server-side using the Haversine formula.
- A location is flagged `suspiciousLocation = true` if `distanceFromLast` > 500 km within 2 hours.
- Suspicious logins trigger an email alert to the user.
- Location data is disclosed in the Privacy Policy. Users may request deletion via Settings.

---

## Image Processing

All uploaded images (body photos, clothing photos) undergo a two-stage resizing process:

### Frontend Resizing (Mobile)
- **Location**: `frontend/src/utils/imageUtils.ts` → `processImageForUpload()`
- **Purpose**: Convert HEIF/HEIC to JPEG, reduce upload bandwidth
- **Dimensions**:
  - Avatar photos: 512×512 (square)
  - Body photos: Up to 1536×2048 (max dimensions)
  - Clothing photos: Up to 1536×2048 (max dimensions)
- **Format**: JPEG at 85% quality
- **Features**: HEIF/HEIC to JPEG conversion (iOS compatibility)

### Backend Resizing (Server)
- **Location**: `backend/src/utils/imageProcessor.ts`
- **Purpose**: Standardize dimensions for AI processing and storage
- **Dimensions**:
  - **Body & Clothing photos**: Longest side scaled to **1024px**, aspect ratio preserved
    - Portrait 2:3 (e.g., 2000×3000) → 683×1024
    - Portrait 3:4 (e.g., 3000×4000) → 768×1024
    - Landscape 4:3 (e.g., 4000×3000) → 1024×768
    - Square (e.g., 2000×2000) → 1024×1024
  - **Avatar photos**: 512×512 (square, center crop)
- **Format**: JPEG at 90% quality (85% for avatars)
- **Features**: Auto-rotation based on EXIF, HEIF/HEIC detection and rejection

**Why two stages?**
1. Frontend resize reduces network bandwidth (uploading ~3MP vs 12MP+ originals)
2. Backend resize ensures consistent dimensions for the Grok Imagine API, regardless of upload source

**B3 verdict (2026-06-10, empirical):** keep both stages and the 1024px backend target. A controlled A/B on dev (same body photo, clothing input at 1504px vs 1024px, two generations each) found **Grok Imagine outputs a fixed 864×1152 (~1.0 MP) canvas regardless of input resolution**, and the higher-res input produced no visible quality gain — xAI's docs publish no input-resolution spec, so this measurement is the authority. Implications: (a) raising the backend target only inflates S3 + Grok payloads; (b) the frontend stage remains a pure bandwidth win; (c) the A3 low-res warning thresholds (longest side < 1024, shortest < 500 in [imageUtils.ts](frontend/src/utils/imageUtils.ts)) are correctly calibrated — below them the pipeline is effectively upscaling into Grok's output canvas. Incoming-upload dimensions are now logged structured (`Upload image processed` in [imageProcessor.ts](backend/src/utils/imageProcessor.ts)) so real-world stats accrue for future re-evaluation. (Micro-note: 3:4 inputs at 1024 arrive at Grok 768 wide vs its 864-wide output — a 1152px target would match exactly, but the A/B showed no visible benefit, so not worth the churn.)

---

## Infrastructure

- **Database**: PostgreSQL 15 (Prisma ORM)
- **Queue**: Redis 7 + BullMQ
- **Storage**: AWS S3 (`evofaceflow-uploads`) — separate prefixes: `body-photos/`, `clothing-photos/`, `tryon-results/`, `closet/` (Outfit Designer creations), `tryon-videos/` (AI Video source images + .mp4 results). Bucket has Block Public Access enabled and **no** bucket policy granting `s3:GetObject` to `Principal: "*"`. All reads go through the backend. **Bucket versioning is enabled** with a lifecycle rule expiring noncurrent object versions after 30 days — provides a rolling 30-day undo window for accidental deletes / overwrites of user photos.
- **Reverse proxy**: Nginx (production) with SSL via Let's Encrypt
- **Hosting**: AWS Lightsail Ubuntu 22.04
- **Email**: AWS SES (transactional) — verification emails, suspicious login alerts
- **Geo-IP**: ip-api.com or MaxMind GeoLite2 (server-side, never exposed to client)
- **Intrusion Prevention**: Fail2ban for automated IP banning

## Backups & External Monitoring

Production data is protected at three independent layers. Details and restore procedures live in [DEPLOYMENT.md §10–12](DEPLOYMENT.md).

| Layer | What it covers | Restore via |
|---|---|---|
| Lightsail automatic snapshots (daily) | Whole-VM rollback | Lightsail console → create new instance from snapshot |
| S3 versioning + lifecycle on `evofaceflow-uploads` | Per-photo undo, 30-day window | S3 console "Show versions" |
| Nightly `pg_dump` → `s3://evofaceflow-backups/postgres/` | Database restore, 365-day retention (Glacier IR after 30 days) | `aws s3 cp` + `psql` — DEPLOYMENT.md §10.4 |

**Nightly Postgres dump details:**
- Script `/usr/local/bin/backup-postgres.sh` (on the Lightsail host, not in the repo) streams `pg_dump | gzip | aws s3 cp` so no unencrypted dump ever touches disk
- Config + AWS keys in `/etc/tryon-backup.env` (`chmod 600 root:root`, vars `export`ed)
- Runs daily at 02:00 UTC via root crontab; logs to `/var/log/tryon-backup.log` (logrotate, 8-week retention)
- Uploads use the IAM user `tryon-backup-uploader` with a write-only scoped policy — it cannot read, list, or delete completed backups, so a host compromise cannot exfiltrate or destroy historical dumps
- Bucket `evofaceflow-backups` has versioning enabled and a lifecycle policy: Glacier Instant Retrieval after 30 days, expire after 365 days

**External monitoring:**
- UptimeRobot free tier monitors `https://api.tryon-mirror.ai/health` every 5 minutes from outside AWS. Alerts go to email after 2 consecutive failures (~10 minutes of downtime). This catches outages the application itself cannot report (network partition, VM down, nginx misconfig, DNS failure).
- The `/health` endpoint runs a **deep** check: it probes Postgres (`SELECT 1`) and Redis (`PING`) in parallel (2s timeout each) and returns `200 {status:"ok"}` only when both are up, or `503 {status:"degraded"}` with per-dependency status otherwise. A separate shallow, dependency-free `/health/live` backs the Docker liveness probe, so a transient dependency blip can't make Docker kill an otherwise-healthy backend. UptimeRobot watches `/health`, so it catches dependency outages, not just a dead Express process.
- **SSL certificate expiry alerting is currently passive** — UptimeRobot's SSL monitoring is now paid, so expiry surfaces only when (a) certbot's renewal-failure email fires or (b) the cert actually expires and UptimeRobot's HTTPS check fails. A preemptive check via the existing vulnerability scanner is planned (the `SSL_CERTIFICATE` enum value in `VulnerabilityReport.scanType` is reserved for this).

---

## Admin Dashboard

Access at `https://api.tryon-mirror.ai/admin` (requires `ADMIN_API_KEY`).

Features:
- **Dashboard**: User count, try-on jobs, subscribers, credits outstanding, plus guest-mode metrics — **Guests Today** (guest sign-ups since 00:00 UTC), **Active Guests** (unconverted `isGuest=true` rows), **Guest→User (7d)** conversion rate (share of the last 7 days' guest sign-ups now converted to real accounts), and a **7-day guest-sign-up mini-trend** (per-UTC-day bar chart). All derived in `GET /api/admin/stats` from `UserLocation` rows with `trigger='guest_create'` (the per-day series is returned as `guestSignups7dByDay`).
- **🩺 Diagnostics** (`GET /api/admin/diagnostics`): a single triage pane for "what's wrong right now" — Postgres/Redis up-state + latency, process & host memory/uptime, BullMQ queue depth + recent worker-failure tables, an **integrations grid** (green/red for Grok, S3, Apple Server API, email/SES, CloudWatch, Sentry — instantly answers "why is feature X dead on this box?"), **config flags** (NODE_ENV, APP_URL, APPLE_ENVIRONMENT, refresh-token rotation, log level) for spotting dev/prod env drift, **24h try-on throughput** with a highlighted **stuck-in-PROCESSING >30m** counter (the clearest "worker/Grok stalled" signal), **7-day credit economy** (PURCHASE/GRANT/USAGE/REFUND sums + outstanding), and a **Sentry** card with config status, a **Send test event** button, and an inline recent-issues feed (when the Sentry REST-API vars are set).
- **Users**: List all users, create test users, verify accounts, toggle subscriptions, adjust credits, and view per-user AI Processing Consent status (Granted with timestamp, or Not granted). User detail modal also shows the consent timestamp, plus a **Try-On Sessions gallery** — every session as a card with all of its photos side by side (body-photo input, clothing photo(s), full-body result, medium result; missing slots shown as placeholders), paginated 5 at a time via `GET /api/admin/user/:userId/jobs`, thumbnails click through to full size.
- **⚙️ Settings**: runtime-tunable values that take effect without a redeploy. Currently the **Guest Welcome Credits** grant — the number of free credits a brand-new guest account gets the first time the app is opened on a device. Backed by `GET /api/admin/settings` + `PATCH /api/admin/settings/guest-credits`, persisted in `AppSettings.guestCreditGrant`, read by `createGuest` via `getGuestCreditGrant()`. Only affects newly created guests, not existing ones. Also hosts the welcome-bonus / referral / video-cost settings, the **Try-On Throttle (Soft Queue)** editor (window + per-tier burst + delay ladder; `PATCH /api/admin/settings/throttle` — see Soft per-user throttle), and the **Splash / Announcement Screen** manager — current status with inline preview, upload (publish/replace), and remove (see Splash / Announcement Screen under Key Business Rules).
- **Subscription status column** (per user): derived from the latest non-revoked subscription `ApplePurchase` row. States are `Active · renews <date>`, `Pending cancel · ends <date>` (user toggled auto-renew off — entitlement still valid until that date), `Billing retry` (Apple is retrying a failed payment — likely to churn), `Grace period · ends <date>` (payment failed but entitlement preserved temporarily), `Expired`, `Revoked`, or `—` (no subscription on file). The user-detail modal additionally shows the productId, exact expiry timestamp, auto-renew flag, last-synced-from-Apple timestamp, and a **Refresh from Apple** button that pulls live state via `POST /api/admin/user/:userId/refresh-subscription` (see [App Store Server API integration](#app-store-server-api-integration) below). Webhook-only fields (`autoRenewStatus`) populate on the next renewal/status webhook; `appleStatus` only populates after an admin refresh.

### App Store Server API Integration

We use Apple's [App Store Server API](https://developer.apple.com/documentation/appstoreserverapi) as a reconciliation layer alongside the primary webhook ingestion path. Webhooks are still the authoritative push channel for state changes; the Server API is pulled on-demand to:
- Resolve `Unknown` states for rows written before `autoRenewStatus` was added
- Detect webhook drift (notifications missed during backend downtime)
- Surface `BILLING_RETRY` and `GRACE_PERIOD` states that webhooks don't carry directly
- Provide an authoritative "is this user still subscribed?" answer when an admin needs one

**Endpoint:** `POST /api/admin/user/:userId/refresh-subscription` — admin-only. Calls Apple's `getAllSubscriptionStatuses(originalTransactionId)`, walks the response to find the matching transaction, decodes the signed JWS payloads (same verifier as webhooks), and writes `appleStatus`, `autoRenewStatus`, `expiresAt`, and `lastSyncedFromAppleAt` back to the `ApplePurchase` row. Returns the refreshed `subscriptionStatus` for in-place dashboard re-render.

**Implementation:** [backend/src/services/appleServerApiService.ts](backend/src/services/appleServerApiService.ts) wraps `AppStoreServerAPIClient` from `@apple/app-store-server-library`. The client is a lazy singleton — if env vars are missing, `getClient()` throws `AppleServerApiNotConfiguredError` which the route translates to HTTP 503 so the missing-config case is distinguishable from a real Apple API failure.

**Required env vars** (all three or none — partial configuration throws on first use):
- `APPLE_API_KEY_ID` — 10-character key identifier
- `APPLE_API_KEY_ISSUER_ID` — UUID from App Store Connect → Users and Access → Integrations
- `APPLE_API_KEY_PATH` — absolute or relative path to the downloaded `.p8` key file (gitignored alongside the root CAs in `backend/certs/`)

Generate the key in App Store Connect → Users and Access → Integrations → **In-App Purchase** tab (NOT the regular App Store Connect API key — that's a different role). The .p8 can only be downloaded once at creation time; treat it like a secret.
- **Try-On Jobs**: View recent jobs with status, perspectives used, result links
- **Security**: Suspicious login stats, flagged locations, user location history

Admin API endpoints (all require `X-Admin-Key` header):
- `GET /api/admin/stats` — dashboard statistics
- `GET /api/admin/settings` — read admin-tunable runtime settings (the guest welcome-credit grant AND the signup welcome-bonus grant, each with its default + max for the UI)
- `PATCH /api/admin/settings/guest-credits` — set the guest welcome-credit grant (body: `{ value }`; non-negative integer ≤ 1000). Powers the **⚙️ Settings** dashboard tab and takes effect immediately for newly created guests.
- `PATCH /api/admin/settings/signup-credits` — set the signup welcome-bonus ("free credits when you join") grant (body: `{ value }`; non-negative integer ≤ 1000; **0 discontinues the offer**). Takes effect immediately for newly verified accounts. See Free credit policy.
- `PATCH /api/admin/settings/referral-credits` — set the referral reward granted to BOTH sides per successful referral (body: `{ value }`; non-negative integer ≤ 1000; **0 disables the reward**). See Engagement & Growth Features.
- `PATCH /api/admin/settings/referral-max` — set the anti-farming per-referrer cap (body: `{ value }`; non-negative integer; **0 = unlimited**). Max REWARDED referrals one referrer earns per rolling 30-day window; over it the referrer's payout is withheld (the invitee is still paid). See Engagement & Growth Features.
- `PATCH /api/admin/settings/video-cost` — set the per-video credit cost (body: `{ value }`; integer **≥ 1**). See AI Video below.
- `PATCH /api/admin/settings/throttle` — set the soft try-on queue config (body: the full `{ windowMs, burst: { FREE, BASIC, PREMIUM }, ladderMs: number[] }` object; validated + clamped, any rung capped at 60s). See Soft per-user throttle.
- `GET /api/admin/users` — list users
- `POST /api/admin/users` — create test user
- `GET /api/admin/user/:id` — user details with location history
- `DELETE /api/admin/user/:id` — delete user
- `PATCH /api/admin/user/:id/verify` — toggle verification
- `PATCH /api/admin/user/:id/subscription` — toggle subscription
- `PATCH /api/admin/user/:id/credits` — adjust credits
- `DELETE /api/admin/user/:userId/clear-locations` — wipe a user's stored `UserLocation` history (and its suspicious-location flags); surfaced as a "Clear History" button in the user-detail modal's Login Locations section
- `POST /api/admin/user/:userId/refresh-subscription` — pull live subscription state from Apple's App Store Server API (see [App Store Server API integration](#app-store-server-api-integration))
- `DELETE /api/admin/user/:userId/apple-purchase/:purchaseId` — delete one `ApplePurchase` row; resets tier to FREE if no subscription-tier purchases remain
- `DELETE /api/admin/user/:userId/apple-purchases` — delete ALL `ApplePurchase` rows for a user and reset tier to FREE (clears stale sandbox/TestFlight test transactions, which accumulate one row per renewal)
- `GET /api/admin/jobs` — list try-on jobs
- `GET /api/admin/user/:userId/jobs` — one user's try-on sessions (presigned, paginated `?limit&skip`); powers the user-detail modal's Try-On Sessions gallery
- `DELETE /api/admin/job/:jobId` — delete a single job **and its clothing/result images in S3** (never `bodyPhotoUrl` — that's the user's profile body photo, shared across jobs)
- `POST /api/admin/jobs/delete` — bulk delete jobs (same S3 cleanup as the single delete; before 2026-06-11 both endpoints left the S3 objects behind, which is where most storage orphans came from)
- `GET /api/admin/splash` / `POST /api/admin/splash` (multipart `photo`) / `DELETE /api/admin/splash` — inspect, publish/replace, and remove the launch splash/announcement image (see Splash / Announcement Screen under Key Business Rules)
- `GET /api/admin/s3/orphan-scan` — full key-level DB↔S3 reconciliation over the TryOn prefixes: any object not referenced by a User or TryOnJob row is orphaned (catches deleted users AND deleted jobs/replaced photos of live users; ignores objects <1h old to dodge in-flight uploads). Read-only.
- `DELETE /api/admin/s3/orphan-cleanup` — delete everything the orphan scan found (re-scans first)
- `GET /api/admin/security/stats` — suspicious login statistics
- `GET /api/admin/security/suspicious` — list suspicious logins
- `GET /api/admin/moderation/reports` — list user-submitted reports (filter by `?status=OPEN|REVIEWING|RESOLVED_REMOVED|RESOLVED_NO_ACTION`)
- `PATCH /api/admin/moderation/reports/:id` — resolve a report (body: `{ status, resolverNote, removeContent }`. `removeContent: true` flips `TryOnJob.isPrivate = true`.)
- `GET /api/admin/diagnostics` — one-call operational snapshot powering the **🩺 Diagnostics** tab: process/system health, Postgres + Redis latency, BullMQ queue depth + recent worker failures, which integrations are configured on this box, 24h try-on throughput (incl. **jobs stuck in PROCESSING >30m**), 7-day credit economy, and Sentry status. Every section is error-isolated so the endpoint stays useful even when a dependency is down. (See [services/diagnosticsService.ts](backend/src/services/diagnosticsService.ts).)
- `GET /api/admin/sentry/status` — Sentry config snapshot (no secrets)
- `GET /api/admin/sentry/issues` — most recent unresolved Sentry issues; **503** when the REST-API env vars aren't set, **502** on a Sentry API error
- `POST /api/admin/sentry/test` — fire a synthetic event to verify Sentry delivery end-to-end; **503** when `SENTRY_DSN` is unset

---

## Vulnerability Monitoring

The system includes automated vulnerability scanning to ensure security and identify required patches.

### Features
- **Scheduled Scans**: Automatically runs daily at 2:00 AM
- **NPM Dependencies**: Scans both backend and frontend npm packages using `npm audit`
- **System Packages**: Checks for Ubuntu/Debian package updates (apt-based systems)
- **Admin Dashboard**: Displays vulnerability counts by severity (Critical, High, Moderate, Low)
- **Manual Triggers**: Admins can trigger immediate scans from the dashboard

### Admin API Endpoints
All vulnerability endpoints require `X-Admin-Key` header:

- `GET /api/admin/vulnerabilities/summary` — get latest vulnerability summary
- `GET /api/admin/vulnerabilities/reports` — paginated scan history (query: `scanType`, `limit`, `skip`)
- `GET /api/admin/vulnerabilities/report/:id` — detailed report with full JSON output
- `POST /api/admin/vulnerabilities/scan` — trigger async vulnerability scan (returns immediately)
- `POST /api/admin/vulnerabilities/scan/immediate` — run synchronous scan (waits for completion)
- `DELETE /api/admin/vulnerabilities/cleanup?days=30` — delete reports older than X days

### Database Schema
```prisma
enum ScanType {
  NPM_BACKEND
  NPM_FRONTEND
  SYSTEM_PACKAGES
  DOCKER_IMAGES
  SSL_CERTIFICATE
}

model VulnerabilityReport {
  id                 String   @id @default(uuid())
  scanType           ScanType
  totalVulnerabilities Int    @default(0)
  criticalCount      Int      @default(0)
  highCount          Int      @default(0)
  moderateCount      Int      @default(0)
  lowCount           Int      @default(0)
  infoCount          Int      @default(0)
  details            String?  // Full npm audit JSON
  systemInfo         String?  // OS/Node/Docker versions
  packagesChecked    Int?
  fixAvailable       Boolean  @default(false)
  scanDurationMs     Int?
  errorMessage       String?
  createdAt          DateTime @default(now())
}
```

### Scan Schedule
- **Automatic**: Daily at 2:00 AM (configured in BullMQ)
- **Manual**: Trigger from admin dashboard or API
- **Retention**: Scan results stored indefinitely (can be cleaned up via API)

### Responding to Vulnerabilities
1. **Review**: Check admin dashboard "Vulnerabilities" tab
2. **Assess**: Click "View" on any report to see full details
3. **Fix**: Run `npm audit fix` in backend/frontend directories
4. **System Updates**: SSH to Lightsail and run `apt-get update && apt-get upgrade`
5. **Verify**: Trigger manual scan to confirm fixes

### Implementation Files
- `backend/src/services/vulnerabilityService.ts` — core scanning logic
- `backend/src/queue/vulnerabilityWorker.ts` — BullMQ worker and scheduler
- `backend/src/routes/admin.ts` — API endpoints
- `backend/public/admin.html` — dashboard UI (Vulnerabilities tab)

---

## Environment Variables

Backend requires a `.env` file. Key variables:

```
DATABASE_URL          # PostgreSQL connection string (Prisma)
JWT_SECRET            # generate: openssl rand -hex 32
JWT_REFRESH_SECRET    # separate secret for refresh tokens
REFRESH_TOKEN_ROTATION # "true" enables refresh-token rotation + reuse detection on /auth/refresh; default "false". Now ON in BOTH dev and prod (2026-06-10). Safe for every shipped client because rotation is crash-tolerant server-side: a rotated token is tombstoned (not deleted) and a replay whose successor was never itself used is recovered with a fresh token instead of revoking the family (see Security Notes). Revert by setting "false" + redeploy.
ADMIN_API_KEY         # protects /api/admin routes (X-Admin-Key header)
ADMIN_EMAILS          # comma-separated allowlist for in-app Admin Console UI visibility
AWS_ACCESS_KEY_ID
AWS_SECRET_ACCESS_KEY
AWS_REGION
AWS_S3_BUCKET
REDIS_URL
GROK_API_KEY          # xAI API key for Grok Imagine
ALLOWED_ORIGINS       # comma-separated CORS whitelist
SES_FROM_ADDRESS      # verified SES sender address
GEOIP_API_KEY         # if using a paid geo-IP provider
APPLE_BUNDLE_ID       # iOS bundle identifier (com.evofaceflow.tryon.app)
APPLE_APP_APPLE_ID    # numeric App Store ID from App Store Connect
APPLE_ENVIRONMENT     # "Production" or "Sandbox" — environment Apple sends from
APPLE_ROOT_CERTS_DIR  # path to dir holding Apple root CA .cer files inside the container (defaults to ./certs/apple)
APPLE_API_KEY_ID         # 10-char In-App Purchase key id (App Store Server API auth) — required only for admin "Refresh from Apple"
APPLE_API_KEY_ISSUER_ID  # UUID issuer id from App Store Connect Users and Access → Integrations
APPLE_API_KEY_PATH       # path to .p8 private key file for the In-App Purchase key
CLOUDWATCH_LOG_GROUP     # set to ship Winston logs to CloudWatch (separate write-only IAM creds in CLOUDWATCH_AWS_*). Unset = no shipping.
SENTRY_DSN               # GATES the whole Sentry integration. Unset = disabled no-op. Set per-environment in backend/.env.
SENTRY_ENVIRONMENT       # "production" / "development" tag (NODE_ENV is "production" on both boxes; set this to tell them apart). Default derived from APP_URL.
SENTRY_RELEASE           # optional; groups issues by deploy (git SHA). Falls back to tryon-backend@<package version>.
SENTRY_TRACES_SAMPLE_RATE # 0.0–1.0 performance-tracing rate. Default 0 = errors only (preserves free-tier quota).
SENTRY_AUTH_TOKEN        # optional; org auth token (project:read + event:read) for the dashboard's "recent issues" panel
SENTRY_ORG_SLUG          # optional; org slug for the recent-issues panel + project deep link
SENTRY_PROJECT_SLUG      # optional; project slug for the recent-issues panel + project deep link
MODERATION_STRIKE_ALERT_EVERY # default 3 — email ADMIN_EMAILS on every Nth content-moderation strike a single user accrues (repeat banned-content attempts)
WORKER_ENABLED         # "false" = this instance is API-only (serves traffic, does NOT run the BullMQ workers/schedulers); default/unset = workers run (single-box behavior). For multi-instance HA behind a load balancer — see DEPLOYMENT.md §17.
SPLASH_DIR             # DEPRECATED — the splash now lives in S3 (splash/ prefix), not a local dir. Var is unused; safe to drop from .env / compose.
```

---

## Security Notes

- Passwords hashed with bcrypt (cost factor ≥ 12).
- JWTs: short-lived access tokens (15 min) + long-lived refresh tokens (30 days) stored in HttpOnly cookies (web) or secure device storage (mobile).
- **Refresh-token rotation + reuse detection (ON in dev + prod as of 2026-06-10, gated by `REFRESH_TOKEN_ROTATION`).** Each `/auth/refresh` mints a new refresh token and tombstones the old row (`rotatedAt` + `replacedByToken` on [RefreshToken](#refreshtoken)). Replaying a token whose successor has itself advanced is treated as theft → the whole token family is revoked (`logSecurity('refresh_token_reuse')`). The one subtle case is a **crash-in-the-gap**: the client persists the rotated token only *after* the network response, so a force-close in that window leaves the device holding a consumed token. To avoid logging those users out, a replay whose successor was **never itself used** is recovered by minting a fresh token (`logSecurity('refresh_token_grace_recovery')`) rather than revoking. This is safe for every shipped client — even one that doesn't persist the rotated token keeps working via repeated grace recovery — and is a net gain over the old OFF default where a stolen refresh token stayed valid its full 30 days. Implemented in [authController.refreshToken](backend/src/controllers/authController.ts). The client persists the rotated token at [api.ts](frontend/src/config/api.ts) (`data.refreshToken ?? refreshToken`); no client change was needed for the fix.
- The S3 bucket is **private** (Block Public Access enabled, no public bucket policy). The DB stores bare S3 keys (e.g. `body-photos/<userId>/<file>.jpg`) in `User.avatarUrl`, `User.fullBodyUrl`, `User.mediumBodyUrl`, `TryOnJob.clothingPhoto1Url`, `TryOnJob.clothingPhoto2Url`, `TryOnJob.bodyPhotoUrl`, `TryOnJob.resultFullBodyUrl`, and `TryOnJob.resultMediumUrl`. Controllers mint presigned GET URLs at response time via `presignUserPhotos`, `presignTryOnJob`, `presignTryOnJobs`, and `presignAvatarOnly` in [backend/src/services/imageUrlService.ts](backend/src/services/imageUrlService.ts) (1-hour TTL). The helpers tolerate legacy rows that still hold full `https://...amazonaws.com/...` URLs by extracting the key.
- The Grok worker reads body and clothing inputs by S3 key via the AWS SDK — never via public URL — see `resolveS3Key()` in [backend/src/services/grokService.ts](backend/src/services/grokService.ts).
- When adding a new endpoint that returns image fields, route the response through the appropriate `presign*` helper before sending. Forgetting this on a new endpoint will produce 403s on the client once Block Public Access is on.
- **A PUBLIC try-on post intentionally surfaces its INPUT thumbnails** (the body photo + clothing item that produced the result) alongside the AI result — that's the feed-card / profile-grid / shared-post design (the user chose to publish that try-on). The feed, `GET /api/tryon/:jobId`, and the public profile grid all return the inputs for public posts. **PRIVATE jobs are never shown to non-owners at all** (404 / excluded by the `isPrivate:false` where-clause), so they keep everything hidden. (History note: a 2026-06-16 pass briefly stripped these inputs for non-owners as a "leak" fix; that broke the intended feed thumbnails and was reverted 2026-06-17.)
- **Saved Looks is the one exception**: `routes/looks.ts` deliberately strips non-owner input photos via the pure, unit-tested `stripNonOwnerJobInputs(job, isOwner)` ([backend/src/utils/jobVisibility.ts](backend/src/utils/jobVisibility.ts)) — a saved look can outlive the original's public state, so only the owner gets its inputs back (results only for everyone else; a VIDEO's poster is kept). This is intentionally MORE conservative than the live feed.
- Body photo S3 keys are prefixed with the userId and are not guessable.
- Rate limiting applied to `/api/auth` and `/api/tryon` endpoints.
- GDPR/CCPA: users can export and delete all personal data including body photos and AI results.
- **Account deletion (App Store Guideline 5.1.1(v)):** `profileController.deleteAccount` enumerates every S3 key the user owns (avatar, full-body, medium-body, all clothing photos, all result images) from `User` + `TryOnJob` rows, deletes the `User` row (Prisma cascades clean up Likes, Follows, Comments, CommentLikes, CreditTransactions, ApplePurchases, Notifications, RefreshTokens, UserLocations, TryOnJobs, Reports, UserBlocks), then fires async S3 deletes. DB-first ordering ensures the account is unreachable even if S3 partially fails; failures are logged for an orphan sweep.
  - **Actor-orphaned notification cleanup:** notifications the deleted user GENERATED for others where the *type only makes sense with an actor* — `LIKE` / `FOLLOW` / `COMMENT_LIKE` — are deleted (not left to the `actor onDelete: SetNull` cascade, which would render them as an un-attributable "Someone liked your try-on / followed you" in the recipient's inbox). Done via `deleteActorOrphanedNotifications()` ([accountDeletionService.ts](backend/src/services/accountDeletionService.ts), exported `ACTOR_ORPHAN_NOTIFICATION_TYPES`, unit-tested) called BEFORE the row is removed, in `deleteUserAndAssets` (self + guest-cleanup) AND the admin delete-user route. Durable `COMMENT` / `COMMENT_REPLY` keep the SetNull tombstone (don't break threads). A one-time migration (`20260617000000_cleanup_orphaned_actor_notifications`) swept pre-existing orphans globally.
- The close-up photo path (`avatarUrl`) is validated server-side and excluded from all Grok API calls.

### Fail2ban & Rate Limiting

Production deployment includes fail2ban for automated IP banning:
- **nginx-404**: Bans IPs after 10+ 404 errors in 60 seconds (1 hour ban)
- **nginx-nophp**: Bans IPs requesting `.php` files (24 hour ban) — we don't serve PHP
- **nginx-wordpress**: Bans IPs requesting `wp-*` paths (24 hour ban) — we don't run WordPress
- **nginx-badbots**: Bans IPs sending malicious requests (SQL injection, XSS attempts)
- **nginx-auth**: Bans IPs with excessive failed auth attempts

Nginx also blocks common vulnerability scan targets at the edge (returns 444 / connection dropped):
- All `.php`, `.asp`, `.aspx`, `.jsp`, `.cgi` requests
- WordPress paths (`wp-admin`, `wp-content`, `wp-includes`, `xmlrpc.php`)
- Sensitive files (`.env`, `.git`, `.htaccess`)

Configuration files:
- `fail2ban/jail.local` — jail definitions
- `fail2ban/filter.d/*.conf` — filter regex patterns
- `nginx/nginx.conf` — rate limit zones and blocking rules

---

## Local Code Backup

The project is backed up to an external drive using Syncovery 8.70 (straight file copy). To save space, exclude folders that are transient, build artifacts, or recreatable from a single `npm install`. Excluding the items below shrinks the copy by ~585 MB while preserving everything needed to restore the project.

### Safe to exclude (recreatable / transient)

| Path | Size | Why it's safe |
|---|---|---|
| `backend/node_modules/` | 327 MB | `cd backend && npm install` |
| `frontend/node_modules/` | 259 MB | `cd frontend && npm install` |
| `backend/dist/` | <1 MB | Output of `npm run build` |
| `backend/logs/` | <1 MB | Runtime logs (dev only) |
| `frontend/.expo/` | <1 MB | Expo dev cache (per-machine) |
| `frontend/android/` | <1 MB | Regenerated by `npx expo prebuild` / `expo run:android` |
| `.expo/` | empty | Expo project cache |
| `frontend/ios/` | n/a | Same as android — regenerated by `expo run:ios` |

### Glob patterns (catch-all for Syncovery filters)

```
**/node_modules/**
**/.expo/**
**/dist/**
**/build/**
**/.next/**
**/web-build/**
**/.turbo/**
**/.cache/**
**/.parcel-cache/**
**/coverage/**
**/.nyc_output/**
**/logs/**
**/*.log
**/.eslintcache
**/*.tsbuildinfo
**/.DS_Store
Thumbs.db
```

### ⚠️ DO NOT exclude

- **`.git/`** (~6 MB) — branch history, commits, remotes. Excluding it loses all git state.
- **`backend/.env`** and **`frontend/.env`** — gitignored, so the backup is the *only* copy of secrets (DB URL, JWT secrets, AWS keys, Grok key, Apple config). **Critical to keep.**
- **`backend/certs/`** — Apple root CA `.cer` files (re-downloadable from apple.com) and the App Store Server API `.p8` private key (NOT re-downloadable — App Store Connect lets you download a key file exactly once). Backend won't boot without the root CAs; admin "Refresh from Apple" won't work without the .p8.
- **`backend/secrets/`** — currently empty, but anything dropped here later must be backed up.
- **`backend/prisma/`** — schema + migrations are source of truth, not generated.
- **`package-lock.json`** files (both packages) — needed for reproducible installs.

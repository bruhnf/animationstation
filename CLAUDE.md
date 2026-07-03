# CLAUDE.md — AnimationStation

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Environment Notice

**This is a test and development environment.** There is no need to preserve existing users, tokens, or data when making schema changes or migrations. Feel free to drop and recreate the database as needed.

---

## Project Overview

**AnimationStation** (animationstation.ai) is a free-form AI image & video creation app: users generate images from text, transform/compose their own images with a prompt, clean up messy photos into product-style shots, and animate images into short video clips. Generation runs on the xAI **Grok Imagine** API. Monorepo:

- `backend/` — Node.js/Express REST API (TypeScript, Prisma/PostgreSQL, BullMQ/Redis, S3)
- `frontend/` — React Native (Expo SDK 54) mobile app
- `website/` — static marketing + account site, served by the backend at the site root

### Create features (mobile "Create" hub)

| Feature | Endpoint | Screen |
|---|---|---|
| Text-to-Image ("Design") | `POST /api/closet/generate` | `DesignScreen` |
| Image Transform / multi-image compose | `POST /api/transform` | `TransformScreen` |
| Clean Up a Photo | `POST /api/closet/cleanup` | `CleanUpScreen` |
| Image-to-Video | `POST /api/video` | `VideoScreen` |

Every generated item is a **Creation** (Prisma model `Creation`, table `creations`, `kind: IMAGE | VIDEO`) or a **ClosetItem** (text-to-image designs, table `closet_items`). The unified gallery (`components/CreationsGrid.tsx`, "My Creations") merges `GET /api/creations/history` + `GET /api/closet`.

## Commands

### Backend
```bash
cd backend
npm run dev      # hot-reload dev server (ts-node-dev)
npm run build    # compile to dist/
npm test         # node --test unit suite (pure; needs dummy JWT/DB env vars — see CI)
npm run lint     # eslint
npx tsc --noEmit # typecheck
npm run migrate  # prisma migrate dev
```

### Frontend
```bash
cd frontend
npx expo start   # dev server (Expo Go on SDK 54, or the dev client)
npm test         # jest-expo unit tests
npx tsc --noEmit # typecheck
```

> **Expo SDK pin:** the project targets **Expo SDK 54** (what the team's Expo Go supports). Expo-SDK-managed packages (expo*, react, react-native*, @types/react) are bumped ONLY via `npx expo install` during a deliberate SDK upgrade — Dependabot is configured to ignore them (`.github/dependabot.yml`).

### Root
```bash
npm run format        # prettier --write (repo-wide)
npm run format:check  # what CI runs
node scripts/build-docs.js  # regenerate docs/*.html from the md docs
```

### Backend API surface (mounted in `backend/src/index.ts`)
`/api/auth` (signup/login/refresh/guest/claim), `/api/transform` (submit a transform), `/api/creations` (history / `:jobId` status / privacy / title / bulk-delete + `/creations/:jobId/comments`), `/api/upload`, `/api/profile`, `/api/friends`, `/api/feed`, `/api/likes`, `/api/looks` (saved looks), `/api/closet` (text-to-image designs + cleanup), `/api/video` (image-to-video), `/api/credits` (+ Apple IAP verify-receipt), `/api/webhooks/apple`, `/api/admin` (X-Admin-Key), `/api/notifications`, `/api/referral`, `/api/share` + `/t/:jobId` (public share pages), `/api/splash`, `/api/config`, `/api/sms`.

## Architecture Notes

- **Creation flow (transform):** client uploads source/reference images (or references a closet item) → S3 → credit charge (conditional decrement in a transaction; refund on terminal failure) → BullMQ `transform` queue → `transformWorker` calls Grok Imagine → result stored in S3 → `Creation` row COMPLETE. Videos follow the same shape via the `video` queue and `videoWorker` (poll-based Grok video API; see `utils/videoPoll.ts`).
- **S3 prefixes** (bucket private, presigned reads via `services/imageUrlService.ts`): `source-images/`, `ref-images/`, `results/`, `videos/`, `closet/`, `splash/`. The DB stores bare S3 keys, never URLs.
- **Guest mode:** first app open mints an anonymous guest (`POST /auth/guest`, device-scoped reuse). Guests browse everything; social writes are blocked by `blockGuests`; their creations are forced private. `POST /auth/claim` upgrades the same row to a real account.
- **Credits & tiers:** `FREE/BASIC/PREMIUM` (`services/tierService.ts`); weekly included generations for subscribers, credits otherwise. Admin-tunable runtime settings live in the `app_settings` table (guest/signup/referral grants, video cost, soft-throttle config) via the admin dashboard `/admin`.
- **Soft throttle:** bursts beyond a tier-scaled free quota get a short BullMQ delay + client countdown (`services/throttleService.ts`) — shared budget across image + video generations.
- **Moderation:** Grok's content filters + a 3-warning refund grace on fully-blocked generations (`utils/moderationGrace.ts`, `services/moderationService.ts`); user reports + blocks (`/api/reports`, `/api/users/:id/block`) satisfy App Store Guideline 1.2. Every AI result carries an `AiGeneratedBadge` (Guideline 4.0).
- **AI consent:** `User.aiProcessingConsentAt` gates every generation endpoint (403 `AI_CONSENT_REQUIRED`); the app surfaces `AiConsentModal` naming xAI (Guidelines 5.1.1(i)/5.1.2(i)).
- **Observability:** Winston structured logs (+ optional CloudWatch shipping), Sentry (gated on `SENTRY_DSN`), Prometheus `/metrics`, deep `/health` (Postgres+Redis probes) vs shallow `/health/live` (Docker liveness).
- **Website:** served by the backend (`express.static('../website')` after the API routes); bind-mounted in compose so site edits deploy with a `git pull` + container restart, no rebuild.

## Deployment

Two Lightsail boxes, dev/prod split. Full runbook in [DEPLOYMENT.md](DEPLOYMENT.md).

| Environment | Host | Server | Compose file |
|---|---|---|---|
| **Production** | animationstation.ai | 34.227.203.230 | `docker-compose.prod.yml` |
| **Dev** | dev.animationstation.ai | 54.173.136.56 | `docker-compose.dev.yml` |

Deploys are **manual** (CI is tests-only — `.github/workflows/ci.yml`):

```bash
ssh ubuntu@<box-ip>          # key: LightsailDefaultKey-us-east-1
cd /opt/animationstation && git pull
docker compose -f docker-compose.<env>.yml up -d --build
docker compose -f docker-compose.<env>.yml exec backend npx prisma migrate deploy   # after any schema change
```

Both boxes are shared with another app whose nginx container owns :80/:443 and proxies `animationstation.ai` / `dev.animationstation.ai` → `animationstation-api:3000` over the external `apps` docker network. This stack runs **no proxy of its own**. TLS certs are issued by the host's certbot.

The committed `frontend/src/config/api.ts` `ENV` must stay `'prod'` — CI enforces it.

## Database

PostgreSQL 15 via Prisma. Schema: [backend/prisma/schema.prisma](backend/prisma/schema.prisma) (the authoritative reference — models `User`, `Creation`, `ClosetItem`, `Comment`, `CommentLike`, `Like`, `SavedLook`, `Follow`, `Notification`, `Report`, `UserBlock`, `Referral`, `ApplePurchase`, `CreditTransaction`, `RefreshToken`, `UserLocation`, `AppSetting`, `VulnerabilityReport`, `SmsOptIn`). Migrations were squashed to a single init migration when the app got its own identity (2026-07-01); the DB uses the `citext` extension for case-insensitive usernames/emails.

## Environment Variables

See [backend/.env.example](backend/.env.example) for the full annotated list: `DATABASE_URL`, `JWT_SECRET`/`JWT_REFRESH_SECRET`, `REFRESH_TOKEN_ROTATION`, `ADMIN_API_KEY`/`ADMIN_EMAILS`, AWS + `AWS_S3_BUCKET`, `REDIS_URL`, `GROK_API_KEY`, `ALLOWED_ORIGINS`, `APP_URL`, SMTP/SES sender config, Apple IAP config (`APPLE_BUNDLE_ID` = `ai.animationstation.app`, root certs dir, Server API key), `SENTRY_*`, `WORKER_ENABLED`.

## Git workflow

See [CONTRIBUTING.md](CONTRIBUTING.md). A husky pre-push hook runs prettier + backend lint/types/tests + frontend types/tests; CI re-runs the same on GitHub. Note: `bullmq` pins `ioredis` to an exact version — keep `backend/package.json`'s ioredis in lockstep (save-exact) or the duplicated tree breaks tsc.

**Branch model:** `develop` = active development, deployed to the **dev box** (dev.animationstation.ai). `main` = release-stable, deployed to the **prod box** (animationstation.ai) and tracked by the App Store / TestFlight build. Work on `develop`, deploy to dev to verify, then fast-forward `main` from `develop` and deploy to prod. Keep `main` clean (green + release-ready) at all times.

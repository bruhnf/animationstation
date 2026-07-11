# DEPLOYMENT.md — AnimationStation

Runbook for the AnimationStation fleet. Deploys are **manual by design** — CI (`.github/workflows/ci.yml`) only runs tests; nothing on GitHub touches a server.

## 1. Fleet

| Environment | Host | Lightsail box | IP | Compose file |
|---|---|---|---|---|
| Production | animationstation.ai (+www) | prod box¹ | 34.227.203.230 | `docker-compose.prod.yml` |
| Dev | dev.animationstation.ai | dev box¹ | 54.173.136.56 | `docker-compose.dev.yml` |

¹ The Lightsail instance names predate AnimationStation and still carry the co-hosted app's old brand; identify boxes by IP. A rename requires snapshot → new instance and is tracked separately.

Both boxes: Ubuntu 22.04, 2 GB RAM / 2 vCPU / 60 GB, 2 GB swap. SSH: `ssh ubuntu@<ip>` with the Lightsail default key (`LightsailDefaultKey-us-east-1`).

## 2. Topology on each box

- The co-hosted app's compose stack runs the box's single **nginx** on :80/:443 (plus its own backend/postgres/redis/fail2ban). AnimationStation's server blocks live in that stack's nginx config; certbot on the **host** manages all certs.
- AnimationStation lives at `/opt/animationstation` (a git checkout of `github.com/bruhnf/animationstation` — the **dev box tracks `develop`, the prod box tracks `main`**; see the Branch model in §3): containers `animationstation-api` (Express, port 3000, internal), `animationstation-db` (postgres 15), `animationstation-redis`. No ports are published to the host — nginx reaches the API by container name over the shared external docker network **`apps`**.
- The backend serves BOTH `/api/*` and the static website (bind-mounted `./website`), so one server block per hostname is enough.

## 3. Deploy

```bash
ssh ubuntu@34.227.203.230        # prod (54.173.136.56 for dev)
cd /opt/animationstation && git pull
chmod -R o+r website             # ⚠️ REQUIRED — see "website file permissions" below
docker compose -f docker-compose.prod.yml up -d --build          # dev: docker-compose.dev.yml
docker compose -f docker-compose.prod.yml exec backend npx prisma migrate deploy   # ⚠️ REQUIRED after any schema change
```

- **Website-only changes**: `git pull && chmod -R o+r website` (bind mount, served live by `express.static` — no rebuild or restart needed).
- **⚠️ Website file permissions:** the deploy user's umask is `0007`, so files that `git pull` *rewrites* land as `-rw-rw----` (no world-read). The backend container runs as a non-root user and reads the bind-mounted `./website` via "other" perms — so any page a pull touched then returns **HTTP 500** (`EACCES ... open '/app/website/<file>.html'`) until it's world-readable again. Always run `chmod -R o+r website` after a `git pull` that changed website files. (Untouched files keep their existing `664` and are fine.)
- **Secrets** (`.env` + `backend/.env`) are gitignored and survive `git pull`; backup copies in `/home/ubuntu/animationstation-secrets-backup/`.
- **Build memory caution:** the boxes are 2 GB and shared — build ONE app at a time (never rebuild AnimationStation and the co-hosted app simultaneously).
- **Branch model:** the **dev box checks out `develop`**, the **prod box checks out `main`**, so each box's `git pull` pulls its own branch. Do active work on `develop` → deploy to dev to test; when it's good, `git checkout main && git merge --ff-only develop && git push`, then deploy to prod. `main` stays release-stable because it's what the App Store / TestFlight build tracks.

## 4. Zero-gap migrations (additive)

When NEW code reads a NEW column, plain `up -d --build` → `migrate deploy` leaves a window where the new container 500s until the migration lands. For additive (nullable) migrations, apply the migration from a throwaway new-image container first, then swap:

```bash
cd /opt/animationstation && git pull
docker compose -f docker-compose.prod.yml build backend
docker compose -f docker-compose.prod.yml run --rm backend npx prisma migrate deploy
docker compose -f docker-compose.prod.yml up -d --build
```

Destructive migrations (drop/rename/NOT-NULL) are not safe while old code serves — use a brief maintenance window or an expand/contract migration.

## 5. nginx / TLS changes (owned by the co-hosted app's stack)

AnimationStation's server blocks (`animationstation.ai`, `www`, `dev.`) live in the co-hosted app's nginx config on each box. After editing that config, a plain reload does NOT pick up bind-mounted single-file changes (stale inode) — **force-recreate** its nginx container:

```bash
docker compose -f <cohost-compose-file> up -d --force-recreate nginx
```

Certs: host certbot with the standard renewal timer. New hostname → `sudo certbot certonly --webroot` (or `--nginx`) + add the server block + force-recreate nginx. Verify renewals: `sudo certbot renew --dry-run`.

## 6. Logs & health

```bash
# All AnimationStation services
docker compose -f docker-compose.prod.yml logs -f --tail=200
# Structured backend logs (correlationId, userId)
docker compose -f docker-compose.prod.yml exec backend tail -f /var/log/animationstation/combined-$(date +%Y-%m-%d).log
```

- `https://animationstation.ai/health` — deep check (Postgres `SELECT 1` + Redis `PING`, 200 only when both up). UptimeRobot monitors this externally.
- `/health/live` — shallow, backs the Docker liveness probe.
- Admin dashboard: `https://animationstation.ai/admin` (X-Admin-Key) — Diagnostics tab shows queue depth, worker failures, integrations, stuck jobs.
- Sentry: gated on `SENTRY_DSN` in `backend/.env` (`SENTRY_ENVIRONMENT=production` on prod, `development` on dev).

## 7. Backups & rollback

| Layer | What | Restore |
|---|---|---|
| Lightsail snapshots (daily, both boxes) | whole-VM rollback | Lightsail console → new instance from snapshot |
| Nightly `pg_dump` (prod box cron `/usr/local/bin/backup-postgres.sh`) | `animationstation_db` alongside the co-hosted app's DB → S3 backups bucket | `aws s3 cp` + `gunzip | psql` |
| S3 bucket versioning (`animationstation-uploads-dev`) | per-object undo | S3 console "Show versions" |

## 8. Housekeeping

- Docker build caches grow unbounded on 60 GB disks — a monthly cron runs `docker builder prune --keep-storage 5GB` on both boxes. Manual: `docker system df` to inspect, `docker image prune -a` for dangling images.
- DB user/database: `animationstation` / `animationstation_db` (see box `.env`).
- Email: outbound sender is `noreply@animationstation.ai` (set `SES_FROM_ADDRESS` in each box `.env`). **Prerequisite:** the `animationstation.ai` domain must be verified in AWS SES (us-east-1) with DKIM CNAMEs + SPF + a custom MAIL FROM subdomain + DMARC published in DNS, or SES rejects the send. Receiving addresses (`support@`, `privacy@`, `dmca@animationstation.ai`) are inbound mailboxes/aliases and are independent of SES.

## 9. Stripe web purchases

Web-only credit/subscription purchases (mobile stays Apple IAP). Catalog + pricing live in `backend/src/config/stripeProducts.ts`; routes are `backend/src/routes/billing.ts` (checkout + billing portal) and `backend/src/routes/stripeWebhook.ts`.

- **Set per box**, in that box's `backend/.env`:
  - `STRIPE_SECRET_KEY` — a Stripe secret key. If this Stripe account is shared with another project, use a **restricted key** scoped to Checkout Sessions, Billing Portal, Customers, and Subscriptions only.
  - `STRIPE_WEBHOOK_SECRET` — the signing secret for this box's webhook endpoint.
- **Webhook endpoint** (Dashboard → Developers → Webhooks → Add endpoint): `https://<box-host>/api/webhooks/stripe`, subscribed to `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`. Dev and prod need **separate** endpoints (separate signing secrets) since they're separate hostnames.
- **Local dev without a real endpoint**: `stripe listen --forward-to localhost:3000/api/webhooks/stripe` prints a `whsec_...` — use that as `STRIPE_WEBHOOK_SECRET`.
- Test-mode vs live-mode keys are entirely separate in Stripe — use test keys on the dev box, live keys only on prod, once you're ready to accept real charges.
- No products/prices need to be pre-created in the Stripe Dashboard — Checkout Sessions are created with inline `price_data`, so the catalog file above is the single source of truth for pricing.
- If this Stripe account is shared with another business: every Checkout Session and Subscription is tagged with `metadata.productKey` from our catalog, and the webhook only acts on events carrying one of those keys — events for the other business's products are ignored, not double-processed. Payouts and Dashboard-level revenue reports are NOT separated by product automatically; that reconciliation is manual.

- Docker build caches grow unbounded on 60 GB disks — a monthly cron runs `docker builder prune --keep-storage 5GB` on both boxes. Manual: `docker system df` to inspect, `docker image prune -a` for dangling images.
- DB user/database: `animationstation` / `animationstation_db` (see box `.env`).
- Email: outbound sender is `noreply@animationstation.ai` (set `SES_FROM_ADDRESS` in each box `.env`). **Prerequisite:** the `animationstation.ai` domain must be verified in AWS SES (us-east-1) with DKIM CNAMEs + SPF + a custom MAIL FROM subdomain + DMARC published in DNS, or SES rejects the send. Receiving addresses (`support@`, `privacy@`, `dmca@animationstation.ai`) are inbound mailboxes/aliases and are independent of SES.

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
- AnimationStation lives at `/opt/animationstation` (a git checkout of `github.com/bruhnf/animationstation`, branch `main`): containers `animationstation-api` (Express, port 3000, internal), `animationstation-db` (postgres 15), `animationstation-redis`. No ports are published to the host — nginx reaches the API by container name over the shared external docker network **`apps`**.
- The backend serves BOTH `/api/*` and the static website (bind-mounted `./website`), so one server block per hostname is enough.

## 3. Deploy

```bash
ssh ubuntu@34.227.203.230        # prod (54.173.136.56 for dev)
cd /opt/animationstation && git pull
docker compose -f docker-compose.prod.yml up -d --build          # dev: docker-compose.dev.yml
docker compose -f docker-compose.prod.yml exec backend npx prisma migrate deploy   # ⚠️ REQUIRED after any schema change
```

- **Website-only changes**: `git pull` + `docker restart animationstation-api` (bind mount, no rebuild).
- **Secrets** (`.env` + `backend/.env`) are gitignored and survive `git pull`; backup copies in `/home/ubuntu/animationstation-secrets-backup/`.
- **Build memory caution:** the boxes are 2 GB and shared — build ONE app at a time (never rebuild AnimationStation and the co-hosted app simultaneously).

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
- Email: SMTP sender `noreply@animationstation.bruhnfreeman.com` (moving to `@animationstation.ai` requires SES/SMTP domain verification — tracked as follow-up).

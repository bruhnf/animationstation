# AWS Lightsail Deployment Guide

---

## ⚠️ QUICK DEPLOY REFERENCE (Read This First!)

**Every time you deploy changes to Lightsail:**

```bash
# SSH into Lightsail
ssh ubuntu@<your-lightsail-ip>
cd /opt/evofaceflow/TryOn

# Pull latest code
git pull

# Rebuild and restart containers
docker compose -f docker-compose.prod.yml up -d --build

# ⚠️ CRITICAL: Apply any database migrations
docker compose -f docker-compose.prod.yml exec backend npx prisma migrate deploy
```

> **🚨 WARNING:** If you skip the `prisma migrate deploy` step after schema changes, the backend will crash with database errors!

> **🟢 ZERO-GAP ORDERING when the new code reads a NEW column (additive migrations).**
> The order above (`up -d --build` *then* `migrate deploy`) leaves a window: the
> new container starts serving **before** the migration runs, so any request whose
> code path `SELECT`s a column the migration hasn't added yet **returns 500 until
> the migration lands**. This bit the `add_throttle_reset` migration — it adds
> `User.throttleResetAt`, which `computeQueueDelayMs` selects on **every try-on
> AND video submit**, so both endpoints fail in the gap. You can't run the new
> migration from the *old* container (migration files are baked into the image at
> build time), so apply it with a **throwaway container built from the new
> image** while the old container keeps serving — an additive *nullable* column
> is invisible to the old code — then swap:
> ```bash
> cd /opt/evofaceflow/TryOn
> git pull
> # 1. Build the new image (it contains the new migration file)
> docker compose -f docker-compose.prod.yml build backend
> # 2. Apply the migration via a throwaway NEW-image container — old container is
> #    still serving live traffic and harmlessly ignores the new nullable column
> docker compose -f docker-compose.prod.yml run --rm backend npx prisma migrate deploy
> # 3. Now swap to the new code — the column already exists, so no 500 gap
> docker compose -f docker-compose.prod.yml up -d --build
> ```
> **Scope:** this is for **additive** migrations (new nullable column / new table)
> the new code reads immediately. **Destructive** migrations (drop / rename / add
> a NOT-NULL column) are NOT safe to apply while the old code is still live —
> those need a short maintenance window or an expand/contract multi-step
> migration. When unsure, ask: *can the currently-running code tolerate the schema
> mid-state?* If no, don't use this ordering.

---

## 🚀 1.3.0 production cutover (one-time, when promoting 1.3.0 to prod)

As of 2026-06-16 **1.3.0 lives on `develop` / the dev box only — prod (`main`) is on 1.2.0.** 1.3.0 = **AI Video** (image-to-video), bottom-nav expansion (Video + Design tabs), try-on captions, the web "My Try-Ons" carousel, and credit-farming hardening. Do the cutover **with** the 1.3.0 App Store build, in this order:

```bash
# 1. Merge develop -> main, push, then on the PROD box:
ssh ubuntu@<prod-ip>
cd /opt/evofaceflow/TryOn
git pull
docker compose -f docker-compose.prod.yml up -d --build
# 2. Apply the THREE new migrations (add_tryon_title, add_email_normalized, add_video_jobs):
docker compose -f docker-compose.prod.yml exec backend npx prisma migrate deploy
# 3. chmod -R a+rX website   # the My Try-Ons carousel changed website/* (umask 007 gotcha)
```

- **Native app gate:** video playback uses `expo-video` (a native module). The 1.3.0 **App Store build must be live** for users to get the Video screen — a JS-only/OTA update can't add the native module. Backend can be promoted independently (the `/api/video` routes just sit unused until the app build ships).
- **No new nginx change** for 1.3.0 (the `/t/` share proxy from 1.2.0 already serves the video share pages). Verify after: `curl -s -o /dev/null -w "%{http_code}" -X POST https://api.tryon-mirror.ai/api/video` → `401` (route mounted, auth-gated).

---

## 🚀 1.2.0 production cutover — ✅ DONE (2026-06-15)

This was completed: prod runs the 1.2.0 backend with `add_referrals` + `add_saved_looks` applied and nginx force-recreated for `/t/`. Kept below for reference / as the template for future cutovers.

As of 2026-06-13 **all 1.2.0 work lives on `develop` / the dev box only — prod (`main`) is ~19 commits behind and has NONE of it.** The 1.2.0 App Store build (build 34) is **prod-pointed**, so once it's live, its new features (referral, Saved Looks, share pages, closet "Clean Up", `/api/config`-driven join offer) will **404 against prod until the prod backend is promoted.** Promote the backend **before/at** the App Store release, in this order:

```bash
# 1. Merge develop -> main (locally) and push, then on the PROD box:
ssh ubuntu@<prod-ip>
cd /opt/evofaceflow/TryOn
git pull                                                   # main now has 1.2.0
docker compose -f docker-compose.prod.yml up -d --build    # backend rebuild
# 2. Apply the TWO new migrations (referrals + saved_looks):
docker compose -f docker-compose.prod.yml exec backend npx prisma migrate deploy
# 3. Force-recreate nginx so the new `location /t/` proxy takes effect (share
#    pages render OG meta instead of the static-site index.html). A plain
#    reload/restart will NOT pick up the bind-mounted config change.
docker compose -f docker-compose.prod.yml up -d --force-recreate nginx
# 4. chmod -R a+rX website   # if any website/*.html changed (umask 007 gotcha)
```

Verify after: `curl https://api.tryon-mirror.ai/api/config` returns `{ "signupCreditGrant": ... }`, and `curl -s -o /dev/null -w "%{http_code}" https://api.tryon-mirror.ai/t/<a-public-jobId>` returns 200 (not the SPA index). **Keep the welcome-bonus grant at 10 until 1.2.0 is the live App Store build** (older builds hardcode "10 Free Credits").

---

## Database Migrations Explained

### What Are Migrations?

Prisma migrations are SQL scripts that update your database schema (tables, columns, indexes) to match changes in `backend/prisma/schema.prisma`. They're stored in `backend/prisma/migrations/`.

### When to Run Migrations

Run `npx prisma migrate deploy` whenever:

| Scenario | Command |
|----------|---------|
| **First-time setup** (fresh database) | Required — creates all tables |
| **After `git pull`** with schema changes | Required — applies new migrations |
| **After adding new fields/models** | Required — adds columns/tables |
| **Routine deploy with no schema changes** | Safe to run (no-op if nothing new) |

### What Happens If You Skip It?

The backend will crash with errors like:
```
PrismaClientKnownRequestError: The table `public.users` does not exist
```

### Migration Commands

```bash
# Production (Lightsail) — apply existing migrations
docker compose -f docker-compose.prod.yml exec backend npx prisma migrate deploy

# Local Docker — apply existing migrations  
docker compose exec backend npx prisma migrate deploy

# Local development (no Docker) — create + apply migrations
cd backend && npx prisma migrate dev
```

### Current Migrations

The authoritative list is the contents of `backend/prisma/migrations/`. List them with:

```bash
ls backend/prisma/migrations/
```

`prisma migrate deploy` applies all unapplied migrations in chronological order — you don't need to track them by hand. If you need to know what's currently applied vs pending on the server:

```bash
docker compose -f docker-compose.prod.yml exec backend npx prisma migrate status
```

---

## Prerequisites

- AWS Lightsail instance running Ubuntu 22.04
- Domain `tryon-mirror.ai` (and legacy `evofaceflow.com`) pointing to the Lightsail instance IP
- SSH access configured

## 1. Initial Server Setup

SSH into your Lightsail instance:

```bash
ssh ubuntu@<your-lightsail-ip>
```

### Install Docker and Docker Compose

```bash
# Update packages
sudo apt update && sudo apt upgrade -y

# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker ubuntu

# Install Docker Compose plugin
sudo apt install docker-compose-plugin -y

# Verify installation
docker --version
docker compose version

# Log out and back in for group changes to take effect
exit
```

### Configure swap space

**Do this on every Lightsail instance (prod *and* dev) before the first build.** The smaller Lightsail plans ship with little RAM and **no swap**. The backend image build runs `tsc`, which is memory-hungry, while Postgres + Redis + the old backend container are still up competing for RAM — with no swap, the box thrashes and the build appears to hang for minutes at the `npm run build` / `tsc` step (this actually happened on the dev server). A 2 GB swapfile gives `tsc` somewhere to spill so the build completes.

```bash
ssh ubuntu@<your-lightsail-ip>

# Check current memory + whether any swap already exists
free -h                          # if "Swap:" shows 0B, continue below

# Create a 2 GB swapfile
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile         # root-only — a world-readable swapfile leaks memory contents
sudo mkswap /swapfile
sudo swapon /swapfile

# Persist across reboots (without this, swap is gone after a restart)
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# Optional: bias the kernel toward using RAM first, swap only under pressure
# (default vm.swappiness=60 swaps too eagerly for a server workload)
echo 'vm.swappiness=10' | sudo tee /etc/sysctl.d/99-swappiness.conf
sudo sysctl -p /etc/sysctl.d/99-swappiness.conf

# Confirm
free -h                          # "Swap:" should now show 2.0Gi
```

> **Symptom this prevents:** `docker compose ... up -d --build` sits at `=> [builder] RUN npm run build` (the `tsc` step) for minutes with no output and looks frozen. That's RAM exhaustion, not a broken build — add swap and re-run. See also the "Out of memory" entry under Troubleshooting.

### Install Certbot for SSL

```bash
ssh ubuntu@<your-lightsail-ip>

sudo apt install certbot -y
```

## 2. Clone Repository

> **The GitHub repo is private** (since 2026-06-12). Servers authenticate with a
> **read-only deploy key** — generate one on the new box first, then clone over SSH:
>
> ```bash
> ssh-keygen -t ed25519 -C "tryon-deploy-<env>" -f ~/.ssh/tryon_deploy -N ""
> printf '\nHost github.com\n    User git\n    IdentityFile ~/.ssh/tryon_deploy\n    IdentitiesOnly yes\n' >> ~/.ssh/config
> chmod 600 ~/.ssh/config
> cat ~/.ssh/tryon_deploy.pub
> ```
>
> Add the printed public key at GitHub → repo **Settings → Deploy keys → Add deploy
> key** (leave "Allow write access" **unchecked**). Each server gets its own key —
> GitHub rejects a public key registered twice, and per-server keys can be revoked
> independently. Verify with `ssh -T git@github.com` (expect `Hi bruhnf/TryOn!` —
> the repo name, not a username, confirms the deploy key is in use).

```bash
sudo mkdir -p /opt/evofaceflow
sudo chown ubuntu:ubuntu /opt/evofaceflow
cd /opt/evofaceflow
git clone git@github.com:bruhnf/TryOn.git
cd TryOn
```

## 3. Configure Environment Variables

### Root .env file (for Docker Compose)

```bash
cp .env.example .env
nano .env
```

Set secure values:
```
POSTGRES_USER=tryon_prod
POSTGRES_PASSWORD=<generate: openssl rand -hex 32>
POSTGRES_DB=tryon_db
```

### Backend .env file

```bash
cp backend/.env.example backend/.env
nano backend/.env
```

Fill in all required values. Generate secrets with:
```bash
openssl rand -hex 32  # For JWT_SECRET, JWT_REFRESH_SECRET, ADMIN_API_KEY
```

**Important values:**
```
# CORS — must include the marketing site so the web auth flow works
ALLOWED_ORIGINS=https://tryon-mirror.ai

# Admin Console UI gate (comma-separated lowercase emails). Distinct from
# ADMIN_API_KEY which protects the actual /api/admin/* endpoints.
ADMIN_EMAILS=you@example.com

# Apple In-App Purchases — App Store Server Notifications V2 verifier
APPLE_BUNDLE_ID=com.evofaceflow.tryon.app
APPLE_APP_APPLE_ID=<numeric ID from App Store Connect URL>
APPLE_ENVIRONMENT=Production         # or "Sandbox" for the sandbox webhook
# Leave APPLE_ROOT_CERTS_DIR unset to use the default ./certs/apple inside
# the container (the path is relative to /app, the container WORKDIR).
```

> **🚨 Path gotcha:** `APPLE_ROOT_CERTS_DIR` must point to a path inside the container (e.g. `/app/certs/apple`), not the host. The default `./certs/apple` resolves correctly inside the container; setting it to a host path like `/opt/evofaceflow/TryOn/backend/certs/apple` will fail because the container has no view of the host filesystem.

### Apple Root CA Certificates

The backend's JWS verifier needs Apple's root CAs to validate App Store Server Notifications and StoreKit receipts. They are public certificates and are baked into the Docker image at build time.

```bash
# On your dev machine (one-time)
mkdir -p backend/certs/apple
# Download AppleRootCA-G3.cer (and optionally G2 + AppleIncRoot) from:
# https://www.apple.com/certificateauthority/
# Place the .cer files inside backend/certs/apple/
git add backend/certs/apple/*.cer
git commit -m "Add Apple root CAs for App Store Server Notifications V2"
```

The Dockerfile contains `COPY certs ./certs` which embeds these into the production image. Verify after deploy:

```bash
docker compose -f docker-compose.prod.yml exec backend ls certs/apple
# Should list the .cer files
```

## 4. SSL Certificate Setup

### Create certbot directory structure

```bash
cd /opt/evofaceflow/TryOn
mkdir -p certbot/www
```

### Get initial certificate (before nginx starts)

Stop any running services using port 80:
```bash
sudo docker compose -f docker-compose.prod.yml down 2>/dev/null || true
```

Get certificate:
```bash
sudo certbot certonly --standalone -d tryon-mirror.ai -d www.tryon-mirror.ai -d api.tryon-mirror.ai \
  -d evofaceflow.com -d www.evofaceflow.com -d api.evofaceflow.com   # legacy names still served
```

### Auto-renewal cron job

```bash
sudo crontab -e
```

Add:
```
0 0 * * * certbot renew --quiet --post-hook "docker compose -f /opt/evofaceflow/TryOn/docker-compose.prod.yml restart nginx"
```

## 5. Deploy Application

### Build and start all services

```bash
cd /opt/evofaceflow/TryOn
docker compose -f docker-compose.prod.yml up -d --build
```

### Run database migrations

```bash
docker compose -f docker-compose.prod.yml exec backend npx prisma migrate deploy
```

### Verify services are running

```bash
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs backend
```

### Test health endpoint

```bash
curl https://api.tryon-mirror.ai/health
```

## 5b. Apple In-App Purchase Configuration

In addition to env vars and the root CAs above, the App Store Connect side must be configured.

### App Store Server Notifications V2

In App Store Connect: **My Apps → [your app] → App Information → App Store Server Notifications**

| Field | Value |
|---|---|
| Production Server URL | `https://api.tryon-mirror.ai/api/webhooks/apple` |
| Sandbox Server URL | Same URL (or a separate one — see below) |
| Version | **Version 2** (V1 is deprecated) |

The endpoint must respond with HTTP 200 within a few seconds. Apple retries on non-2xx with exponential backoff. The webhook is exempt from the global rate limiter (see `index.ts`).

**Notification environments:** A single `APPLE_ENVIRONMENT` env var controls which environment the verifier accepts. To handle both Sandbox (TestFlight) and Production from the same backend you need either:
- Two backends with different `APPLE_ENVIRONMENT` values, OR
- Separate URLs in App Store Connect for Sandbox vs Production, with one of them rejecting the other's notifications.

For initial setup, point both URLs at the same backend with `APPLE_ENVIRONMENT=Sandbox`. Flip to `Production` and restart the stack just before public launch.

### IAP Products

Products must be configured in App Store Connect → **In-App Purchases & Subscriptions**. Product IDs must match `frontend/app.json` (`extra.appleProducts`) and `backend/src/config/appleIap.ts`:

| Product ID | Type | Tier / Credits |
|---|---|---|
| `com.evofaceflow.tryon.app.basic.monthly.v14` | Auto-renewing subscription | BASIC |
| `com.evofaceflow.tryon.app.premium.monthly.v14` | Auto-renewing subscription | PREMIUM |
| `com.evofaceflow.tryon.app.credits.10.free.v14` | Consumable | 10 credits (Free-tier price) |
| `com.evofaceflow.tryon.app.credits.25.free.v14` | Consumable | 25 credits (Free-tier price) |
| `com.evofaceflow.tryon.app.credits.50.free.v14` | Consumable | 50 credits (Free-tier price) |
| `com.evofaceflow.tryon.app.credits.100.free.v14` | Consumable | 100 credits (Free-tier price) |
| `com.evofaceflow.tryon.app.credits.10.basic.v14` | Consumable | 10 credits (Basic-tier price) |
| `com.evofaceflow.tryon.app.credits.25.basic.v14` | Consumable | 25 credits (Basic-tier price) |
| `com.evofaceflow.tryon.app.credits.50.basic.v14` | Consumable | 50 credits (Basic-tier price) |
| `com.evofaceflow.tryon.app.credits.100.basic.v14` | Consumable | 100 credits (Basic-tier price) |
| `com.evofaceflow.tryon.app.credits.10.premium.v14` | Consumable | 10 credits (Premium-tier price) |
| `com.evofaceflow.tryon.app.credits.25.premium.v14` | Consumable | 25 credits (Premium-tier price) |
| `com.evofaceflow.tryon.app.credits.50.premium.v14` | Consumable | 50 credits (Premium-tier price) |
| `com.evofaceflow.tryon.app.credits.100.premium.v14` | Consumable | 100 credits (Premium-tier price) |

The 12 credit-pack SKUs come in 4 sizes × 3 tier variants. **All variants of the same size grant the same number of credits** — only the price differs (Free = highest, Premium = lowest). The mobile client offers the user only the variant priced for their current tier.

Each product needs a price tier and at least one localization (display name + description). Sandbox testing requires "Ready to Submit" status minimum.

**SKU versioning.** Every product ID carries a `.v<N>` suffix matching the app version at which it was *last reissued* in App Store Connect (currently `.v14`). The suffix is **not** bumped on every app release; it only changes when an IAP gets stuck in "Needs Developer Attention" and can't be recovered. App Store Connect treats deleted product IDs as permanently burned — they can never be recreated under the same name — so when an IAP needs to be reissued, we bump the suffix to the current app version. **Reissuing IAPs ⇒ update both [frontend/app.json](frontend/app.json) and [backend/src/config/appleIap.ts](backend/src/config/appleIap.ts) to the new suffix, and re-link all products to the new version in App Store Connect.**

### Verifying the webhook end-to-end

Once env vars are set and the stack is up, you can fire a TEST notification from your dev machine using the helper script:

```powershell
cd frontend
$env:APPLE_ISSUER_ID="..."         # from App Store Connect → Users and Access → Integrations
$env:APPLE_KEY_ID="..."
$env:APPLE_PRIVATE_KEY_PATH=".\secrets\AuthKey_<KEYID>.p8"
$env:APPLE_BUNDLE_ID="com.evofaceflow.tryon.app"
npx ts-node ../backend/scripts/sendAppleTestNotification.ts sandbox
```

Watch the backend logs on Lightsail:

```bash
docker compose -f docker-compose.prod.yml logs --tail 200 backend | grep -iE "apple|webhook"
```

You should see four log lines: verifier initialized, notification enqueued, processing, TEST received.

## 6. Lightsail Firewall Configuration

In the AWS Lightsail console, go to your instance > Networking > Firewall:

- Allow TCP 80 (HTTP)
- Allow TCP 443 (HTTPS)
- Allow TCP 22 (SSH)
- Block all other ports

## 7. Fail2ban Setup

Fail2ban is included in the Docker Compose configuration and will automatically ban IPs that:
- Generate too many 404 errors (vulnerability scanners)
- Request PHP files (we don't serve PHP)
- Request WordPress paths (we don't run WordPress)
- Send malicious requests (SQL injection, XSS attempts)
- Have excessive failed auth attempts

### Verify fail2ban is running

```bash
docker compose -f docker-compose.prod.yml logs fail2ban
```

### Check banned IPs

```bash
docker compose -f docker-compose.prod.yml exec fail2ban fail2ban-client status
docker compose -f docker-compose.prod.yml exec fail2ban fail2ban-client status nginx-404
```

### Unban an IP

```bash
docker compose -f docker-compose.prod.yml exec fail2ban fail2ban-client set nginx-404 unbanip 1.2.3.4
```

### Configuration files

- `fail2ban/jail.local` — jail definitions (ban times, retry limits)
- `fail2ban/filter.d/*.conf` — regex patterns for each jail

## 8. Admin Dashboard

Access the admin dashboard at `https://api.tryon-mirror.ai/admin`

Login with the `ADMIN_API_KEY` from your backend `.env` file.

Features:
- View user statistics, try-on jobs, and credits
- Create test users
- Verify/unverify user accounts
- Toggle subscriptions
- Adjust user credits
- View suspicious login attempts and security stats

## 9. Monitoring & Logs

### Application Logging (Winston)

The backend uses Winston for structured logging with daily file rotation.

**Log Levels:**
- `error` - Application errors, exceptions, failed operations
- `warn` - Warnings, suspicious activity (e.g., suspicious login locations)
- `info` - Key business events, successful operations
- `http` - HTTP request/response logging
- `debug` - Detailed debugging information

**Environment Variables:**
```bash
LOG_LEVEL=debug       # Set log level (default: debug in dev, info in prod)
LOG_DIR=/var/log/tryon  # Log file directory (default: ./logs)
LOG_TO_FILE=true      # Enable file logging in development
```

**Log Files (Production):**

Located at `/var/log/tryon/` (Docker volume `backend_logs`):
- `combined-YYYY-MM-DD.log` - All logs, rotated daily, 14-day retention
- `error-YYYY-MM-DD.log` - Errors only, 30-day retention
- `exceptions-YYYY-MM-DD.log` - Unhandled exceptions
- `rejections-YYYY-MM-DD.log` - Unhandled promise rejections

### Viewing Logs

```bash
# Live Docker stdout/stderr logs (all services)
docker compose -f docker-compose.prod.yml logs -f

# Specific service Docker logs
docker compose -f docker-compose.prod.yml logs -f backend
docker compose -f docker-compose.prod.yml logs -f nginx
docker compose -f docker-compose.prod.yml logs -f postgres
docker compose -f docker-compose.prod.yml logs -f fail2ban

# Backend application log files (Winston)
docker compose -f docker-compose.prod.yml exec backend tail -f /var/log/tryon/combined-$(date +%Y-%m-%d).log

# View only errors
docker compose -f docker-compose.prod.yml exec backend tail -f /var/log/tryon/error-$(date +%Y-%m-%d).log

# View all log files
docker compose -f docker-compose.prod.yml exec backend ls -la /var/log/tryon/

# Access log volume directly on host
docker volume inspect www_backend_logs  # Find mount point
tail -f /var/lib/docker/volumes/www_backend_logs/_data/combined-*.log
```

### Log Management

Log files are automatically managed:
- **Daily rotation** - New file each day, prevents large files
- **14-day retention** - Combined logs auto-deleted after 14 days
- **30-day retention** - Error logs kept longer for debugging
- **Gzip compression** - Rotated logs are compressed

To manually clean old logs:
```bash
docker compose -f docker-compose.prod.yml exec backend find /var/log/tryon -name "*.log.gz" -mtime +30 -delete
```

### Request Tracing

All requests get a unique correlation ID (`x-correlation-id` header). Use this to trace a specific request through logs:

```bash
docker compose -f docker-compose.prod.yml exec backend grep "abc12345" /var/log/tryon/combined-$(date +%Y-%m-%d).log
```

### Resource Monitoring

```bash
docker stats
```

### CloudWatch Logs & Alarms

Container logs are shipped off-host to CloudWatch by the **Amazon CloudWatch Agent**
installed on the prod Lightsail box. This survives the VM dying — if the instance is
lost, the logs leading up to the failure are still in CloudWatch. Without this, the only
copy of recent logs is the `backend_logs` volume on the (now dead) host.

> **If the VM is ever rebuilt from a snapshot, this whole setup must be recreated** — the
> agent, its config, and the IAM user's credentials live on the host, not in the repo.
> This section is the recovery reference.

**What is shipped (prod):**

| Item | Value |
|---|---|
| Log group | `/tryon/host-containers` (all containers — backend, postgres, redis, nginx — in one group) |
| Log stream | `{instance_id}-{hostname}` (one combined stream for all containers — see foot-gun note below) |
| Source files | `/var/lib/docker/containers/*/*-json.log` (Docker's json-file driver) |
| Region | `us-east-1` |
| Agent run-as | `root` |

**Agent config** — canonical source is
`/opt/aws/amazon-cloudwatch-agent/etc/tryon-cwagent.json` (applied with
`fetch-config -c file:<that path> -s`, NOT from SSM). `fetch-config` copies it into
`…/amazon-cloudwatch-agent.d/file_tryon-cwagent.json`; the agent merges **every** `*.json`
in that `.d` dir, so there must be exactly **one** file there (see the duplicate-config
foot-gun below). Ships both logs and host metrics (mem + root disk):

```json
{
  "agent": { "metrics_collection_interval": 60, "run_as_user": "root" },
  "metrics": {
    "namespace": "CWAgent",
    "append_dimensions": { "InstanceId": "${aws:InstanceId}" },
    "aggregation_dimensions": [["InstanceId"]],
    "metrics_collected": {
      "mem":  { "measurement": ["mem_used_percent"] },
      "disk": { "measurement": ["disk_used_percent"], "resources": ["/"] }
    }
  },
  "logs": {
    "logs_collected": {
      "files": {
        "collect_list": [
          {
            "file_path": "/var/lib/docker/containers/*/*-json.log",
            "log_group_name": "/tryon/host-containers",
            "log_stream_name": "{instance_id}-{hostname}",
            "timezone": "UTC"
          }
        ]
      }
    }
  }
}
```

`aggregation_dimensions: [["InstanceId"]]` makes the agent also publish an InstanceId-only
rollup of each metric, which is the clean stream the host alarms target. Three custom
metrics result (`mem_used_percent`, `disk_used_percent` detailed, `disk_used_percent`
rolled-up) → with the 2 `TryOn` log-metric-filter metrics that's 5 custom metrics, inside
the always-free 10.

> **⚠️ Foot-gun — don't put `{file_basename}` (or any per-file token) in
> `log_stream_name`.** The agent does **not** support a per-file placeholder; an earlier
> config used `"{instance_id}-{hostname}-{file_basename}"` and the `{file_basename}` part
> shipped **literally** (a stream actually named `…ec2.internal-{file_basename}`). With all
> container files funnelled into that one mis-named stream, low-volume containers were
> dropped — **postgres logs never reached CloudWatch for ~30 days** while backend + nginx
> did. Fixed 2026-06-08 by switching to `"{instance_id}-{hostname}"` (a valid template) and
> re-running `fetch-config -s`; postgres immediately began shipping. All containers now
> share that one combined stream, which is fine because **metric filters are scoped to the
> log group, not a stream** (see Alarms below). The old broken stream remains until it ages
> out via the 30-day retention.
>
> **⚠️ Second foot-gun — exactly one config file in `.d`.** `fetch-config -c file:X` copies
> `X` into `.d/file_<basename(X)>.json`. If you point it at a file that already lives *in*
> `.d`, you get a second copy (e.g. `file_file_…json`) and the agent **merges both** →
> duplicate log shipping + duplicate metrics. Always keep the source **outside** `.d` (we
> use `…/etc/tryon-cwagent.json`). To reset cleanly:
> `sudo amazon-cloudwatch-agent-ctl -a remove-config -c all && sudo rm -f .../amazon-cloudwatch-agent.d/*.json`,
> then `fetch-config -c file:.../tryon-cwagent.json -s`, and confirm `.d` holds one file.

**Credentials / IAM:** the agent reads AWS creds from `/etc/aws/credentials` profile
`[AmazonCloudWatchAgent]` (pointed there by
`/opt/aws/amazon-cloudwatch-agent/etc/common-config.toml`). Those keys belong to the IAM
user **`tryon-log-shipper`** (account `165341015574`), which has **two least-privilege
inline policies**:
- `tryon-log-put-only` — `logs:CreateLogStream` / `PutLogEvents` / `DescribeLogStreams` on
  `arn:aws:logs:us-east-1:165341015574:log-group:/tryon/*` (note: no `CreateLogGroup`, so
  the `/tryon/*` groups must pre-exist).
- `tryon-metric-put-only` — `cloudwatch:PutMetricData` with a condition restricting it to
  `cloudwatch:namespace = CWAgent` (added 2026-06-08 to enable host metrics; without it the
  agent logs `AccessDenied: ... not authorized to perform: cloudwatch:PutMetricData`).

`/etc/aws/credentials` is root-only and **never committed**.

**Agent management commands:**

```bash
CTL=/opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl
sudo $CTL -a status                       # running? configured?
sudo $CTL -a fetch-config -m ec2 \
  -c file:/opt/aws/amazon-cloudwatch-agent/etc/tryon-cwagent.json -s   # re-apply config + restart
sudo $CTL -a stop ; sudo $CTL -a start    # bounce the agent
```

**Rebuild-from-scratch (after a snapshot restore):**

```bash
# 1. Install the agent
wget https://amazoncloudwatch-agent.s3.amazonaws.com/ubuntu/amd64/latest/amazon-cloudwatch-agent.deb
sudo dpkg -i -E ./amazon-cloudwatch-agent.deb
# 2. Restore creds (from your backup of /etc/aws/credentials — profile [AmazonCloudWatchAgent])
sudo mkdir -p /etc/aws && sudo nano /etc/aws/credentials
# 3. Point the agent at that profile
echo '[credentials]
shared_credential_file = "/etc/aws/credentials"
shared_credential_profile = "AmazonCloudWatchAgent"' | sudo tee /opt/aws/amazon-cloudwatch-agent/etc/common-config.toml
# 4. Write the config JSON above to /opt/aws/amazon-cloudwatch-agent/etc/tryon-cwagent.json
#    (NOT inside the .d dir), then: fetch-config -c file:.../tryon-cwagent.json -s (see above)
# 5. Re-add the IAM tryon-metric-put-only policy if the user was recreated (see Credentials/IAM)
```

> **⚠️ Do NOT route nginx to `/dev/stdout` to pull its logs into CloudWatch.** fail2ban
> reads nginx logs from the shared `nginx_logs` Docker volume; redirecting nginx to stdout
> empties those files and blinds every jail. If nginx logs are ever wanted in CloudWatch,
> add them *additively* (a sidecar tailing the volume). See the "Do NOT do" note in
> [TODOS.md](TODOS.md).

#### Alarms (live as of 2026-06-08)

Four CloudWatch alarms exist, all wired to the SNS topic `tryon-alerts`
(`arn:aws:sns:us-east-1:165341015574:tryon-alerts`):

| Alarm | Source metric | Fires when |
|---|---|---|
| `tryon-backend-error-rate` | filter `tryon-backend-errors` → `TryOn/BackendErrorCount` | Sum > 10 in 5 min |
| `tryon-postgres-fatal` | filter `tryon-postgres-fatal` → `TryOn/PostgresFatalCount` | Sum > 0 in 5 min |
| `tryon-prod-disk-high` | `CWAgent/disk_used_percent` (InstanceId rollup, `/`) | Avg > 85% in 5 min |
| `tryon-prod-memory-high` | `CWAgent/mem_used_percent` (InstanceId rollup) | Avg > 90% in 5 min |

> **⚠️ The SNS email subscription must be confirmed or no alert is delivered.** AWS emails
> `bruhn@bruhnfreeman.com` a confirmation link; until clicked the subscription shows
> `PendingConfirmation`. (Confirmed 2026-06-08.) Check with
> `aws sns list-subscriptions-by-topic --topic-arn arn:aws:sns:us-east-1:165341015574:tryon-alerts`.

**Separate notification path — Lightsail alarms.** The 6 Lightsail instance alarms
(`evofaceflow-{prod,dev}-{status-check-failed,cpu-high,burst-capacity-low}`) are **not**
CloudWatch alarms — they live in Lightsail and notify via the Lightsail **Email contact
method** (`get-contact-methods`, also requires email confirmation), not SNS. Manage them
with `aws lightsail get-alarms` / `put-alarm`. Lightsail instance metrics aren't in
CloudWatch, so these can't be combined with the CloudWatch alarms above.

**Dashboard.** `aws cloudwatch get-dashboard --dashboard-name TryOn-Prod` — host mem/disk +
app error/FATAL metrics + a CloudWatch-alarm status widget, one pane. (Lightsail CPU/burst
still viewed in the Lightsail console.)

**Important caveat — Docker double-encodes the logs.** The json-file driver wraps each
line as `{"log":"<your line, with quotes \\\"escaped\\\">","stream":...}`. So the inner
Winston JSON is *escaped* in the stored event, and structured metric-filter syntax
(`{ $.level = "error" }`) will **not** match — and an unquoted term containing a backslash
(e.g. `level\":\"error`) is rejected outright (`Invalid character(s) in term '\'`). The
working form is a **quoted term with the backslashes escaped**, validated against live logs
with `aws logs filter-log-events --filter-pattern '<pattern>'` before committing.

These are the exact commands used to create them (re-runnable; `put-*` is idempotent). Set
`MSYS_NO_PATHCONV=1` on git-bash so `/tryon/...` isn't mangled.

```bash
REGION=us-east-1
LOG_GROUP=/tryon/host-containers
SNS=arn:aws:sns:us-east-1:165341015574:tryon-alerts

# One-time: SNS topic + email (then CONFIRM via the link AWS emails you)
aws sns create-topic --name tryon-alerts --region $REGION
aws sns subscribe --topic-arn $SNS --protocol email \
  --notification-endpoint bruhn@bruhnfreeman.com --region $REGION

# (a) Backend error rate. Pattern = the Docker-escaped, quoted form (validated to match
#     real "level":"error" lines; bare 'error' is noisier).
aws logs put-metric-filter --region $REGION --log-group-name "$LOG_GROUP" \
  --filter-name tryon-backend-errors \
  --filter-pattern '"\\\"level\\\":\\\"error\\\""' \
  --metric-transformations metricName=BackendErrorCount,metricNamespace=TryOn,metricValue=1,defaultValue=0
aws cloudwatch put-metric-alarm --region $REGION --alarm-name tryon-backend-error-rate \
  --namespace TryOn --metric-name BackendErrorCount --statistic Sum \
  --period 300 --evaluation-periods 1 --threshold 10 \
  --comparison-operator GreaterThanThreshold --treat-missing-data notBreaching \
  --alarm-actions $SNS --ok-actions $SNS

# (b) Postgres FATAL (any occurrence). Plain term — valid as-is.
aws logs put-metric-filter --region $REGION --log-group-name "$LOG_GROUP" \
  --filter-name tryon-postgres-fatal \
  --filter-pattern 'FATAL' \
  --metric-transformations metricName=PostgresFatalCount,metricNamespace=TryOn,metricValue=1,defaultValue=0
aws cloudwatch put-metric-alarm --region $REGION --alarm-name tryon-postgres-fatal \
  --namespace TryOn --metric-name PostgresFatalCount --statistic Sum \
  --period 300 --evaluation-periods 1 --threshold 0 \
  --comparison-operator GreaterThanThreshold --treat-missing-data notBreaching \
  --alarm-actions $SNS --ok-actions $SNS

# Verify
aws cloudwatch describe-alarms --region $REGION \
  --alarm-names tryon-backend-error-rate tryon-postgres-fatal \
  --query 'MetricAlarms[].{name:AlarmName,state:StateValue}' --output table
```

> The `FATAL` filter watches the whole combined group, so a FATAL from any container
> trips it (incl. transient client-auth / "could not receive data" FATALs) — acceptable for
> a coarse "look at postgres" page; tighten later if noisy. For backend error-rate, set the
> threshold from your real baseline once you've watched the metric for a few days.
> `tryon-postgres-fatal` shows `INSUFFICIENT_DATA` until the first log event flows through
> its filter — `notBreaching` means that state never pages.

### Sentry (error tracking)

The backend ships with a **Sentry** (`@sentry/node`) integration for exception/crash
reporting — stack traces, breadcrumbs, release tagging. It complements CloudWatch (which is
metrics + raw logs): Sentry groups distinct *errors* and tells you which line threw, for how
many users. **The whole thing is gated on `SENTRY_DSN`** — with that env var unset (the
current state on both prod and dev) the SDK is a no-op, so the code can ship dark and be
switched on later with zero redeploy logic.

**Turn it on for an environment (no code change):**

1. Create a project at <https://sentry.io> (free tier is plenty at this scale): **Create
   Project → Platform: Node.js → Express**. Copy the **DSN** (Settings → Projects → *project*
   → Client Keys (DSN)).
2. Add it to that box's `backend/.env` and set the environment tag (NODE_ENV is `production`
   on **both** boxes, so this is how you tell them apart in Sentry):
   ```bash
   # dev box: /opt/evofaceflow/TryOn/backend/.env
   SENTRY_DSN="https://<key>@<org>.ingest.sentry.io/<projectId>"
   SENTRY_ENVIRONMENT="development"   # use "production" on the prod box
   # optional: SENTRY_RELEASE, SENTRY_TRACES_SAMPLE_RATE (default 0 = errors only)
   ```
   Both compose files pass `backend/.env` through via `env_file`, so **do not** add
   `SENTRY_*` to the compose `environment:` block (that would override the file with empty
   shell values).
3. Recreate the backend so it re-reads `.env`:
   ```bash
   docker compose -f docker-compose.dev.yml up -d backend   # dev
   ```
4. Confirm: the backend logs `[sentry] initialized (environment=…)` at boot, and the admin
   dashboard's **🩺 Diagnostics → Sentry** card shows `ENABLED`. Click **Send test event**
   and confirm it lands in the Sentry UI.

**Optional — "recent issues" panel on the dashboard.** To list unresolved issues inline (and
deep-link to the project), also set an org auth token (Sentry → Settings → Auth Tokens, scopes
`project:read` + `event:read`) and the slugs:
```bash
SENTRY_AUTH_TOKEN="sntrys_…"
SENTRY_ORG_SLUG="your-org"
SENTRY_PROJECT_SLUG="tryon-backend"
```
Without these the dashboard still shows config status and the test button — just no inline
issue feed (the `/api/admin/sentry/issues` endpoint returns 503, which the UI renders as a
setup hint).

**Privacy:** `sendDefaultPii:false` plus a `beforeSend` scrubber ([backend/src/utils/scrub.ts])
strip auth headers (incl. `x-admin-key`), cookies, sensitive body fields, and the user's
email/IP before any event leaves the box. Keep that scrubber's `SENSITIVE_KEY` list current.

## 10. Database Backup

Backups are **nightly, automated, and off-host**. A cron job on the Lightsail host streams a `pg_dump` from the postgres container directly to S3 (`s3://evofaceflow-backups/postgres/`) without writing any unencrypted dump to local disk. Backups are immutable from the backup user (write-only IAM scope) and survive any disk failure on the VM.

### 10.1 What's running

| Component | Location | Purpose |
|---|---|---|
| `/usr/local/bin/backup-postgres.sh` | Lightsail host | The backup script — sourced from `/etc/tryon-backup.env`, streams `pg_dump` \| `gzip` \| `aws s3 cp` |
| `/etc/tryon-backup.env` | Lightsail host (root-only, `chmod 600`) | AWS credentials + Postgres connection details. NEVER committed. |
| `/etc/logrotate.d/tryon-backup` | Lightsail host | Weekly rotation of `/var/log/tryon-backup.log`, 8-week retention, gzipped |
| Root crontab entry | Lightsail host | `0 2 * * * /usr/local/bin/backup-postgres.sh >> /var/log/tryon-backup.log 2>&1` — runs daily at 02:00 UTC |
| `evofaceflow-backups` S3 bucket | AWS S3 (us-east-1) | Destination. Versioning enabled. Lifecycle: Glacier IR after 30 days, expire after 365 days. |
| IAM user `tryon-backup-uploader` | AWS IAM | Long-lived access keys used by the script. Inline policy allows `s3:PutObject` + `s3:AbortMultipartUpload` on `evofaceflow-backups/postgres/*` and `s3:ListBucketMultipartUploads` on the bucket. **No** read, no delete on completed objects. |

The script uses `set -euo pipefail`, so any stage failure (container down, pg_dump error, network failure, upload reject) aborts the run with a non-zero exit code. Output goes to `/var/log/tryon-backup.log`.

### 10.2 Verify it's working

After-the-fact health check (run any time):

```bash
# Last 20 backup runs from the log
sudo tail -20 /var/log/tryon-backup.log

# List the last 7 days of dumps in S3 (requires read-capable AWS principal — not the backup user)
aws s3 ls s3://evofaceflow-backups/postgres/ --human-readable | tail -7
```

A healthy log line pair looks like:
```
[2026-05-12T02:00:01Z] backup start: postgres/20260512T020001Z.sql.gz
[2026-05-12T02:00:03Z] backup ok: s3://evofaceflow-backups/postgres/20260512T020001Z.sql.gz
```

If a run fails, the script exits non-zero and the corresponding line will read `backup start: ...` with no matching `backup ok:`. Cron does not email on failure unless you set `MAILTO` in the crontab.

### 10.3 Initial setup (one-time, if rebuilding the host)

> If the Lightsail host already has `/usr/local/bin/backup-postgres.sh` installed, skip this section. Steps below are only for fresh installs or recovery after a host rebuild.

**Step A — AWS resources (run once, in the AWS console):**

1. Create S3 bucket `evofaceflow-backups` in the same region as `evofaceflow-uploads`. Enable **Bucket Versioning**. Add a lifecycle rule transitioning current versions to Glacier Instant Retrieval after 30 days and expiring them after 365 days.
2. Create IAM user `tryon-backup-uploader` (no console access). Attach an inline policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "PutBackups",
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:AbortMultipartUpload"],
      "Resource": "arn:aws:s3:::evofaceflow-backups/postgres/*"
    },
    {
      "Sid": "ListMultipartsInBucket",
      "Effect": "Allow",
      "Action": "s3:ListBucketMultipartUploads",
      "Resource": "arn:aws:s3:::evofaceflow-backups"
    }
  ]
}
```

3. Generate an access key for the user and save both halves somewhere safe.

**Step B — host setup (on the Lightsail VM):**

```bash
sudo apt-get update && sudo apt-get install -y awscli

# Credentials and config (root-only, exported so child processes inherit them)
sudo tee /etc/tryon-backup.env > /dev/null <<'EOF'
export AWS_ACCESS_KEY_ID=<paste-from-step-A3>
export AWS_SECRET_ACCESS_KEY=<paste-from-step-A3>
export AWS_DEFAULT_REGION=us-east-1
export PG_USER=tryon_prod
export PG_DB=tryon_db
export S3_BUCKET=evofaceflow-backups
export PROJECT_DIR=/opt/evofaceflow/TryOn
export COMPOSE_FILE=docker-compose.prod.yml
EOF
sudo chmod 600 /etc/tryon-backup.env
sudo chown root:root /etc/tryon-backup.env
```

> **`export` is required**, not optional. `source`d shell variables without `export` are not inherited by the `aws` subprocess; CLI then falls back to the Lightsail instance role and fails with `AccessDenied`.

Install the backup script:

```bash
sudo tee /usr/local/bin/backup-postgres.sh > /dev/null <<'SCRIPT'
#!/usr/bin/env bash
# Nightly Postgres -> S3 backup for TryOn.
set -euo pipefail
# shellcheck disable=SC1091
source /etc/tryon-backup.env

TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
S3_KEY="postgres/${TIMESTAMP}.sql.gz"
HOSTNAME_TAG="$(hostname -s)"

cd "$PROJECT_DIR"

echo "[$(date -u +%FT%TZ)] backup start: $S3_KEY"

docker compose -f "$COMPOSE_FILE" exec -T postgres \
  pg_dump -U "$PG_USER" -d "$PG_DB" --no-owner --clean --if-exists \
  | gzip -9 \
  | aws s3 cp - "s3://${S3_BUCKET}/${S3_KEY}" \
      --expected-size 1073741824 \
      --metadata "host=${HOSTNAME_TAG},timestamp=${TIMESTAMP}" \
      --no-progress

echo "[$(date -u +%FT%TZ)] backup ok: s3://${S3_BUCKET}/${S3_KEY}"
SCRIPT

sudo chmod +x /usr/local/bin/backup-postgres.sh
sudo chown root:root /usr/local/bin/backup-postgres.sh
```

Test once by hand, then install cron + logrotate:

```bash
sudo /usr/local/bin/backup-postgres.sh

# Cron: nightly at 02:00 UTC, log to its own file
sudo crontab -e
# Add:
#   MAILTO=""
#   0 2 * * * /usr/local/bin/backup-postgres.sh >> /var/log/tryon-backup.log 2>&1

# Log rotation
sudo tee /etc/logrotate.d/tryon-backup > /dev/null <<'EOF'
/var/log/tryon-backup.log {
    weekly
    rotate 8
    compress
    delaycompress
    missingok
    notifempty
    create 644 root root
}
EOF
```

### 10.4 Restore from a backup

> **Test this procedure at least once on a dev instance** before you ever need it in production. An untested backup is a hope, not a backup.
>
> ✅ **Validated on dev 2026-06-07.** The latest S3 dump restored cleanly onto the dev
> stack (`docker-compose.dev.yml`, DB `tryon_db`/user `tryon_dev`) with **0 errors** — the
> `--no-owner` dump restores fine under a different role. The dump predated the most recent
> prod deploy, so step 5 (`prisma migrate deploy`) correctly applied the 2 then-pending
> migrations afterward. Take a safety dump of the target first (see §10.5) so the test is
> reversible.

```bash
# 1. Download the dump (use your normal admin AWS credentials, NOT tryon-backup-uploader
#    — that user has no read permission)
aws s3 cp s3://evofaceflow-backups/postgres/20260512T020001Z.sql.gz ./restore.sql.gz

# 2. Verify the file looks reasonable (size, gzip integrity)
ls -lh restore.sql.gz
gunzip -t restore.sql.gz && echo "gzip OK"

# 3. (PRODUCTION ONLY — irreversible) Stop the backend so no writes happen during restore
cd /opt/evofaceflow/TryOn
docker compose -f docker-compose.prod.yml stop backend

# 4. Restore. The dump uses --clean --if-exists, so it drops and recreates objects.
gunzip -c restore.sql.gz | \
  docker compose -f docker-compose.prod.yml exec -T postgres \
  psql -U tryon_prod -d tryon_db

# 5. Apply any newer Prisma migrations (only relevant if the dump pre-dates a migration)
docker compose -f docker-compose.prod.yml run --rm backend npx prisma migrate deploy

# 6. Start the backend
docker compose -f docker-compose.prod.yml start backend

# 7. Smoke-test
curl https://api.tryon-mirror.ai/health
```

### 10.5 Ad-hoc / pre-migration manual dump

For one-off safety dumps (e.g. immediately before a risky migration), bypass S3 and just write to local disk:

```bash
docker compose -f docker-compose.prod.yml exec postgres \
  pg_dump -U tryon_prod tryon_db > backup_$(date +%Y%m%d_%H%M%S).sql
```

Keep these local files for the duration of the migration only — they contain unencrypted user data and should be deleted (or moved to S3) afterwards.

## 11. Backups, Snapshots & Disaster Recovery

The production stack is protected at three independent layers. Each survives different failure modes; together they cover everything from a fat-fingered `DELETE` to a total VM loss.

| Layer | Granularity | Cadence | Restore time | What it survives |
|---|---|---|---|---|
| Lightsail automatic snapshots | Whole-VM (disk + state) | Daily (configured in Lightsail console) | ~10 min to spin a new instance from snapshot | VM corruption, accidental host-level rm, disk failure |
| S3 versioning + lifecycle on `evofaceflow-uploads` | Object-level (per-photo) | Per-write (automatic) | Seconds — restore the prior version in the S3 console | Accidental overwrite or delete of user photos. 30-day undo window via lifecycle rule expiring noncurrent versions. |
| Off-host Postgres dumps to `evofaceflow-backups` | Database snapshot | Daily (02:00 UTC) | Minutes — see §10.4 | Total VM loss, DB corruption, dropped tables. 365-day retention. |

### 11.1 Lightsail automatic snapshots

Enabled in the AWS Lightsail console (Instances → instance → **Snapshots** tab → **Enable automatic snapshots**). Lightsail keeps the seven most recent automatic snapshots by default; older ones roll off. Manual snapshots can be taken before a risky migration and are retained until explicitly deleted.

To restore from a snapshot: Lightsail console → Snapshots → **Create new instance from snapshot**. The new instance gets a new public IP, so DNS for `evofaceflow.com` and `api.tryon-mirror.ai` must be repointed (or the static IP detached from the old instance and reattached to the new one).

### 11.2 S3 versioning on `evofaceflow-uploads`

Enabled in the S3 console with a lifecycle rule that permanently deletes noncurrent object versions after 30 days. Recovering an overwritten or deleted photo:

1. AWS Console → S3 → `evofaceflow-uploads` → toggle **Show versions** (top-right).
2. Locate the object's prior version; either copy it to a new key or delete the current (delete-marker) version to expose the old one.
3. If the object was deleted entirely, look for a delete marker on the key — removing the delete marker restores the most recent non-deleted version.

### 11.3 Postgres dumps to S3

Covered in detail in §10. The script is idempotent (writes a uniquely timestamped object per run) and immutable from the backup user (no overwrite, no delete).

### 11.4 DNS & nameservers (registrar record + rollback)

- **Registrar:** Amazon Registrar, Inc. (managed in AWS Console → **Route 53 → Registered domains → evofaceflow.com**). Auto-renew on.
- **Authoritative DNS:** historically the Route 53 hosted zone `Z0957115TEZKWSUXKD1W`. The domain is being moved behind **Cloudflare** (free plan) for CDN/WAF/DDoS — Cloudflare's free tier requires delegating the **whole zone's nameservers**, so the cutover affects the entire domain (prod `api`/`www`/apex + email). All records are replicated into Cloudflare as an exact **grey (DNS-only)** mirror first, so resolution is identical until records are deliberately proxied (orange).
- **Nameservers to set at the registrar (Cloudflare):**
  - `daniella.ns.cloudflare.com`
  - `rommy.ns.cloudflare.com`
- **🔙 Original AWS nameservers — ROLLBACK RECORD** (set these four back in Route 53 → Registered domains → *Edit name servers* to revert to Route 53 DNS; the Route 53 hosted zone still holds the full record set as a live backup):
  - `ns-1092.awsdns-08.org`
  - `ns-1606.awsdns-08.co.uk`
  - `ns-278.awsdns-34.com`
  - `ns-791.awsdns-34.net`

> **Note:** changing nameservers is the one prod-DNS cutover — make it deliberately. Because Cloudflare starts as an exact grey mirror, the switch is seamless (same answers either way). Email records (MX, SPF, `_dmarc`, the SES DKIM CNAMEs, `default._domainkey`, `bounce`, `mail`, `autodiscover`) must **always stay DNS-only (grey)** — never proxy them.

**Status (2026-06-11): PROD CUTOVER COMPLETE.** `api`, `www`, and the apex are **Proxied (orange)**; all email records remain grey. Real-IP validated through the edge (nginx logs true client addresses), `/admin` allowlist verified working through the proxy — note the allowlist needed the admin's **IPv6 /64** added (behind Cloudflare the connection arrives over IPv6 with privacy-extension rotation; IPv4-only allowlisting 403s). Full functional test pass ran clean through the edge same day. Rollback: set the three web records back to grey (DNS-only) — origin unchanged. Watch item: the next Let's Encrypt renewal (~30 days before expiry) is the first through the proxy — dev has renewed-through-CF precedent, but confirm the certbot renewal email doesn't fire.

#### Enabling Cloudflare protection on prod (the cutover — do at/after launch)

This exact sequence was validated on dev (`api-dev`). The real-IP block is already in `nginx/nginx.conf` (committed, not yet deployed to prod).

1. **Deploy the real-IP nginx config to prod FIRST.** On the prod box: `git pull` → `docker compose -f docker-compose.prod.yml up -d --force-recreate nginx` (single-file mount → **must force-recreate**, a reload won't pick it up). This is **safe while records are grey** — `real_ip` only triggers for traffic arriving from a Cloudflare range, of which there is none yet — but it **MUST be live before step 2**, or the `/admin` IP-allowlist would see Cloudflare's IPs and lock you out. Verify: `docker compose -f docker-compose.prod.yml exec nginx grep -c set_real_ip_from /etc/nginx/nginx.conf` → **22**.
2. **Orange-cloud the prod web records** in Cloudflare — set `api`, `www`, and the apex `evofaceflow.com` to **Proxied**. Leave **all email records grey** (MX, SPF, `_dmarc`, `*._domainkey`, `bounce`, `mail`, `autodiscover`).
3. **Validate:** `curl -sI https://api.tryon-mirror.ai/health` should show `server: cloudflare` + a `cf-ray` header + `200`; prod nginx logs (`docker compose -f docker-compose.prod.yml logs nginx`) should show **real client IPs**, not Cloudflare IPs; confirm `/admin` still reaches you (real-IP makes the allowlist match through Cloudflare). To roll back the edge instantly, set the three web records back to **grey** — DNS still resolves to the same origin.

## 12. External Monitoring

### 12.1 UptimeRobot

A free UptimeRobot account monitors `https://api.tryon-mirror.ai/health` every 5 minutes with a 30-second timeout. Alerts go to the configured email contact when the monitor records ≥2 consecutive failures (~10 minutes total downtime before paging).

This is intentionally **external** — it probes from outside AWS so it catches outages that the application itself can't report (network partitions, Lightsail VM down, nginx misconfig, DNS failure, expired SSL handshake).

> The `/health` endpoint runs a deep check — it probes Postgres (`SELECT 1`) and Redis (`PING`) in parallel (2s timeout each) and returns `503` with per-dependency status when either is down, `200 {status:"ok"}` when both are up. A separate shallow, dependency-free `/health/live` backs the Docker liveness probe so a transient dependency blip can't make Docker kill a healthy backend. The UptimeRobot monitor watches `/health`, so it reports dependency outages, not just a dead process.

### 12.2 SSL certificate expiry (deferred)

UptimeRobot's SSL expiry monitoring is a paid feature on their newer plans. For now, expiry alerting falls back to:

1. **Let's Encrypt's own renewal-failure emails** to the address registered with certbot (fires only if auto-renewal breaks).
2. **UptimeRobot's HTTPS check** itself — when a cert expires, the monitor goes red immediately because the TLS handshake fails. Not preemptive, but it does fire.

A preemptive SSL expiry check is planned via the existing vulnerability scanner — `VulnerabilityReport.scanType` already reserves a `SSL_CERTIFICATE` enum value (see `backend/prisma/schema.prisma`). Implementing the worker handler will surface days-remaining in the admin dashboard with no third-party service.

## 13. Updating the Application

### Backend (server-side)

Deploys are **manual**. A `.github/workflows/deploy.yml` is occasionally referenced in older notes but **is not present in the repo** and no auto-deploy is configured. To deploy:

```bash
cd /opt/evofaceflow/TryOn
git pull origin main
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml exec backend npx prisma migrate deploy
```

Use `up -d` (without `--build`) for env-var-only changes — `restart` does **not** re-read `.env` reliably with all Compose versions.

> **⚠️ ONE-TIME (git history was rewritten 2026-06-03):** the repo history was rewritten to strip an unwanted commit trailer, so every commit hash changed. The first time you deploy after that date, a plain `git pull` will fail with a "divergent branches" / "refusing to merge unrelated histories" error because the server's local clone still has the old hashes. Resolve it once with a hard reset to the rewritten remote, then continue the normal deploy:
> ```bash
> cd /opt/evofaceflow/TryOn
> git fetch origin
> git reset --hard origin/main        # use origin/develop on the dev server
> docker compose -f docker-compose.prod.yml up -d --build
> docker compose -f docker-compose.prod.yml exec backend npx prisma migrate deploy
> ```
> `git reset --hard` only updates the checked-out files to match the remote — it does **not** disturb the running containers (those keep serving the already-built image until the `up --build` above rebuilds them). A full backup bundle of the pre-rewrite history exists at `E:\Projects\TryOn\tryon-backup-pre-rewrite.bundle` on the dev machine. Once **both** the production and dev servers have been reset this way, this note can be deleted.

### Frontend (mobile app)

The mobile app is **not** deployed to Lightsail. It's compiled into iOS / Android binaries via EAS Build (Expo's cloud build service) and distributed through TestFlight / App Store.

```powershell
# All commands run on your LOCAL dev machine, not Lightsail.
cd frontend
npm install                                    # if dependencies changed
npx expo prebuild --clean                      # if native deps changed (e.g. new expo-* package)
eas build --platform ios --profile preview     # for TestFlight / internal QA
eas build --platform ios --profile production  # for App Store submission
eas submit --platform ios --profile production --latest  # upload to App Store Connect
```

#### EAS profiles (`frontend/eas.json`)

| Profile | Use case | Notes |
|---|---|---|
| `development` | Dev Client install for hot-reload iteration on a phone | `developmentClient: true`, `distribution: "internal"` |
| `preview` | TestFlight / internal QA builds | Production-mode JS, internal distribution. No build-number burn. |
| `production` | App Store submission | Auto-increments build number. |

`eas build --platform ios` with no `--profile` flag defaults to `production` — explicit profile is recommended.

### Connecting the frontend to Lightsail

Always set `ENV = 'prod'` in `frontend/src/config/api.ts` before any production `eas build`. The `ENV` selector (`'local' | 'dev' | 'prod'`) picks the backend: `'prod'` → `https://api.tryon-mirror.ai/api`, `'dev'` → `https://api-dev.tryon-mirror.ai/api`, `'local'` → your dev URL. A dev build with `ENV !== 'prod'` logs a `console.warn` reminder; never ship a non-`prod` value to the App Store.

## 14. Rollback Procedure

If deployment fails:

```bash
# Check which version is running
git log --oneline -5

# Rollback to previous commit
git checkout <previous-commit-hash>

# Rebuild and restart
docker compose -f docker-compose.prod.yml up -d --build
```

## 15. Local vs Live Development

The frontend can connect to a local backend, the dev Lightsail server, or the live (production) Lightsail server.

### Configuration

Edit `frontend/src/config/api.ts` — the `ENV` constant is a 3-way switch:

```typescript
// 'local' | 'dev' | 'prod' — picks which backend the app talks to.
const ENV = 'prod' as ApiEnv;

const LOCAL_URL = 'http://localhost:3000/api';
const DEV_URL   = 'https://api-dev.tryon-mirror.ai/api';   // dev Lightsail server
const LIVE_URL  = 'https://api.tryon-mirror.ai/api';        // production
```

A dev build with `ENV !== 'prod'` logs a `console.warn` reminder. See §16 for the dev server itself.

### Local Development

1. Set `ENV = 'local'` in `frontend/src/config/api.ts`
2. Start backend locally:
   ```bash
   cd backend
   npm run dev
   ```
3. Start frontend:
   ```bash
   cd frontend
   npx expo start
   ```

### Testing Against the Dev or Live Server

1. Set `ENV = 'dev'` (dev Lightsail server) or `ENV = 'prod'` (production) in `frontend/src/config/api.ts`. Use `'dev'` for testing changes; `'prod'` only when validating against production.
2. Start the metro bundler with tunnel (so a physical device can reach it):
   ```bash
   cd frontend
   npx expo start --tunnel
   ```
3. Open the **dev client** app on your device (NOT Expo Go) and scan the QR code or pick the project from "Recently opened".
4. The backend is already running on Lightsail — no local backend needed.

> **🚨 Expo Go does NOT work for this app.** The app depends on native modules outside Expo Go's fixed module set (`expo-iap`, `expo-secure-store`, etc.). Launching in Expo Go fails at startup with `Cannot find native module 'ExpoIap'`. **Every device-testing flow requires a dev client build** — either a simulator/emulator build via `npx expo run:ios` / `npx expo run:android`, or an installed dev-client app via `eas build --profile development`. Once the dev client is installed, JS still hot-reloads from `npx expo start` like normal; only native dependency changes require a rebuild.

### Pre-Commit Checklist

Before committing changes:
- Ensure `ENV = 'prod'` in `frontend/src/config/api.ts`
- This ensures production builds always use the live server (a stray `'dev'`/`'local'` value shipped to the App Store would point real users at the wrong backend)

## 16. Dev Server Setup

A parallel **dev** environment on a separate Lightsail instance lets you test backend changes, schema migrations, and Sandbox in-app purchases without touching production data or the live App Store app. It mirrors the production stack via `docker-compose.dev.yml` + `nginx/nginx.dev.conf`, served at `https://api-dev.tryon-mirror.ai`.

**Branch model:** the dev server tracks the **`develop`** branch (production tracks `main`). Deploys are manual, same as prod.

**What makes it isolated from prod:**

| Resource | Production | Dev |
|---|---|---|
| Server | prod Lightsail | separate dev Lightsail |
| Compose file | `docker-compose.prod.yml` | `docker-compose.dev.yml` |
| Domain / cert | `api.tryon-mirror.ai` | `api-dev.tryon-mirror.ai` |
| Database / Redis | prod volumes | dev volumes (separate VM) |
| S3 bucket | `evofaceflow-uploads` | `evofaceflow-uploads-dev` |
| Apple env | `APPLE_ENVIRONMENT=Production` | `APPLE_ENVIRONMENT=Sandbox` |
| JWT / admin secrets | prod values | **separate** values |

> **Apple IAP note:** there is **no** second App Store app or bundle ID. StoreKit routes any non–App-Store build (Expo dev client / TestFlight) through **Sandbox** automatically, and App Store Connect supports two Server Notification URLs — point the **Sandbox** URL at the dev server and leave **Production** on the live server.

### 16.1 Provision (AWS / DNS console)

1. Create the dev Lightsail instance (Ubuntu 22.04) and attach a **static IP**.
2. Add a DNS **A record**: `api-dev.tryon-mirror.ai` → the dev static IP.
3. Create the `evofaceflow-uploads-dev` S3 bucket with the same hardening as prod: **Block Public Access ON**, **versioning ON**, lifecycle rule expiring noncurrent versions after 30 days. Grant the existing IAM user access to it.

### 16.2 Base setup (SSH)

```bash
ssh ubuntu@<dev-static-ip>
# Docker + Compose + certbot (same as §1)
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker ubuntu
sudo apt install -y docker-compose-plugin certbot
exit   # log out/in so the docker group applies

# Add swap BEFORE the first build — see §1 "Configure swap space".
# The dev box is typically a small plan; without swap the tsc build hangs.
# ssh back in, then:
#   sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
#   sudo mkswap /swapfile && sudo swapon /swapfile
#   echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

ssh ubuntu@<dev-static-ip>
sudo mkdir -p /opt/evofaceflow && sudo chown ubuntu:ubuntu /opt/evofaceflow
cd /opt/evofaceflow
# Private repo — set up a read-only deploy key first (see §2 "Clone Repository")
git clone git@github.com:bruhnf/TryOn.git
cd TryOn
git checkout develop        # ← dev server tracks develop, NOT main
```

### 16.3 TLS cert — before bringing up nginx (SSH)

`nginx.dev.conf` references `/etc/letsencrypt/live/api-dev.tryon-mirror.ai/`, so the cert must exist **before** nginx starts or the container won't boot. With nothing yet bound to port 80, use the standalone method (wait until the Phase 16.1 DNS record has propagated):

```bash
sudo certbot certonly --standalone -d api-dev.tryon-mirror.ai
```

### 16.4 Dev `.env` files (SSH)

Create both files (NOT committed — back them up; they're the only copy of their secrets):

```bash
cd /opt/evofaceflow/TryOn
cp .env.example .env                  # root: POSTGRES_USER/PASSWORD/DB (fresh dev values)
cp backend/.env.example backend/.env  # then edit backend/.env
```

Values that **must** differ from prod:
- `APPLE_ENVIRONMENT=Sandbox` ← the linchpin
- `AWS_S3_BUCKET=evofaceflow-uploads-dev`
- Fresh `JWT_SECRET`, `JWT_REFRESH_SECRET`, `ADMIN_API_KEY` (`openssl rand -hex 32` each) — so dev tokens can never authenticate against prod
- `ALLOWED_ORIGINS` / `APP_URL` → dev equivalents

Reuse from prod: `GROK_API_KEY` and AWS creds.

**Apple root CAs** need no action — the three `.cer` files in `backend/certs/apple/` are committed to the repo, so they arrived with your `git clone` and the Dockerfile's `COPY certs ./certs` bakes them into the image. Verify only:

```bash
ls backend/certs/apple/      # AppleIncRootCertificate.cer, AppleRootCA-G2.cer, AppleRootCA-G3.cer
```

**The App Store Server API `.p8` key** is gitignored, so it is NOT in the repo and must be hand-carried. It powers only the admin "Refresh from Apple" button — Sandbox webhooks and receipt verification work without it. It must live in `backend/certs/` (not `secrets/`) so the same `COPY certs ./certs` step bakes it in. Copy it from your dev machine **before** the §16.5 build:

```powershell
# From the repo root on your local (Windows) machine:
scp .\backend\certs\AuthKey_<KEYID>.p8 ubuntu@<dev-static-ip>:/opt/evofaceflow/TryOn/backend/certs/
```

Then set in the dev server's `backend/.env` (path is relative to the container's `/app` WORKDIR; the same `.p8` works for both Sandbox and Production):

```bash
APPLE_API_KEY_PATH=certs/AuthKey_<KEYID>.p8
APPLE_API_KEY_ID=<KEYID>
APPLE_API_KEY_ISSUER_ID=<issuer UUID from App Store Connect → Users and Access → Integrations>
```

Verify it reached the container after §16.5's build:

```bash
docker compose -f docker-compose.dev.yml exec backend ls certs/   # lists AuthKey_<KEYID>.p8 + apple/
```

### 16.5 Bring it up + migrate (SSH)

```bash
docker compose -f docker-compose.dev.yml up -d --build
docker compose -f docker-compose.dev.yml exec backend npx prisma migrate deploy
curl https://api-dev.tryon-mirror.ai/health     # expect 200 with a valid cert
```

Because the dev DB starts empty, you can freely drop and recreate it while testing migrations.

### 16.6 Wire Apple Sandbox (App Store Connect console)

1. App Store Connect → your app → **App Store Server Notifications** → set the **Sandbox** URL to `https://api-dev.tryon-mirror.ai/api/webhooks/apple` (leave the **Production** URL on `api.tryon-mirror.ai`).
2. **Users and Access → Sandbox → Testers** → create a sandbox tester Apple ID for $0 test purchases.

### 16.7 Point a dev-client build at it (local)

Set `ENV = 'dev'` in `frontend/src/config/api.ts` (see §15), build a dev client (`eas build --profile development`), install it, and verify end-to-end — including a Sandbox purchase. **Set `ENV = 'prod'` again before any production build.**

### 16.8 Ongoing dev deploys

```bash
ssh ubuntu@<dev-static-ip>
cd /opt/evofaceflow/TryOn
git pull                                            # develop
docker compose -f docker-compose.dev.yml up -d --build
docker compose -f docker-compose.dev.yml exec backend npx prisma migrate deploy
```

## Troubleshooting

### Backend won't start

```bash
docker compose -f docker-compose.prod.yml logs backend
```

Common issues:
- Missing environment variables in backend/.env
- Database not ready (wait for postgres healthcheck)
- Prisma schema out of sync (run migrations)

### SSL certificate issues

```bash
# Check certificate status
sudo certbot certificates

# Force renewal
sudo certbot renew --force-renewal
```

### Database connection issues

```bash
# Check postgres is running
docker compose -f docker-compose.prod.yml exec postgres pg_isready

# Connect to database
docker compose -f docker-compose.prod.yml exec postgres psql -U tryon_prod tryon_db
```

### Out of memory

**Most common symptom:** a deploy hangs for minutes at the `npm run build` / `tsc` step with no output. That's almost always RAM exhaustion during the TypeScript compile, not a broken build.

- **First fix — add swap.** If `free -h` shows `Swap: 0B`, follow [§1 → Configure swap space](#1-initial-server-setup). A 2 GB swapfile lets `tsc` finish on a small instance. This resolved a hung dev-server build.
- Build with less contention: `docker compose -f <file> build backend` first (nothing else competing), then `up -d`.
- Upgrade to a 1 GB+ instance.
- Reduce Redis `maxmemory` (currently 256mb in the compose `command:`).
- Set `NODE_OPTIONS="--max-old-space-size=384"` in backend env.

---

## 17. Tier A-Lean HA build & migration runbook (⏳ PLANNED — not yet executed)

> **Status: future-readiness plan, NOT done.** This turns the single-box prod
> stack (one 2GB box running Postgres+Redis+backend+nginx in one AZ = the SPOF)
> into a **highly-available** setup for ~**$79/mo**. See TODOS.md §9 for the
> strategy/why. **Provisions paid resources (managed DB, LB) and migrates LIVE
> prod data — rehearse the whole thing on the DEV box first, and do the prod DB
> cutover in a scheduled window with rollback ready.** Region: `us-east-1`.
>
> **Target (Tier A-Lean):** 1× Lightsail Managed DB Postgres HA (`micro_ha_2_0`,
> 1GB, $30) · 1× dedicated Redis instance ($7) · 2× app instances (`small_3_0`,
> 2GB, $12 ea) across AZs 1a+1b · 1× Lightsail Load Balancer ($18). The LB also
> **solves zero-downtime deploys for free** (roll instances one at a time — no
> nginx blue/green hack needed).

### Phase 0 — Prerequisites & app-statelessness (do these BEFORE provisioning)
The app must be stateless to run on 2+ instances. Audit:
- ✅ **Auth** is JWT (stateless) — no sticky sessions needed.
- ✅ **Uploads** go straight to S3 (multer-s3) — no local disk state.
- ✅ **Splash/announcement image** — DONE (2026-06-17): moved from the per-instance
  `SPLASH_DIR` file to a SINGLETON S3 object (`splash/` prefix), so it's
  consistent across instances. See `services/splashService.ts`. (`SPLASH_DIR` env
  is now deprecated/unused.)
- ✅ **BullMQ workers / `WORKER_ENABLED`** — DONE (2026-06-17): workers + schedulers
  start only when `env.workerEnabled` (default true; `index.ts` startWorkers via
  gated dynamic import; `vulnerabilityWorker` self-guards since admin.ts imports
  it). Set `WORKER_ENABLED=false` in an API-only node's `./backend/.env` so it
  serves traffic but doesn't process jobs. (BullMQ already prevents double-
  processing across workers; the flag controls total worker/Grok concurrency.)
- ⚠️ **fail2ban** is per-instance and reads that box's nginx logs; with the LB in
  front, the real client IP arrives via `X-Forwarded-For`, and bans are
  per-instance. Edge protection should shift to **Cloudflare WAF/rate-limiting**
  in the multi-instance world (fail2ban stays as per-box defense-in-depth).
- Decide AZs (`us-east-1a` + `us-east-1b`) and confirm the ~$79/mo budget.

### Phase 1 — Externalize Redis (decouple the queue from the app box)
1. Create a small instance for Redis (cheapest that fits; 1GB is plenty):
   `aws lightsail create-instances --instance-names tryon-redis --availability-zone us-east-1a --blueprint-id ubuntu_22_04 --bundle-id micro_3_0 --region us-east-1`
2. Install Docker; run Redis (`redis:7-alpine`, `--appendonly yes --maxmemory 256mb --maxmemory-policy noeviction`), bound to the instance's **private** IP only.
3. Lightsail firewall on `tryon-redis`: open TCP 6379 **only** to the app instances' private IPs (not public).
4. Repoint `REDIS_URL=redis://<redis-private-ip>:6379` and verify (BullMQ connects; queue health green).

### Phase 2 — Externalize Postgres → Lightsail Managed DB (HA)
1. Provision the managed DB (HA = primary + standby across AZs, auto-failover, automated backups + PITR):
   `aws lightsail create-relational-database --relational-database-name tryon-db --relational-database-blueprint-id postgres_15 --relational-database-bundle-id micro_ha_2_0 --master-database-name tryon --master-username <user> --region us-east-1`
   (Set a strong master password; keep the DB **private** — no public access.)
2. **Rehearse the migration on DEV first** (provision a throwaway managed DB, dump/restore, repoint, validate, then tear it down).
3. **Prod cutover (scheduled window, brief write-downtime):**
   - Stop the backend (or enable a maintenance gate) to freeze writes.
   - `pg_dump` the on-box Postgres → restore into the managed DB endpoint.
   - Repoint `DATABASE_URL` → the managed endpoint; `npx prisma migrate deploy`; restart; verify (`/health` 200, login, feed, a video job).
   - **Rollback:** if verification fails, repoint `DATABASE_URL` back to the on-box Postgres and restart (this is why the old box stays alive through cutover). The managed DB is the one near-irreversible step → rehearse it.
4. This is the same snapshot→restore→repoint procedure used to later resize the DB (1GB→2GB), so it doubles as the resize runbook.

### Phase 3 — Build the 2 app instances (app + nginx only, stateless)
1. `aws lightsail create-instances --instance-names tryon-app-1a tryon-app-1b --availability-zone us-east-1a` (run twice, once per AZ — or two calls) `--blueprint-id ubuntu_22_04 --bundle-id small_3_0 --region us-east-1`. Add swap (see §1).
2. Install Docker, clone repo, create `.env` with `DATABASE_URL`→managed DB, `REDIS_URL`→Redis instance.
3. ✅ **Compose variant created** — `docker-compose.app.yml` (backend + nginx + fail2ban + alloy; **no** postgres/redis — external; DATABASE_URL/REDIS_URL/WORKER_ENABLED from `./backend/.env`; nginx on :80). Ready to use.
4. ✅ **Behind-LB nginx created** — `nginx/nginx.app.conf` (listens :80; `real_ip` via the Cloudflare + LB chain; admin allowlist + blocked-paths + `/t/` + CORS preserved). `nginx -t` validated. ⚠️ **One placeholder to fill at provisioning:** the `set_real_ip_from` for the Lightsail LB's source range (a `TODO` marks it) — until it's correct the admin allowlist/fail2ban would key on the LB IP. No Let's Encrypt on the instance (LB terminates TLS).
5. Deploy on both instances; confirm each is healthy directly (`curl instance:80/health/live`).

### Phase 4 — Lightsail Load Balancer
1. `aws lightsail create-load-balancer --load-balancer-name tryon-lb --instance-port 80 --health-check-path /health/live --region us-east-1`
2. Attach both instances: `aws lightsail attach-instances-to-load-balancer --load-balancer-name tryon-lb --instance-names tryon-app-1a tryon-app-1b`
3. TLS: attach a Lightsail **managed cert** for `api.tryon-mirror.ai` (DNS-validated) → the LB terminates HTTPS; LB→instances over HTTP:80.
4. Wait for both targets to read **healthy** in the LB.

### Phase 5 — Cutover & decommission
1. DNS: point `api.tryon-mirror.ai` at the **LB** (in Cloudflare, set the origin to the LB's DNS name; keep Cloudflare orange-cloud). Cloudflare → LB → instances.
2. Verify end-to-end against the live domain: `/health`, login, feed (incl. video posters), a try-on + a video generation, IAP receipt path, `/admin` (allowlist via the realip chain), `/t/<id>` share page.
3. Keep the **old single box untouched for a few days** as rollback (DNS revert + `DATABASE_URL` revert). Then snapshot it and delete.

### Phase 6 — Deploys in the HA world (zero-downtime, replaces the blue/green TODO)
Deploy by updating **one instance at a time** behind the LB:
1. On `tryon-app-1a`: `git pull && docker compose -f docker-compose.app.yml up -d --build` → the LB health-check drops it while it restarts, traffic stays on `1b`.
2. When `1a` is healthy in the LB, repeat on `1b`.
3. Run `prisma migrate deploy` **once** (from either instance) — migrations must stay backward-compatible (expand/contract) since both versions briefly share the DB during a rolling deploy.
This gives the zero-downtime deploys that the single-box blue/green item (TODOS §5) was chasing — for free, via the LB.

### Cost recap
| Item | Bundle | $/mo |
|---|---|---|
| Managed Postgres HA | `micro_ha_2_0` (1GB) | 30 |
| App instance ×2 | `small_3_0` (2GB) | 24 |
| Load Balancer | — | 18 |
| Redis instance | `micro_3_0` (1GB) | 7 |
| **Total** | | **≈ 79** |

(Dev box stays a single `small_3_0` — no HA needed. Up-scale to Comfortable later by resizing the DB (Phase 2 procedure) and swapping app instances behind the LB — near-zero-downtime; see TODOS §9.)

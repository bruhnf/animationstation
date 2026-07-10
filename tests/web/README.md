# Website end-to-end tests

Browser-driven tests for the static site in [`website/`](../../website), run with
Playwright against a real backend and a real Postgres. They exercise what a
person actually does: click the button, fill the form, look at the page.

Two suites:

| Suite | Guards |
|---|---|
| `authFlow.e2e.mjs` | A visitor can reach Sign Up / Log In from the feed and actually create an account and sign in. |
| `feedVideoLayout.e2e.mjs` | Feed videos keep their aspect ratio (letterboxed) instead of being cropped to fill the post. |

These are **not** part of CI (`.github/workflows/ci.yml` runs the backend and
frontend unit suites only). They need a browser, a database, and ffmpeg, so they
are run deliberately, on demand.

Only `authFlow.e2e.mjs` needs a running backend. `feedVideoLayout.e2e.mjs` seeds
its own session and serves its own feed payload, so it runs standalone
(`npm run test:web -- video`) with nothing but Chromium and ffmpeg.

> **Guest-session budget.** `guestCreateLimiter` allows 10 anonymous sessions per
> hour per IP. The auth suite mints two per run, so roughly five runs an hour
> before `POST /api/auth/guest` starts returning 429 and the feed reports
> *"Could not start a session."* Restart the backend to reset the counter — it
> lives in express-rate-limit's in-memory store.

## Prerequisites

Install the Chromium build Playwright drives (once per machine):

```bash
npx playwright install chromium
```

`feedVideoLayout.e2e.mjs` encodes its fixture clips with **ffmpeg**, which must
be on `PATH`.

## Running

Start Postgres and Redis, apply migrations, then start the backend. Run each
command from the repository root unless noted.

```bash
# 1. Database + queue (from the repo root)
docker compose up -d postgres redis

# 2. Apply migrations to the local database (from backend/)
cd backend
DATABASE_URL='postgresql://animationstation:animationstation_dev@localhost:5432/animationstation_db' npx prisma migrate deploy
cd ..

# 3. Start the backend. The shell environment wins over backend/.env (dotenv
#    never overrides an already-set key), so these overrides keep the run off
#    the real SMTP host and off the generation queue. Empty SMTP_HOST makes
#    emailService log verification emails instead of sending them.
cd backend
DATABASE_URL='postgresql://animationstation:animationstation_dev@localhost:5432/animationstation_db' \
REDIS_URL='redis://localhost:6379' \
APP_URL='http://localhost:3000' \
ALLOWED_ORIGINS='http://localhost:3000' \
WORKER_ENABLED='false' \
SMTP_HOST='' SMTP_USER='' SENTRY_DSN='' \
npx ts-node-dev --respawn --transpile-only src/index.ts
```

Then, from the repository root, in another shell:

```bash
npm run test:web            # both suites
npm run test:web -- auth    # just the auth flow
npm run test:web -- video   # just the feed video layout
```

## How they run the site

The backend resolves the website as `path.join(__dirname, '../website')`, which
only lands on the real directory inside the container, where `website/` is
bind-mounted to `/app/website`. So locally `siteServer.mjs` serves `website/`
itself and proxies `/api/*` to the backend on `:3000`, reproducing the
same-origin layout production has (`auth.js` hardcodes `API_BASE = '/api'`).

`authFlow.e2e.mjs` is otherwise fully real — real signup, real database rows,
real login. The only shortcut is the inbox: it reads the account's
`verifyToken` straight from Postgres (see `db.mjs`) instead of opening an email,
then requests the same `/api/auth/verify/:token` URL the emailed link points to.

`feedVideoLayout.e2e.mjs` pins the media under test by answering `GET /api/feed`
with a fixture of three ffmpeg-encoded clips (1:1, 16:9, 9:16), each framed by a
red border. It then screenshots the rendered post and reads the pixels, so it
asserts on what is painted rather than on the stylesheet.

## Checking that they can fail

Both suites were written against the bugs they guard. To see them fail, revert
the fix and re-run:

```bash
git stash push -- website/    # restore the buggy code
npm run test:web
git stash pop                 # put the fix back
```

The auth suite then fails at *"Sign Up page stays open (no bounce to feed)"*, and
the video suite fails every letterbox assertion for the square and 16:9 clips.

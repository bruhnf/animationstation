---
name: user-sim
description: Run the user-simulator journey test — simulates a user opening the app, logging in, checking checkpoints, editing their profile, buying credits, and logging out against a live or local TryOn backend. Use when asked to smoke-test auth, verify login/logout works, or check a backend after a deploy.
argument-hint: "[local|dev|prod] (default: prod)"
---

# User Simulator — user-journey smoke test

Runs `tests/userSimulator.mjs` (plain Node, no install needed) against a
backend. It walks the app's real user journey via the same API calls the
mobile app makes:

1. `GET /health` — backend + Postgres + Redis reachable
2. `POST /api/auth/login` — expect 200 with access/refresh tokens
3. `GET /api/profile/me` — access token must authenticate as the same user
4. **Checkpoints** — every key in `tests/checkpoints.json` is a PASSIVE
   assertion compared against the live `/profile/me` payload right after
   login (e.g. `{"credits": 0}` asserts exactly 0 credits). Each key is its
   own PASS/FAIL row. A failing checkpoint does NOT abort the run (logout
   still happens) but fails the overall result.
5. **Edit-profile round trip** — "clicks Save" twice via the same
   `PATCH /api/profile/me` request `EditProfileScreen` sends: changes
   firstName/lastName to a temporary value (`<name>_sim`), verifies it
   persisted with a fresh fetch, restores the original, verifies again.
   Leaves the account exactly as found. Also asserts the PATCH response
   echoes the new values (the app trusts that echo to update its store).
6. **Buy credits** — `GET /credits/balance` (must agree with the profile),
   then `POST /credits/purchase` for `CREDITS_TO_BUY` (10) credits:
   - **local backend** (`NODE_ENV=development`): expects 200, then verifies
     the new balance is exactly +10 via a fresh `/credits/balance` AND that a
     `GRANT +10` row landed in `/credits/history`.
   - **dev/prod servers** (`NODE_ENV=production` on both boxes): the endpoint
     MUST answer **410 Gone** — App Store Guideline 3.1.1 forbids granting
     credits outside a verified StoreKit receipt — so the 410 itself is the
     PASS condition. Any other status fails.
7. `POST /api/auth/logout` — expect 200
8. `POST /api/auth/refresh` replaying the logged-out refresh token — **must**
   be rejected with 401 (proves logout revoked the session server-side)

Every run writes a timestamped markdown report to `tests/results/`
(gitignored) — date/time, environment, user, overall result, and a PASS/FAIL
table with one row per test. Reports are written even when a lifecycle step
aborts the run.

## How to run

From the repo root (`www/`):

```powershell
node tests/userSimulator.mjs --env <env>
```

- `<env>` is the skill argument: `local`, `dev`, or `prod`. **Default to
  `prod`** when no argument is given — the standing test account
  (`testme@bruhnfreeman.com`) exists on prod and local (created 2026-06-11);
  dev returns 401 for it.
- Credentials are read from the gitignored `tests/.sim-credentials.json`
  (CLI `--email`/`--password` and `SIM_EMAIL`/`SIM_PASSWORD` env vars take
  precedence). If the user supplies different credentials, pass them as CLI
  flags — do not write them into any tracked file.
- The script exits 0 only when every step AND every checkpoint passes;
  otherwise it exits 1. Lifecycle steps abort on first failure; checkpoint
  failures let the run finish (clean logout) but fail the overall result.
- `tests/checkpoints.json` is **owned by the user** and contains only passive
  assertions — the simulator never writes to it, and Claude should only edit
  it when the user asks. Any field on the `/profile/me` payload can be
  asserted (`credits`, `tier`, `verified`, `username`, `tryOnCount`, ...);
  comparison is strict equality. Action-step parameters (temp-name suffix,
  credit pack size) are constants at the top of `userSimulator.mjs`, not
  checkpoint keys.

### Running against `local`

The full buy-credits path only executes here. Setup:

1. Postgres + Redis containers up (`docker-compose up -d postgres redis`)
2. Backend: `cd backend && npm run dev` (needs `NODE_ENV=development` in
   `backend/.env`, which is the local default)
3. The local test user is created via the admin API (NOT direct DB writes),
   with the name matching the checkpoints:
   `POST /api/admin/users` with `X-Admin-Key` from `backend/.env` and body
   `{"username":"testme","email":"testme@bruhnfreeman.com","password":<from
   .sim-credentials.json>,"firstName":"Bart","lastName":"Starr"}`
4. ⚠️ Each local run permanently adds 10 credits to the local user, so the
   `credits` checkpoint will fail on the SECOND local run. Either reset the
   local user's credits via the admin dashboard (http://localhost:3000/admin),
   delete and recreate the user, or expect that row to fail.

## Interpreting failures

- **Step 1 fails / connection error** — backend or a dependency (Postgres,
  Redis) is down, or DNS/nginx is broken. Check
  `https://api[-dev].tryon-mirror.ai/health` and the Lightsail box (or the
  local dev server for `--env local`).
- **Step 2 returns 401** — wrong credentials, or the test account doesn't
  exist on that environment (expected on dev). Don't retry repeatedly:
  `/api/auth` is rate-limited and fail2ban watches repeated auth failures.
- **Step 2 returns 403 `EMAIL_NOT_VERIFIED`** — someone reset the test
  account's verified flag; re-verify via the admin dashboard.
- **Step 3 fails** — access-token signing/verification is broken (JWT_SECRET
  drift between deploys is the usual suspect).
- **Checkpoint rows fail** — live data doesn't match `tests/checkpoints.json`.
  Report the mismatch; the user decides whether the data or the expectation
  is wrong.
- **Name-edit rows fail** — the profile-update path is broken (validation,
  Prisma update, or response shaping in `profileController.updateProfile`).
- **Buy step gets 200 on dev/prod** — **serious**: a live server is granting
  credits without a StoreKit receipt. That's an App Store Guideline 3.1.1
  violation AND means `NODE_ENV` is misconfigured on that box. Flag it
  immediately.
- **Buy step gets 410 on local** — local backend isn't running with
  `NODE_ENV=development`.
- **Final step gets anything other than 401** — **serious**: logout returned
  200 but did not revoke the refresh token server-side. Treat as a security
  bug in `authController.logout`, not a flaky test.

## Cautions

- With `REFRESH_TOKEN_ROTATION` on (it is, on both boxes), the final replay
  trips reuse detection and revokes the account's entire refresh-token
  family. Fine for the dedicated test account; do NOT point the simulator at
  an account with real devices logged in.
- This hits live servers. Running it against `prod` is safe — the only
  mutations are the name round trip (restored before logout) and one
  refresh-token row that gets cleaned up — but keep it to the test account.

After the run, report each step's outcome and overall pass/fail to the user,
and link the report file written under `tests/results/`. If a step failed,
include the failing request, status code, and the relevant interpretation
from above.

# TODOS.md

Consolidated list of every item we deferred, marked "for later," or otherwise punted during our work sessions. Items in-flight in the current session are included so nothing falls through the cracks.

**Criticality tags:**
- 🔴 **Critical** — actively required or breaks something today
- 🟠 **High** — operational risk if skipped much longer
- 🟡 **Medium** — meaningful improvement, can wait
- 🟢 **Low** — defensive, optional, or polish

**Last reviewed:** 2026-06-16 (**AI Video feature + credit-farming hardening shipped on `develop` → v1.3.0**, deployed to dev, 1.3.0 EAS dev build kicked off; full docs sync). Prior: 2026-06-15 (server check: **1.2.0 is LIVE on the App Store** + prod backend cut over); 2026-06-14 (captions + web carousel + security audit — see **§0.5**); 2026-06-13 (1.2.0 build cut). Newest shifts:
- **✅ v1.3.0 built on `develop` (NOT on prod, NOT submitted to ASC).** = **AI Video** (image-to-video via Grok Imagine — VideoScreen + Video/Design tabs + feed/profile play overlay + share-page `<video>`; videos reuse `tryon_jobs` with `kind=VIDEO`; admin `videoCreditCost` default 2) + **credit-farming hardening** (email normalization, per-referrer cap, deviceId-gated guest grant, referral-velocity alert) + try-on captions + web "My Try-Ons" carousel + keyboard-coverage fixes + TryOn closet-spotlight redesign. Version bumped to 1.3.0 (app.json + both package.json + CLAUDE.md). **3 new migrations since 1.2.0:** `add_tryon_title`, `add_email_normalized`, `add_video_jobs` — all applied on dev (32 total).
- **⚠️ Native rebuild gate:** 1.3.0 adds `expo-video` (native). A JS reload won't load it — testing video on device needs the **1.3.0 EAS dev-client build** (kicked off 2026-06-16, build `f6ec9619`, `com.evofaceflow.tryon.app.dev`, NOT submitted to ASC).
- **🟡 Video follow-ups (from the 1.3.0 code review — minor, not blocking):** (a) `CompareScreen` + `SavedLooksScreen` now receive `kind:VIDEO` rows via `/tryon/history`/saves and render the (null) result image → a video shows as a blank/poster tile, not playable there (no crash). Filter videos out or teach those screens to play. (b) `AiConsentModal` copy says "to generate your try-on…" — fine (same xAI data-processing consent) but could generalize to "try-on or video." (c) `GET /api/video` exists but no client caller yet (a future "My Videos" list). **LoE: (a) S, (b)/(c) XS.**
- **Prod is on 1.2.0; dev is on `develop` (v1.3.0).** Promote 1.3.0 to prod only with the App Store 1.3.0 build — needs `prisma migrate deploy` (the 3 migrations above) + an `expo-video`-capable app build.
- **✅ 1.2.0 is LIVE on the App Store** (approved 2026-06-14, after TestFlight testing). Public App Store went **1.0.17 → 1.2.0** (1.1.0 never shipped — TestFlight only). 1.2.0 = Outfit Designer/Closet + Clean Up + share pages + Saved Looks + Compare + referral + admin offer engine + IAP refund-clawback fix + admin-email validation + looks privacy/GDPR fix.
- **✅ PROD CUTOVER DONE.** Verified 2026-06-15 (read-only): prod is on `main` @ `1764d47` (== `origin/main`), backend image built 2026-06-13 23:03 (v1.2.0), **29 migrations applied** ("schema up to date" — incl. `add_referrals` + `add_saved_looks`), nginx force-recreated (the `/t/` share proxy answers — bogus UUID → backend's 404 "not available" page, not the SPA catch-all), `/health` ok. `origin/develop` is now only **2 commits ahead of `main`** (both docs/chore: `fc61414`, `79c1efe`). Welcome-bonus grant can now be changed freely (1.2.0 carries the dynamic `useConfigStore` copy).
- **✅ DEV redeployed + caught up to `origin/develop`** (2026-06-15). Was 4 commits behind; pulled to `df8ccb4`, rebuilt backend (healthy), ran `prisma migrate deploy` (**30 migrations now**, `add_tryon_title` applied), and `chmod -R a+rX website`. Verified: `/health` ok, `/t/` proxy answers (404 on bogus id), the new carousel `tryons.js` is served. This deploy also shipped the **try-on captions + redesigned web "My Try-Ons"** work from §0.5. Prod does NOT have these yet (still on `main`); promote via develop→main when ready. (Stray untracked `backend/.env.bak.*` files remain on dev — gitignored, harmless.)
- **SMS toll-free `+18337624449` is now ACTIVE** (registration approved); simulator origination also active. Claude uses it to text the user (+14436108379) on request. SES is production-enabled. See memory project-sms-setup.
- Prod hardening spot-checked 2026-06-13 (read-only): ufw active + SSH rate-limited, fail2ban running, nginx admin allowlist (`deny all` ×2), unattended-upgrades active, all containers healthy — matches docs.
- **Added §1.6 — engagement & retention brainstorm** (7 habit/affirmation ideas, tagged build-vs-no-build) and a **§8 item to explore AWS Rekognition as an image filter** (input safety/quality gate + person-detection for the B2 enhancer).

Earlier 2026-06-13 (admin-configurable welcome bonus + rebrand re-audit + Closet/Designer code review):
- **Welcome bonus ("join offer") is now admin-configurable + discontinuable** (`AppSettings.signupCreditGrant`, ⚙️ Settings, public `/api/config` driving dynamic app copy). See ✅ Done. Dynamic copy rides **1.2.0** (1.1.0 — the current TestFlight build — hardcodes "10 Free Credits").
- **Versioning: next release = 1.2.0.** 1.1.0 (Closet/Outfit Designer) is in TestFlight/ExpoDev being tested, not yet submitted. This session's work (offer engine + the 6 enjoyment features) is a minor bump → 1.2.0. app.json + both package.json bumped together.
- **Rebrand re-audit: clean** — no stray `evofaceflow` user-facing text; all remaining refs are intentional infra. **Closet/Outfit Designer code review: no bugs found** — money paths are idempotent (conditional decrement, Sentry-paged refunds), S3 ownership server-enforced, 90s client timeout on generate.

2026-06-12 session:
- **Splash/announcement screen shipped to dev + PROD (backend + admin + website)**: publish/replace/remove a launch splash with zero rebuilds (Admin → ⚙️ Settings, or a file drop in `backend/splash/`). The **mobile modal + Settings toggle ride the next app build** (see §4). Admin user modal gained a per-user **Try-On Sessions photo gallery**; the website **My Try-Ons page now shows inputs + results** (with `?v=` cache-busting — Cloudflare caches JS 4h).
- **DB↔S3 reconciliation run (prod + dev):** 0 dead DB refs anywhere; dev clean both directions. Prod had 141 unreferenced objects — 116 TryOn orphans (~20 MB) from admin job deletes that never cleaned S3 (**root cause fixed**: job delete/bulk-delete now remove clothing/result objects; orphan scan upgraded to full key-level reconciliation with live/deleted-user attribution) + ~25 legacy EvoFaceFlow `avatars/`/`videos/` objects (~66 MB) that are NOT TryOn data. **Cleanup actions still pending — see §3.**
- **1.0.17 build 28 is on EAS, ready to submit** (build 27 superseded; builds 26/27's Sentry-token lessons in CLAUDE.md). Carries: simplified signup, upload tips, low-res warning, partial-result notes, profile focus-refresh, **Sentry RN ACTIVE** (DSN + source maps via EAS env), and the honest purchase-status fix.
- **Purchase incident (Jim Morris, 2026-06-11) found + fixed:** TestFlight sandbox receipt rejected by the Production-only verifier while the webhook safety net was broken (dev `APPLE_ROOT_CERTS_DIR` pointed at a host path). Backend now does dual-environment verification + Sentry paging on verify failures; dev cert path fixed; user reconciled +10 credits from Apple-verified history. See CLAUDE.md → Apple In-App Purchases.
- **Case-insensitive uniqueness (citext) for username AND email** live on dev+prod (migrations applied); check-then-create races now 409 not 500; guest locations geo-resolve; **My Try-Ons web page live on prod**; 5 Sentry dashboards created.

Previous reconcile (2026-06-10):
- **1.0.16 is now LIVE on the App Store** (was "in review"). **1.0.17 is prepping for submission** — the repo, both `package.json`s, and `app.json` are all at `1.0.17`.
- **A full `develop`→`main` merge promoted the entire dev backlog to prod this session.** Items that were "done on dev / deploy to prod next" are now **live on prod**: presigned-URL cache (A1), proactive queue-health monitor, `/metrics` (prom-client), the new **guest-credit admin setting**, and the Cloudflare real-IP nginx block (on disk in prod, still **inert** — nginx was intentionally not force-recreated; activate at orange-cloud cutover).
- **Refresh-token rotation is now ON in dev + prod (2026-06-10).** The real blocker was the crash-in-the-gap logout (client persists the rotated token only after the response; a force-close in that window replayed a consumed token and revoked the family). Fixed **server-side** with a successor-aware grace (tombstone + recover-if-successor-unused; migration `add_refresh_token_rotation_grace`). Validated end-to-end on both boxes and the flag flipped ON. See §1 + ✅ Done.
- **Also shipped this session:** `@sentry/react-native` (gated on `EXPO_PUBLIC_SENTRY_DSN`, rides the 1.0.17 build) and a `clear-locations` admin endpoint + button.

**Standing context:**
1. **The app is LIVE with real users.** "Don't break prod" means real people. Validate prod-affecting changes on dev first.
2. **A separate dev environment exists** (`develop` branch → `api-dev.tryon-mirror.ai`, `docker-compose.dev.yml`, `nginx.dev.conf`). Prove a change on dev before touching prod.

---

## 0.3 ★ NEXT RELEASE (post-1.3.0) — TOP PRIORITY (added 2026-06-16)

The two items below are the **top priority for the first release after 1.3.0.** Both were explicitly deferred during the 1.3.0 pre-review pass.

#### 🔴 N1. iOS DeviceCheck / App Attest — reinstall-proof guest + referral anti-farming — Effort: M–L
The guest welcome-credit grant and the referral reward are **bounded but not bulletproof today.** The guest grant keys on a client-supplied `deviceId` (a fresh random value per call evades dedup; capped only by the 10/hour/IP limiter), and circular referrals from two separate real inboxes pay both sides up to `referralMaxPerWindow`. The robust fix is Apple **DeviceCheck / App Attest**: bind the welcome-grant decision (and ideally the referrer payout) to a genuine, attested device that survives reinstalls and Keychain wipes. Caveats: native module + an Apple private key, and it **cannot be tested on the simulator** (real device / TestFlight only). Keep the per-IP limiter + the guest/referral abuse monitors as backstops. See CLAUDE.md → Guest Mode (Abuse) and Engagement & Growth Features (referral anti-farming).

#### 🔴 N2. Pinch-to-zoom on full-screen images — Effort: M
Re-add pinch-to-zoom in `FullScreenImageModal` (removed in 1.0.17 because a nested zoom `ScrollView` raced layout in **RELEASE builds only** — the dev client masked it). Re-implement with `react-native-gesture-handler` + `react-native-reanimated` (both already deps) instead of nested ScrollViews, and **validate on a TestFlight/release build, not just the dev client** (the original bug reproduced only in release). See memory `reference_pinch_zoom_carousel_pitfall`.

### Backlog (deferred — not blocking, do when convenient)

#### 🟡 N3. Closet generation: async refactor → per-user soft throttle + wait queue (parity with TryOn) — Effort: L
Today **Design an Outfit** (`/api/closet/generate`) and **Clean Up a Photo** (`/api/closet/cleanup`) have ONLY a hard **3/min per-IP** rate limit ([index.ts](backend/src/index.ts) `closetGenerateLimiter`); they have **no** soft per-user throttle / wait-queue countdown (the `1→3→5→10-min` ladder in `services/throttleService.ts`). TryOn has both. The blocker is architectural: closet generation is **synchronous** (`await generateOutfitImage(...)` / `cleanupClothingImage(...)` inline, returns the image in ~10–30s), whereas the wait queue is a property of TryOn being **async** (BullMQ-queued, `scheduledStartAt`, client polls + countdown). To get true parity, make closet generation async like TryOn: new closet queue + worker + a job-status row + poll endpoint; client submits → polls → countdown → result; `computeQueueDelayMs` reused for the per-user delay. **Decision (2026-06-17):** user wants the full async refactor eventually but deliberately deferred it — the app was **In Review** and they didn't want to risk a change. Do it in a normal release window, validate on dev first. (Lighter interim alternative if ever needed: keep closet synchronous but have the server reject over-burst submits with the wait time and let the client show the countdown + auto-retry — no queue/worker, but the wait is client-side so the app must stay open.)

---

## 0.5 ★ 2026-06-14 session — captions, web carousel & credit/subscription security audit

Everything we discussed this session, with a rough **level of effort (LoE)** for the *remaining* work. Items already implemented on `develop` are marked ✅ (LoE shown for the prod cutover only).

**Effort key:** **XS** ≤30 min · **S** ~1–2 h · **M** ~half-day · **L** ~1–2 days · **XL** multi-day.

### Shipped this session (on `develop`, needs prod cutover)
- ✅ **Try-on captions (`TryOnJob.title`).** Schema + migration `add_tryon_title`, `sanitizeTryOnTitle()`, captured at submit, `PATCH /api/tryon/:jobId/title` to edit, rendered under the feed image, on web "My Try-Ons", and on the `/t/:jobId` share page. **Remaining LoE: XS** (rides the normal deploy + `prisma migrate deploy`).
  - 🟡 **Follow-up (not done): edit-caption UI in the app + on the web page.** The endpoint exists, but no in-app "edit caption" control is wired (only set-at-submit). Web page has no edit either. **LoE: S–M.**
  - 🟢 **Follow-up: unit test `sanitizeTryOnTitle`** (it's exported + pure, mirrors `sanitizeOutfitPrompt`'s test). **LoE: XS.**
- ✅ **Web "My Try-Ons" redesign** — 2 input thumbnails → full-image carousel (arrows/keys/counter/AI-badge). Pure website change (`tryons.html` + `tryons.js`, `?v=20260614` cache-bust). **Remaining LoE: XS** (HTML/JS are bind-mounted; `git pull` + `chmod -R a+rX website` on prod — remember the umask-007 403 gotcha).

### Security audit findings — credit + subscription systems

**Verdict:** the three credit grant paths and the Apple IAP pipeline are **well-built** — atomic, idempotent, no SQL-injection surface (all Prisma parameterized / tagged-template `$queryRaw`; no `$queryRawUnsafe` anywhere). The issues below are **economic-abuse** vectors, not code-correctness bugs.

- ✅ **Referral + welcome-bonus farming via disposable / plus-addressed emails — HARDENED (Moderate, 2026-06-15, on `develop`).** Shipped: **(b) email normalization** — `utils/emailNormalize.ts` (lowercase + strip `+tag` for all domains + strip dots for gmail/googlemail, unit-tested) feeds a new `User.emailNormalized @unique @db.Citext` column (migration `add_email_normalized` + backfill); signup/claim now reject aliased duplicates of one inbox. **(a) per-referrer cap** — `referralMaxPerWindow` admin setting (default 20, 0=unlimited) over a rolling 30-day window in `processReferralReward`; over the cap the *referrer's* payout is withheld (invitee still paid). **(d) referral-velocity alert** — added to the hourly `guestAbuseMonitorWorker` (`sendReferralAbuseAlert`, debounced via `referralAbuseLastAlertAt`). Admin control: `PATCH /api/admin/settings/referral-max` + ⚙️ Settings UI. **Deferred (Strict tier, option (c)):** pay referral only after a costly action (purchase / first try-on) — not done; revisit if farming persists.
- ✅ **Guest welcome-grant `deviceId` gate — HARDENED (2026-06-15, on `develop`).** `createGuest` now only applies the welcome grant when a **non-empty `deviceId`** is supplied; null/empty (web, simulator, pre-rebuild dev client) → working guest but **0 credits**, and no `guest_create` metric row. Kills the trivial null-device farm. Random-deviceId spoofing still gets one grant but stays bounded by the 10/hour/IP limiter + the guest-abuse monitor. **Reinstall-proof prevention (iOS DeviceCheck) still deferred — LoE: L.**
- 🟢 **No findings** in the subscription/IAP path: `verify-receipt` checks `appAccountToken === user.id`, dual-environment verification, idempotent on `transactionId`, webhook JWS-verified against Apple's CA chain, refund claw-back is `revokedAt:null`-gated + `FOR UPDATE`-locked + balance-clamped, and `downgradeIfNoActiveEntitlement` avoids demoting users with overlapping subs. **No action.**
- 🟢 **Hardening nice-to-have:** the legacy dev-only `/api/credits/{purchase,subscribe,unsubscribe}` endpoints are `env.isDev`-gated (410 in prod) — correct, but a belt-and-braces guard so they can never be reachable in prod (e.g. assert at boot) is cheap. **LoE: XS.**

---

## 0.6 ★ 2026-06-16 — Testing & fault-detection review

Prompted by the two video bugs that pure unit tests couldn't catch (a route↔controller wiring mismatch: `.single` vs `.fields`, and a moderation false-positive). Added coverage + an honest gap analysis.

**Done this session:**
- ✅ **`supertest` added** (devDep) + first **integration test** (`src/routes/video.upload.test.ts`): mounts the REAL `uploadVideoSources` multer middleware + real `selectVideoSources` over HTTP — fails if the upload middleware regresses to `.single` or the field names drift. No DB/Redis/Grok.
- ✅ **Extracted pure, unit-tested logic** that the bugs lived in: `utils/videoSource.ts` (`selectVideoSources` — the `req.files`/field-name contract, incl. the `.single`→undefined-files regression) and `utils/videoPoll.ts` (`classifyVideoPoll` — success-vs-moderation, with the exact real success body). Both are the actual controller code paths now. **Suite: 135 tests.**

**Gaps / recommended next (not done — sized):**
- 🟠 **No DB-backed route-level integration harness.** The `submitVideo`/`tryonController` *controllers* (credit charge under `FOR UPDATE`, storage cap, consent gate, transaction + enqueue + rollback, refund) have **no end-to-end test** — they need a throwaway Postgres + Redis and mocked Grok/S3. This is the highest-value gap (money + entitlement paths). Proposal: a `docker-compose.test.yml` (ephemeral pg+redis) + supertest against the real app with the Grok/S3 boundaries stubbed; or per-test `mock` of `grokService`/`s3Service`/`enqueue*`. **LoE: L** (one-time harness), then **S/test** after.
- 🟡 **Worker orchestration** (`videoWorker`/`tryonWorker` generate→download→upload→COMPLETE, and the `failed`→refund/strike/grace path) is only covered by its pure helpers, not as a unit. Worth a worker-level test with mocked grok/s3/prisma once the harness above exists. **LoE: M.**
- 🟢 **Audit other upload routes for the same middleware↔handler contract** (`uploadSingle`→`req.file`, `uploadMultiple`→`req.files` array) — quick read; all currently consistent, but the integration-test pattern above should be copied to closet `cleanup`/upload + tryon submit if they grow. **LoE: S.**
- ✅ **CI gates these.** Confirmed `.github/workflows/ci.yml` backend job runs `npm ci` → `npx tsc --noEmit` → `npm test`, so the new supertest dep + integration/unit tests block merges on failure.

---

## 0. 🚀 Launch-readiness roadmap (APPROVED 2026-06-08) — **Phase 0 active**

Approved strategic roadmap to remove single-points-of-failure + reach **zero/minimal downtime** ahead of a **specific launch event** (date TBD — gates what's mandatory vs fast-follow), then add web presence + growth. Moderate budget: **~$65–110/mo net new infra**. Every infra change validated on **dev → prod**. Full plan lives in the approved plan doc; this is the tracked execution list.

**▶ Progress — 2026-06-08 evening (DEV ONLY; prod untouched):**
- ✅ **AWS Budgets** — `TryOn-Monthly-Cost` $150 w/ email alerts at $100 / $120 / $150 + forecast-over-$150 (current spend $12.44).
- ✅ **Feed pool fix → dev + PROD** — Prisma `connection_limit=15` (env `DB_CONNECTION_LIMIT`) + dropped per-request `count()`. Fixes the pool-starvation collapse (0 errors at conc 10/30/60). **Deployed to PROD 2026-06-09** (cherry-pick `3ab0c39` → `c41e1f7`; backend rebuild; verified — feed smoke 200 / 20 jobs / hasMore / 318 ms). The remaining ~580 ms cold floor was the **~120 S3 presign ops/request** → addressed by the **presign cache (A1, done on dev, 5–8× faster; deploy to prod next)**.
- ✅ **Backend `/metrics`** (prom-client) → dev — default process/Node metrics + HTTP latency histogram. (nginx must expose it to the scraper only in prod.)
- ✅ **Redis AOF** — already `--appendonly yes`; no change.
- ✅ **Web account-management page** built on branch `feature/web-account-management` (profile, password, AI-consent, data export, blocked users, delete) — NOT deployed (dev doesn't serve the marketing site; needs prod + a live-API integration test).
- ⏸ **Blue/green** — best implemented WITH Step 4 (deploy one LB node at a time); the single-host version is fiddly → folded into Step 4.
- ⏸ **Managed PG / Step 4 (LB+2nd node)** — ongoing-cost prod-touching steps (see EveNingWork.md). **Load test proved instance SIZE is not the limit** (RAM/CPU had headroom under load); the real levers are app-level (presign cache, pool) + horizontal (Step 4).

**▶ Progress — 2026-06-09 (A1 + B1):**
- ✅ **A1 — Presigned-URL cache** (`s3Service`, commit `403bfb5`) **deployed to dev + validated: feed ~5–8× faster** (conc 60 p95 4.0 s → 0.5 s), 0 errors. *The feed is now fast under load.* This was the #1 remaining feed lever.
- ✅ **B1 — Cloudflare** — **live + validated on dev.** NS flipped (zone active); `api-dev` orange-clouded + verified (`Server: cloudflare` + `CF-RAY` + 200), **prod still grey/direct** (`Server: nginx`, no cf-ray). Exact grey mirror of Route53; SSL Full-strict. Rollback NS in DEPLOYMENT.md §11.4.
- ✅ **Cloudflare real-IP for nginx** — **done on dev + validated** (nginx logs real `47.230.244.171` through CF, not a CF IP). Identical block **staged in `nginx/nginx.conf` for prod** (commit `444d448`, committed not deployed — inert while grey). **Prod cutover runbook (deploy real-IP → orange-cloud web records → validate) in DEPLOYMENT.md §11.4.** CF token deleted from `secrets/`; rotate in Cloudflare.
- ✅ **Proactive queue-health monitor** (`queueHealthMonitorWorker`, commit `c0cc12a`) **deployed to dev** — every 5 min, emails admins on `tryon`/`apple-notifications` **backlog ≥ 50 or failed ≥ 20** (debounced). Covers TODO §2 "proactive BullMQ threshold alert." Tunables: `QUEUE_BACKLOG_THRESHOLD` / `QUEUE_FAILED_THRESHOLD` / `QUEUE_ALERT_COOLDOWN_MINUTES`.
- ✅ **Grafana Cloud → /metrics** — **DONE on dev AND prod**: Grafana Alloy scrapes `backend:3000/metrics` → GC remote_write (verified, no errors). `env` label distinguishes dev/prod (`coalesce(sys.env("ALLOY_ENV"),"dev")`). Prod deploy was **zero backend interruption** (new container only; backend 20h uptime preserved). Creds in gitignored `alloy/.env` on each box.

**▶ Progress — 2026-06-10 (full develop→main promotion to PROD):**
- ✅ **Everything on `develop` is now on `main`/prod.** A full merge (`cfb17b4`) + prod backend rebuild promoted the whole backlog. Now **LIVE on prod** (previously dev-only): **presign cache (A1)**, **proactive queue-health monitor**, **`/metrics`** (prom-client, scraped by the already-running Alloy → Grafana Cloud), and the **1.0.17 frontend changes** (pinch-zoom removal, 2.5s polling). Backend healthy, `/health` 200 on both boxes; migrate-deploy was a no-op (no schema changes).
- ✅ **Guest welcome-credit admin setting** — new `AppSettings.guestCreditGrant` (default 2, 0–1000), Admin Dashboard **⚙️ Settings** tab + `GET/PATCH /api/admin/settings`. Live + verified on dev (PATCH→5→reset 2) and prod (GET). See ✅ Done.
- 🟡 **Cloudflare real-IP nginx block is now ON DISK in prod** (from the merge) but **inert** — nginx was deliberately not force-recreated (prod still grey). Activate during the orange-cloud cutover (DEPLOYMENT.md §11.4), force-recreating nginx then.

**Phase 0 — pre-event hardening (committed SPOF-removal sequence; do in order):**
- 🟠 **Step 0 — Load test dev (k6)** — a **k6 script now exists** (`loadtest/dev-capacity.js`, commit `c603416`), and an A1/pool before-after baseline was captured (see 2026-06-09 above). Remaining: a fresh full ceiling run after the prod promotion to set final per-node sizing. *(was 🔴 "no tests exist" — now partially done.)*
- 🔴 **Step 1 — Managed Postgres (HA)** — auto-failover + PITR; migrate via rehearsed `pg_dump`→restore, repoint `DATABASE_URL`. Makes the app stateless. *(promotes §5 managed-Postgres)* ~$30–60/mo
- ✅ **Step 2 — Cloudflare in front** — **DONE on PROD 2026-06-11** (api/www/apex orange-clouded, real-IP active, admin allowlist verified through the edge — needed the admin's IPv6 /64 added; email records grey; full functional pass clean). Dev was already proxied. **Prod server hardening also DONE same window** (harden-server.sh + reboot; Lynis report on the box; unattended-upgrades now auto-reboots 02:00).
- 🟠 **Step 3 — Blue/green deploys** — kill the ~30s 502 window. *(promotes §5 blue/green)* $0
- 🟠 **Step 4 — 2nd app instance + Lightsail LB (cross-AZ)** — removes the compute SPOF. **Committed up front.** ~$28–38/mo
- 🟡 **Step 5 — Redis on its own instance + AOF** — app-box failure no longer stalls the queue. ~$5–10/mo
- 🟡 **App metrics** — `prom-client` → Grafana Cloud free + proactive BullMQ queue alert. *(promotes §2)*
- 🟡 **Grok backpressure UX** — honest "high demand — queued" state at high queue depth (reuses `scheduledStartAt`).
- 🟡 **Sentry RN + PostHog** (next EAS build) *(from §2/§4)*; **RUNBOOK.md** *(from §3)*.

**Phase 1 — web presence:** D1 web account management → D2 shareable try-on pages (`/t/<jobId>`, SEO/viral) → referral program (credits-per-invite).
**Phase 2 — growth:** ASO refresh → social/creator engine → Product Hunt/PR → communities → lifecycle email.
**Phase 3 — enterprise depth:** full web TryOn app (D3) → SSO/MFA → status page + admin audit log → Android → managed Redis / multi-AZ if warranted → compliance/trust page.

**Open (block sequencing):** launch event + date · referral economics (Grok cost/invite) · web-subscription compliance (read-only vs Apple external-purchase) · Android in launch window or fast-follow.

> Instance note: current prod = 2 GB/2 vCPU burstable ($12/mo) — fine idle, small for sustained concurrency (co-located PG+Redis+Sharp). Step 1 + Step 4 relieve this structurally; let the load test set final per-node size (≥2 GB, bump to 4 GB only if Sharp shows pressure).

---

## 1. Highest-value, now unblocked — do these next

> **Shipped to prod:** backend memory bump, deep `/health` (2026-06-05), and
> refresh-token rotation — now **ON** in dev + prod with a crash-grace fix
> (2026-06-10) — are all live and verified on `main`. See ✅ Done. The nginx admin
> allowlist (formerly the last item here) was found already live in prod on
> 2026-06-07 — also in ✅ Done.
>
> **✅ DONE (2026-06-10) — refresh-token rotation is now ON in dev + prod.** The
> blocker turned out to be server-side, not a client fix: the crash-in-the-gap
> logout was solved with a **successor-aware grace** (tombstone the rotated row;
> recover instead of revoke when the successor was never used). Validated on dev
> and prod (normal rotation, reuse→revoke, grace recovery). See ✅ Done.

_(All other §1 items are now done. The remaining backlog is §2 onward.)_

---

## 1.5 📱 Product feature backlog — evaluated for the 1.0.17 bundle (added 2026-06-10)

Twelve product ideas evaluated for effort/complexity and sorted by **what needs a new iOS binary vs. what doesn't**. Context: 1.0.17 currently carries only the pinch-zoom removal + 2.5s polling + dark Sentry RN — too thin to spend a review cycle on. The plan below fattens the binary with the high-value/low-risk frontend items and ships everything else outside the review pipeline.

**Effort scale:** XS < S < M < L < XL.

### A. Ride the 1.0.17 binary (frontend changes — make the review cycle count)

#### 🟠 A1. Email + password-only signup (username carried over from guest) — Effort: M
**Improves:** Conversion. Signup is the top funnel choke point; every removed field helps. The guest already *has* a username (`user#######`) — asking them to invent a new one at claim time is pure friction.
**Status:** ✅ **CODE DONE (2026-06-10)** — `username` optional in signup/claim schemas (guest keeps handle on claim; direct signups get a server-generated one via the extracted `generateUniqueUsername()`); `SignupScreen` stripped to email+password+consent with a "you'll keep user#######" hint; website `signup.html`/`auth.js` simplified too. Awaiting dev test + 1.0.17 build.
**Plan:**
1. Backend: make `username` (and name fields) optional in the claim + signup zod schemas. On claim, omit `username` from the update → the guest's `user#######` survives. On direct (non-guest) signup without a username, generate one server-side with the same `user#######` generator `createGuest` uses.
2. Frontend: strip `SignupScreen` down to email + password (+ the existing consent checkbox). Username editing already exists in `EditProfileScreen` — no new UI needed.
3. Keep email verification exactly as-is (verify token, +10 welcome bonus).
4. Edge: username uniqueness on later rename is already enforced; nothing new.
**Risk:** Low — backward-compatible schema loosening; old clients that still send username keep working.

#### 🟡 A2. Photo upload tips — Effort: S
**Improves:** Result-quality expectations. Marginal input photos → bad generations → users blame the app. Cheap to ship, pairs with A3.
**Status:** ✅ **CODE DONE (2026-06-10)** — new [UploadTipsSheet](frontend/src/components/UploadTipsSheet.tsx) (clothing + body variants); "📸 Tips" links on TryOnScreen, ProfileScreen body-photos, OnboardingPhotoScreen, GuestProfileScreen; one-time dismissible card on TryOnScreen (SecureStore flag).
**Plan:** Static "📸 Tips for best results" content (good lighting, plain background, single garment, flat or on-hanger, no person wearing it, full item in frame). Surface as (a) a one-time dismissible card on `TryOnScreen` before first upload, and (b) a persistent "Tips" link near the photo picker on TryOnScreen + body-photo screens (Onboarding/EditProfile). Copy + a small reusable `UploadTipsSheet` component; no backend.

#### 🟡 A3. Image-resolution warning on upload — Effort: S (resolution only; defer blur/quality detection)
**Improves:** Catches the "marginal photo" case *before* a credit is spent. Complements A2.
**Status:** ✅ **CODE DONE (2026-06-10)** — `isLowResolution()` + `confirmLowResolution()` in [imageUtils.ts](frontend/src/utils/imageUtils.ts) (warn when longest side < 1024 or shortest < 500; "Use Anyway" passthrough); wired into TryOn clothing picks (camera + library) and all body-photo uploads (Profile, Onboarding, GuestProfile — avatars exempt). Thresholds are constants pending B3's measurements.
**Plan:** The picker result already includes width/height. Before `processImageForUpload()`, if the **source** image's longest side < ~1024 px (the backend's processing target) or shortest side < ~500 px, show a non-blocking "This photo is low-resolution — results may be poor. Use it anyway?" confirm. Threshold as a constant next to the resize config in [imageUtils.ts](frontend/src/utils/imageUtils.ts). True *quality* scoring (blur/exposure) is M–L and needs CV work — explicitly out of scope for v1.
**Depends on:** B3's measurement for the exact threshold numbers (do B3 first, it's quick).

### B. Backend / server-only — ship anytime, NO App Store review needed

#### 🟡 B1. Email admin when a new user joins — Effort: XS–S
**Improves:** Founder pulse on growth without watching the dashboard.
**Status:** ✅ **DONE (2026-06-10)** — `sendNewUserAlert` fires from `verifyEmail` (username, email, guest-conversion vs direct path, running real-account counts). E2E-tested on dev both paths; found + fixed `ADMIN_EMAILS` missing from dev's `.env` (which had been silently no-oping ALL admin alerts on dev). Prod has it set; goes live there at the next main merge.
**Plan:** Fire-and-forget `sendNewUserAlert(user)` in `verifyEmail` (a *verified* real account = the meaningful event; raw signups + guests are noise) — include username, email, signup path (claim vs direct), and running user count. Mirror `sendGuestAbuseAlert`'s try/catch-and-log pattern so it can never break verification. If volume ever makes per-user emails noisy, collapse to a daily digest via a BullMQ repeatable job (pattern already exists in `guestAbuseMonitorWorker`).

#### 🟡 B2. Outfit enhancer — Grok pre-pass to extract a clean product shot — Effort: M
**Improves:** Try-on quality on busy photos (person wearing the item, cluttered scene). Field-tested manually: "Remove the person from the image and create an image of only the clothing as a product shot from a fashion catalog" markedly improves results.
**Status:** Not started.
**Plan (backend pilot first, UI later):**
1. Add an `enhanceClothingPhoto()` step to [grokService.ts](backend/src/services/grokService.ts) — one extra Grok Imagine call with the product-shot prompt; store the enhanced image under a new S3 prefix (`clothing-enhanced/`) and keep the original.
2. Gate behind an `AppSettings` key (`tryonEnhancerMode: off | always | auto`) editable from the admin ⚙️ Settings tab — same pattern as `guestCreditGrant`. Pilot with `always` on dev, eyeball quality, then decide.
3. **Cost:** doubles Grok image calls per try-on while `always`. The `auto` mode (only when a person/clutter is detected) needs a detection heuristic — cheapest is asking Grok itself in the same pass, or a Rekognition `DetectLabels` call (~$0.001/image) for "Person" labels; decide after the pilot.
4. Phase 2 (rides a later binary): user-visible "✨ Clean up photo" toggle on TryOnScreen + showing the enhanced intermediate. Not needed for the server-side win.
**Risk:** Latency +1 Grok round-trip; an enhancer-pass failure runs inside the worker, so the existing terminal-failure refund path already covers it.

#### 🟡 B3. Re-evaluate the upload/resize pipeline — Effort: S (investigation)
**Status:** ✅ **DONE (2026-06-10)** — empirical A/B on dev (1504px vs 1024px clothing input, 2 generations each + the live job's result): **Grok outputs a fixed 864×1152 canvas regardless of input**, with no visible gain from the larger input. Verdict: keep both resize stages and the 1024 backend target; A3 thresholds (<1024 long / <500 short) confirmed correct. Original-upload dims now logged structured (`Upload image processed`) for ongoing real-world stats. Bonus fix found during instrumentation: `resizeImageForAvatar` applied EXIF rotate AFTER the square cover-crop → wrong crop region on portrait photos; rotate now runs first. Full verdict in CLAUDE.md → Image Processing.

### C. No app code at all

_(C1 QR hand-out card: **dropped 2026-06-12** by decision — not doing it. The do-not-incentivize-reviews compliance note lives on in git history if a hand-out ever returns.)_

### D. Web portal (Phase 1 work, no review)

#### 🟡 D1+. Web dashboard: user's try-on sessions on the website — Effort: M–L
**Improves:** Logged-in users manage their try-on history on the web. Explicitly **not** public-facing yet — a private dashboard only.
**Status:** ✅ **LIVE ON PROD (2026-06-11)** — `evofaceflow.com/tryons.html` serving (deployed in the 1.0.17 promotion; `chmod -R a+rX website` applied), linked from the live `account.html`. Grid via `/tryon/history`, privacy toggle, delete, lightbox, AI badge; `auth.js` API base hostname-derived. **Remaining (🟢):** a hands-on smoke pass of the account + try-ons pages against live prod data (pages serve; the interactive flows haven't been manually exercised on prod).
**Plan:** (1) First **deploy D1** (it's done and blocking — needs prod nginx + a live-API integration test). (2) Add a "My Try-Ons" page to it: grid of sessions (date, status, result thumbnails), detail view, delete, privacy toggle — all against existing `/api/tryon` endpoints (verify CORS + token-auth path on web, same as D1's calls). (3) Mirror the AI-generated badge on result images for consistency. This is also the foundation for D2 (shareable `/t/<jobId>` pages) — same components plus a public read path later.

### E. Deferred — do NOT put in 1.0.17

#### 🚫 E1. User-customizable Grok prompt — Effort: M, **recommend dropping**
You flagged it yourself ("not sure about this?") — agreed, and stronger: free-text into image generation **blows open the Guideline 1.2 moderation surface** you've carefully kept small (forced-private guest content, moderation-strike tracking, xAI filters operating on *our* fixed prompts). Every jailbreak attempt becomes your problem. The legitimate need underneath it (better results on awkward inputs, creative outfits) is covered more safely by B2 (enhancer, fixed prompt) and E2 (structured outfit designer). If it ever returns: structured controls (style/fit/occasion pickers), never raw text.

#### ✅ E2. Outfit designer ("My Closet") — v1 SHIPPED to dev (2026-06-12, branch feature/outfit-designer → develop)
Text-to-outfit → per-user closet → try-on from closet. The moderation concern was addressed exactly as specced: server-side prompt wrapping (fixed catalog-product-shot template + denylist pre-screen, unit-tested in `utils/outfitPrompt.ts`) feeding the existing CONTENT_MODERATED strike machinery. 1 credit per generation, transactional charge/refund. Closet images under the `closet/` S3 prefix; try-ons COPY the image into clothing-photos/ so closet deletion can't dangle job refs. Frontend `ClosetScreen` + TryOn picker integration rides the next binary (1.0.18). See CLAUDE.md → Outfit Designer & Closet. _(Original spec below for the trail.)_

#### (historical) 🟡 E2. Outfit designer screen (describe an outfit → AI generates it) — Effort: L → target 1.0.18
Genuinely good feature (text-to-outfit → then try it on = a differentiating loop), but: new screen + new backend endpoint + new Grok text-to-image path + **the same free-text moderation surface as E1** (mitigate with server-side prompt wrapping — "a flat-lay product shot of: <user text>, fashion catalog style" — plus the existing CONTENT_MODERATED strike machinery). Too big to rush into 1.0.17 alongside A1. The output feeds the existing try-on pipeline as a clothing photo, so the backend delta is smaller than it looks — but spec it properly first.

#### 🟡 E3. iPad support — Effort: M–L → its own release
`supportsTablet` is `false` in [app.json](frontend/app.json#L15). Flipping it means: layout audit of every screen at iPad sizes (the 5-tab + FAB layout, modals, the camera flow), mandatory iPad screenshots in App Store Connect, and Apple reviewing on iPad. **⚠️ One-way door: once you ship iPad support, App Store Connect does not let you remove a device family in an update** — broken-on-iPad becomes a permanent review liability. Do it deliberately in a dedicated release, not as a 1.0.17 stowaway.

#### 🟢 E4. Clothing store for designers — Effort: XL → Phase 3 (park it)
A marketplace: designer onboarding, catalog, search, and a hard commerce question — digital goods sold in-app must use Apple IAP (30%/15% cut, Guideline 3.1.1) while physical goods must NOT use IAP. Business-model design needed before any code. Belongs next to "enterprise depth" in §0 Phase 3.

### Recommended 1.0.17 submission package
**In the binary:** pinch-zoom removal + 2.5s polling (already in) · **A1 simplified signup** · **A2 upload tips** · **A3 resolution warning** · Sentry RN **activated** (DSN + EAS env — §2, it's S).
**In parallel, no review needed:** B1 new-user email (this week — it's XS) · B3 investigation → feeds A3's thresholds · B2 enhancer pilot on dev · C1 hand-out · D1 web deploy then D1+ dashboard.
**Sequence:** B3 (half a day) → A2+A3 together → A1 → TestFlight pass (**release build** — remember the pinch-zoom lesson: the dev client masks release-only bugs) → submit.
**▶ Status 2026-06-11: package COMPLETE — EAS build 28 is the submission candidate** (binary items + Sentry RN active + honest purchase status). Remaining before submit (user): TestFlight pass on build 28 — include one sandbox credit purchase (first-ever test of the now-working fast path) — then `eas submit`.

---

## 1.6 🧲 Engagement & retention brainstorm (added 2026-06-13) — habit/affirmation loops

Seven ideas aimed at making the app *psychologically* sticky — self-affirmation, social validation, variable reward, loss aversion — drawn from proven consumer-social mechanics (Snapchat streaks, Spotify Wrapped, IG reactions). Sorted by **what needs a new iOS binary vs. what ships today**. ⚠️ Reminders verified this session: **no EAS Update/OTA is configured**, so *any* frontend change = a full new EAS build + App Store review; and **no push infra exists** (`expo-notifications` not installed), so anything notification-based needs a new native module first.

**Sequencing recommendation:** ship the no-build pair (#2 recap + #5 teaser) first via the web + SMS + Splash channels we already have (reaches even 1.0.17 installs that will never get a new build); batch the four pure-frontend items (#1, #3, #4, #7) into one app version to share a review cycle; do #6 (push) as a follow-on once the native module lands.

### Ships today — NO app build
- 🟡 **#2 — "Your Week in Looks" recap.** *Hook: self-affirmation + identity reinforcement + built-in share loop.* Weekly Wrapped-style card ("You tried 14 looks; 62 people loved your style; top look 👇"). v1 = server-rendered web page (like the `/t/:jobId` share pages) delivered via **SMS** (now working) or email. Reuses `/tryon/history` + likes counts. A richer in-app card is a later build. Effort: M (web+job).
- 🟡 **#5(v1) — Daily Style Challenge teaser.** *Hook: variable reward + novelty + FOMO + a daily reason to open.* A rotating daily theme ("Today: Festival Fit 🎪") can ride the existing **backend-controlled Splash/Announcement** system with zero rebuild. The full mechanic (themed feed, submissions, voting) needs a build — see below. Effort: S (teaser) / L (full).

### Needs a new EAS build (pure frontend — backend pieces ship immediately)
- 🟡 **#1 — Style Streak + daily free try-on.** *Hook: loss aversion (the strongest retention mechanic in consumer social).* Visible streak counter, milestone rewards (3/7/30 → a free credit), "don't lose your streak" nudge. Backend tracks streak/grants with no build; the counter UI needs one. Effort: M.
- 🟡 **#3 — Affirmation-rich reactions (beyond the single like).** *Hook: esteem-grade social validation, not just approval.* Compliment-flavored reactions (🔥 Fire fit / 😍 Obsessed / 👑 Slay / 💎 Elevated), surfaced as worded affirmations in the Inbox. Backend = a reaction type on the existing `Like` model (ships now); picker + render need a build. Effort: M.
- 🟡 **#4 — Style levels & badges on the profile.** *Hook: endowed-progress effect + identity investment (raises switching cost).* A Style Level that climbs with try-ons/likes/follows + earnable badges (Trendsetter, 100-Looks Club, Fit of the Month). Computation is backend; display needs a build. Reuses `tryOnCount`/`likesCount`/`followersCount`. Effort: M.
- 🟡 **#7 — "Style Twins" & saved-look social proof.** *Hook: belonging + social comparison + reciprocity.* "3 people styled this jacket," "Your style twin: @maya," "5 people saved a look like yours." Queries are backend-only (leverages `SavedLook`); discovery surfaces need a build. Effort: M.

### Needs a new build AND a new native module (biggest lift)
- 🟡 **#6 — Validation-driven re-engagement pushes.** *Hook: unpredictable social reward delivered when the user has left — the highest-converting re-engagement message type.* "🔥 Your look is taking off — 10 people loved it." Requires adding `expo-notifications` (native) + APNs key/entitlements + a backend sender. **Interim with zero build:** nudge via the now-working SMS channel. Effort: L (incl. native + APNs setup).

---

## 2. Observability & error tracking — you're flying blind on real users now

### ✅ Sentry — React Native app integration — DONE, LIVE in 1.0.17 builds (2026-06-11)
**Status:** ACTIVE. EAS production env vars set (`EXPO_PUBLIC_SENTRY_DSN`, `EXPO_PUBLIC_SENTRY_ENVIRONMENT=production`, `SENTRY_AUTH_TOKEN` secret with write scope); source maps + dSYMs upload during the EAS build; builds 27/28 shipped with crash capture live. ⚠️ Lesson: the Sentry Expo plugin HARD-FAILS the iOS archive on a missing/under-scoped auth token (cost two builds); a read-scoped token passes GET probes but 403s on upload — verify with a throwaway release POST. 5 dashboards at bruhnfreemancom.sentry.io. _(History below kept for the trail.)_

#### (historical) 🟡→ Sentry RN integration (CODE DONE 2026-06-10; needed DSN + EAS build to activate)
**Improves:** Mobile crash tracking with stack traces, breadcrumbs, release tagging. Today you learn about crashes from 1-star reviews.
**Status:** `@sentry/react-native ~7.2.0` installed + Expo config plugin added; initialized in [App.tsx](frontend/App.tsx), **gated on `EXPO_PUBLIC_SENTRY_DSN`** (unset = no-op, `sendDefaultPii:false`, errors-only). Shipped on `main` for the 1.0.17 build.
**Remaining to actually capture crashes:** (1) create a **Sentry React Native project** (separate DSN from the backend); (2) set `EXPO_PUBLIC_SENTRY_DSN` (+ optional `EXPO_PUBLIC_SENTRY_ENVIRONMENT`) and `SENTRY_AUTH_TOKEN`/org/project as EAS env/secrets so the config plugin uploads source maps; (3) ship the EAS build. Until then it's inert.
**⤷ Update (2026-06-10 evening): DSN received and wired.** Sentry RN project exists (org `bruhnfreemancom`, project `react-native`); org/project now configured in [app.json](frontend/app.json)'s `@sentry/react-native/expo` plugin block (silences the Metro warning + enables source-map upload). DSN staged **commented-out** in the gitignored `frontend/.env` — ⚠️ do NOT enable it for the 1.0.16 dev client (no RNSentry native module → crash at init); it activates via EAS env on the 1.0.17 build. **Remaining (user, at build time):** `eas env:create --environment production --name EXPO_PUBLIC_SENTRY_DSN --value <dsn> --visibility plaintext` + an org auth token with `project:releases` as EAS secret `SENTRY_AUTH_TOKEN` for source maps.
**Effort:** S (just the Sentry project + EAS env now).

### ✅→ BullMQ failure alerts — DONE (prod, 2026-06-10)
**Improves:** Silent job failures = silent revenue loss.
**Status:** **Done.** Terminal failures in `tryon` + `apple-notifications` workers `Sentry.captureException` (DSN live on both boxes), AND the *proactive* threshold alert now exists: `queueHealthMonitorWorker` runs every 5 min and emails admins on backlog ≥ 50 / failed ≥ 20 (debounced) — **now live on prod** (was dev-only; promoted in the 2026-06-10 merge). The admin 🩺 Diagnostics tab also shows live queue depth + recent failures + "stuck >30m". *(Moved to Done — kept here briefly for the trail.)*

### ✅→ Application metrics (Prometheus) — DONE (prod, 2026-06-10)
**Status:** **Done.** `prom-client` installed; `/metrics` served ([lib/metrics.ts](backend/src/lib/metrics.ts), wired in [index.ts](backend/src/index.ts)) with process/Node defaults + HTTP latency histogram. Grafana Alloy scrapes `backend:3000/metrics` → Grafana Cloud on **both dev and prod** (the `env` label distinguishes them). Promoted to prod in the 2026-06-10 merge. **Remaining polish (🟢):** add Grok-call latency/cost + BullMQ-depth custom metrics, and SLO dashboards (see §5).

### 🟡 Mobile crash + analytics (PostHog)
**Improves:** Funnel visibility (signup → verify → first try-on → first purchase). Today only backend-side counts; no insight into where mobile users drop off.
**Status:** `posthog-react-native` not installed.
**Scope:** Add `posthog-react-native`, track key events. **Needs an app build** → bundle with §4. Do after Sentry RN.
**Effort:** M.

### 🟢 Host metrics on the **dev** box (match prod)
**Improves:** Same mem/disk visibility on dev that prod now has. Deferred from the 2026-06-08 monitoring session (prod-only by request).
**Status:** Prod ships `mem_used_percent` + root `disk_used_percent` to `CWAgent` with disk>85 / mem>90 alarms. Dev: the CloudWatch agent may not even be installed there.
**Scope:** Install/configure the agent on `evofaceflow-dev` with the same `tryon-cwagent.json` metrics block; optionally add dev disk/mem alarms (watch the 10-free-custom-metric ceiling — would push total to ~8). Lower priority since dev isn't user-facing.
**Effort:** S.

### 🟡 SMS alerting for alarms (toll-free verification + sandbox/production)
**Improves:** Routes CloudWatch/Lightsail alerts to SMS, not just email. Picked up 2026-06-08.
**Status (2026-06-10):** Toll-free `+18337624449` registration **v2 submitted and in carrier REVIEW** (v1 was DENIED 2026-06-09 for "Unofficial Business Email"; v2 uses `bruhn@tryon-mirror.ai` — ⚠️ make sure that mailbox actually RECEIVES mail before the reviewer tests it). Account still in the **SMS sandbox**. Verified destination `+14436108379` remains `PENDING` — **the OTP cannot be delivered until the toll-free number is ACTIVE** (no unregistered US SMS routes; AWS routed the code via the simulator number = blackhole). When registration approves: re-send the code via the TF number, confirm OTP, then sandbox sends to the iPhone work. Simulator pipeline works today (orig `+17015550673` → success `+14254147755` / fail `+14254147167`), and **CloudWatch event logging is live**: config set `evofaceflow-sms` → log group `/aws/sms-voice/evofaceflow` (30-day retention) — sends must pass `ConfigurationSetName`.
**⤷ Update (2026-06-08):** an **end-user SMS opt-in flow now exists** — public opt-in endpoint + `SmsOptIn` table (`0a64a02`), website opt-in page + Privacy Policy SMS-program section (`d016254`). This unblocks the toll-free verification's *original* framing: the registration can now be **substantiated as genuine app end-user opt-in** (the live opt-in page URL + the Privacy Policy SMS section are the `optInDescription` / `optInImage` evidence the carrier wants), rather than being reframed as ops-only `ACCOUNT_NOTIFICATIONS`. Routing ops alarms to the admin's own phone is then a smaller, separate add on top of the same verified toll-free number.
**Scope:** (1) finish + submit the toll-free verification using the now-live opt-in page (still missing: businessType, monthlyMessageVolume, useCaseCategory, optInType, optInDescription, **optInImage attachment** — screenshot the live opt-in page, messageSample1); (2) confirm the destination number OTP for sandbox sends, OR open the Account&Billing→Service Quotas→"SMS Production Access" support case (Basic support = console only) for unrestricted sending; (3) subscribe the phone to the `tryon-alerts` SNS topic (protocol `sms`).
**Effort:** M (mostly external carrier review latency).

---

## 3. Operational hardening

### 🟡 Prod S3 orphan cleanup — run the one-click delete (added 2026-06-12)
**Status:** The 2026-06-12 reconciliation found **116 orphaned TryOn objects (~20 MB)** in prod (`clothing-photos/` + `tryon-results/` of live users — leftovers of admin job deletes from before the fix). The upgraded scanner now sees them.
**Scope:** Admin Dashboard → Storage → Scan Now → review → **Delete Orphans**. Versioning gives a 30-day undo. Separately: **decide the legacy EvoFaceFlow `avatars/`/`videos/` data (~66 MB)** in `evofaceflow-uploads` — it belongs to the old face-swap app, is excluded from the scanner on purpose, and needs an explicit keep/delete call.
**Effort:** XS (one click) + the legacy-data decision.

### 🟡 RUNBOOK.md
**Improves:** When something pages at 2am, you (or anyone covering) have a step-by-step instead of a fresh research project — more valuable now that downtime hits real users.
**Status:** Does not exist.
**Scope:** New RUNBOOK.md. Per scenario (DB connection lost, Redis full, S3 403s, Grok rate-limited, Apple webhook signature mismatch, disk full, cert expiry, OOM, backup failed): how to detect, confirm, fix, verify.
**Effort:** M–L.

### 🟡 Lightsail instance-role for backups (replace IAM access keys)
**Improves:** No AWS secrets on disk for the backup script; auto-rotation by AWS; smaller blast radius on host compromise.
**Status:** Still using static keys in `/etc/tryon-backup.env` (confirmed).
**Scope:** Attach an inline policy to the Lightsail instance role with `s3:PutObject` on `evofaceflow-backups/postgres/*`. Remove the `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` lines from `/etc/tryon-backup.env`. Confirm a backup still runs.
**Effort:** S–M.

### 🟡 Move secrets out of `.env` into AWS SSM Parameter Store / Secrets Manager
**Improves:** Secrets stop being baked into Lightsail snapshots; centralized rotation; audit trail of access.
**Status:** `backend/src/config/env.ts` still reads from `.env`.
**Scope:** Refactor `env.ts` to read from SSM at boot with `.env` fallback for local dev. Migrate live secrets to SSM. Update IAM so the backend can read its parameters.
**Effort:** L.

### 🟢 SSM enrollment for the Lightsail boxes (Standard tier — free)
**Improves:** Fleet Inventory, Run Command, and Patch-compliance reporting across the 3 Lightsail instances. Deferred from the 2026-06-08 review (found SSM is **not** actually set up — no managed instances, no activations).
**Status:** Not enrolled. The CloudWatch agent ≠ SSM (a common mix-up).
**Scope:** Create a hybrid activation, install/register `amazon-ssm-agent` on each instance. **Caveat:** Session Manager (keyless shell) on hybrid/Lightsail needs the **paid Advanced tier (~$5/instance/mo)** — only Inventory/Run Command/Patch are free in Standard tier, so the marquee feature isn't free here. Medium value.
**Effort:** M.

---

## 4. Next EAS build bundle — anything needing a new iOS binary

Ship these together in one build to avoid multiple review cycles. **Most of the old contents of this bundle already shipped in 1.0.15** (auth frontend fixes, Privacy Manifest, in-app support link), so what remains is small:

- **Sentry React Native** — ✅ **DONE + ACTIVE** in the 1.0.17 builds (EAS env vars set 2026-06-10; see §2).
- **Splash/announcement mobile UI** (added 2026-06-12) — S, **code done on `main`**: `SplashAnnouncementModal` + Settings → Announcements toggle. Pure JS (no new native module), but App Store users only get it with the next binary/OTA — until then the prod backend's splash endpoints are simply ignored by shipped clients. Splash mobile UI **shipped in the 1.1.0 build** (Closet/Outfit Designer release). Bundle remaining UI items with 1.2.0.
- **PostHog analytics** (§2) — M. **Missed 1.0.17** (decision defaulted to no during the build night) → needs its own EAS build; bundle with the pinch-zoom re-add in 1.2.0.
- **Privacy Manifest** — ✅ already in [app.json](frontend/app.json) (`privacyManifests` block).

**1.0.17 build also carries:** the full-screen carousel pinch-zoom *removal* (bug fix), 2.5s try-on polling, and `@sentry/react-native` native module. Test in TestFlight (release build) before submitting — see §6.

**Planned additions (2026-06-10, see §1.5):** A1 simplified email+password-only signup, A2 photo upload tips, A3 image-resolution warning — bundled so the 1.0.17 review cycle carries real feature value instead of just the zoom fix.

**Sequencing note:** backend refresh-token rotation (§1) is DONE and live — it never needed a build (the fix was server-side; the shipped app already persists rotated tokens).

---

## 5. Scale-dependent (P2 — defer until usage justifies)

- 🟡 **Managed Postgres (RDS / Lightsail Managed DB)** — PITR, failover, auto-patching. Migrate when single-instance latency starts mattering. Effort: L.
- 🟡 **Postgres read replica** — offload heavy admin-dashboard aggregations. After managed Postgres. Effort: M.
- 🟡 **WAF (Cloudflare free tier / AWS WAF)** — OWASP top-10, bot mitigation, DDoS absorption. Effort: M.
- 🟡 **Blue/green deploys** — eliminate the ~30s 502 window on `docker compose up -d --build`. Invisible at low usage; user-visible at ~100 RPS. Effort: L.
- 🟡 **SLO definition + Grafana dashboards** — error budget on top of the §2 metrics. Effort: L.
- 🟡 **Independent security review / pentest** — third-party validation once real PII is at scale. ~$5–15k. Effort: L.
- 🟡 **Centralized admin audit log** — `AdminAction` model recording who did what (toggled subs, deleted users, resolved reports) to an append-only/Object-Lock store. Effort: M.
- 🟡 **Secret rotation runbook (quarterly)** — document + calendar the rotation of JWT secrets, admin key, AWS keys. Pairs with RUNBOOK.md. Effort: S.

---

## 6. Known bugs / minor issues

### ✅ PurchaseScreen false "Purchase confirmed" on backend rejection — FIXED, rides 1.0.17 (2026-06-11)
**Context (Jim Morris incident, 2026-06-11):** `iap.ts verifyAndFinish` swallows a `verify-receipt` failure (`fastPathSkipped: true`), finishes the StoreKit transaction anyway, and PurchaseScreen showed an unconditional "Purchase confirmed" — banking on the webhook safety net. When the webhook ALSO failed (sandbox notification → dev box with a broken `APPLE_ROOT_CERTS_DIR`), the buyer saw success and never got credits.
**Fix:** the `fastPathSkipped` branch in [PurchaseScreen.tsx](frontend/src/screens/PurchaseScreen.tsx) no longer claims success up front — it polls the user's credits/tier (6 × 2.5s) and shows "Purchase complete" only when the change actually lands; otherwise an honest "Purchase received — still processing" alert with refresh/Restore/support guidance. Backend half (dual-environment verification + Sentry paging) shipped same day.

### 🟢 Node 22 upgrade (AWS SDK v3 deprecation)
**Improves:** Future-proofs against the early-2027 AWS SDK requirement of Node 22+.
**Status:** Dockerfile still on `node:20-slim` / `node:20-alpine` (all three stages).
**Scope:** Bump the [backend/Dockerfile](backend/Dockerfile) base images 20 → 22. Build on dev, confirm Prisma + Sharp + all native modules still compile, then prod.
**Effort:** M.

### 🟡 Re-add pinch-to-zoom to the full-screen image viewer (the right way)
**Context:** v1.0.16 added pinch-to-zoom by wrapping each carousel image in a nested zoomable `ScrollView` (`centerContent` + `maximumZoomScale`) inside the outer horizontal **paging** `ScrollView` ([FullScreenImageModal.tsx](frontend/src/components/FullScreenImageModal.tsx), commit `9f91675`). In **release/Hermes** builds this raced the layout: odd-aspect images — especially the clothing screenshot at **carousel slot 3** (aspect ~0.46 vs ~0.75 for the body/result images) — opened **shifted "out of frame"** until touched. It reproduced on the App Store / TestFlight build but **NOT** the Expo dev client (the dev client's slower, instrumented timing settled layout before the offset applied, masking it) — a classic "works in debug, breaks in release" trap. v1.0.17 removed the nested ScrollView (renders `RetryableImage` directly) to fix the bug, which **temporarily drops zoom**.
**Status:** Zoom removed in v1.0.17; needs a proper re-implementation.
**Scope:** Implement pinch / double-tap zoom with `react-native-gesture-handler` + `react-native-reanimated` — **not** a nested `ScrollView`. Gate the pinch gesture so the outer carousel only pages at scale 1, and reset scale on page change. **⚠️ Dependency note (verified 2026-06-10):** only `react-native-reanimated` (~4.1.1) is in [frontend/package.json](frontend/package.json) — **`react-native-gesture-handler` is NOT installed** (the prior "already installed" note was wrong). You'll need to `npx expo install react-native-gesture-handler` (a native module → new EAS build) before this can ship.
**⚠️ Validate in a RELEASE build (TestFlight), not just the dev client — the dev client will pass even if the bug is still present.**
**Effort:** M.

---

## 7. Documentation / verification tasks

### ✅ Reset Location History admin endpoint — DONE (dev + prod, 2026-06-10)
`DELETE /api/admin/user/:userId/clear-locations` deletes all `UserLocation` rows for a user (404 on unknown id); a "Clear History" button in the user-detail modal's Login Locations section calls it. No more SSH + psql DELETE. Verified on dev (deleted 10) and prod (deleted 2).

### 🟢 Keep CLAUDE.md / docs in sync with the dev-environment + live-app reality
**Improves:** Single source of truth. The dev/prod split and live status are now load-bearing facts.
**Status:** Mostly current; periodic drift check.
**Scope:** Periodic re-read; update the "Last reviewed" date when you do. Remember `npm run build:docs` after any tracked `.md` edit.
**Effort:** S.

---

## 8. Optional / defensive (suggested, not committed to)

- 🟢 **AWS Rekognition moderation on AI outputs** — belt-and-suspenders on Guideline 1.1.4 if xAI filters ever miss. Quarantine flagged results for admin review. Effort: M.
- 🟢 **Explore AWS Rekognition as an image filter (added 2026-06-13)** — investigate using Rekognition (`DetectModerationLabels` for unsafe content; `DetectLabels`/`DetectFaces` for "is this a usable clothing/body photo?") as a programmatic filter on **inputs** as well as outputs. Two candidate uses: (1) a pre-Grok safety/quality gate on uploaded clothing + body photos (reject NSFW or junk before a credit is spent), complementing the existing input denylist + xAI filters; (2) the person/clutter detection that the §1.5 **B2 outfit enhancer** already flagged (`DetectLabels` "Person" → auto-trigger the clean-up pass). Scope the exploration: accuracy on our real photos, cost (~$0.001/image), latency, and where in the pipeline it belongs (frontend pre-check vs. backend pre-Grok). Decide build-vs-buy vs. leaning harder on Grok's own filters. Cross-refs: §8 output-moderation item above, §1.5 B2, and the Content Moderation section in CLAUDE.md. Effort: M (investigation first).
- 🟢 **docs/ HTML polish** — GitHub Pages publish, dark mode (`prefers-color-scheme`), favicon/logo, search index (Pagefind/Lunr). All cosmetic. Effort: S each.
- ✅ **DONE (2026-06-17) — deleted the two noisy billing alarms** (`BillingAlarm` $50 + `BillingAlarm1` $30, both permanently in ALARM = alert fatigue). The `MyMonthlyBudget` ($100) + `TryOn-Monthly-Cost` ($150) budgets remain as the real cost guards.

---

## 9. 🏗️ Architecture & scaling strategy — future readiness (BACKLOG, not now)

> Captured 2026-06-17 from an architecture/cost review. The app is small; these are deliberately **deferred**. Purpose: (a) confirm the current direction is sound, and (b) define the data-driven triggers + migration order so future scaling is a *planned project, not a panic*. **TL;DR: staying on Lightsail now is the right call; you are NOT locked in; peel the AI pipeline off to serverless first when load justifies it.**

**The core architectural fact** — this is two very different workloads in one monolith:
1. A **lightweight social CRUD app** (feed, profiles, likes, comments, follows, notifications, auth, IAP) — steady, cheap, latency-sensitive.
2. A **heavy, bursty, slow AI job processor** (try-on/outfit/cleanup images ~10–30s; **video 1–6 min**) — BullMQ workers that mostly **idle-wait on the xAI Grok API**.

They scale differently → reason about them separately. Don't "migrate the whole thing"; peel off the AI tier first.

### Is Lightsail the right base? Yes for now — low lock-in
- Built on **portable primitives**: app is Docker (→ ECS/EC2 unchanged), DB is stock Postgres (→ `pg_dump` to RDS), Redis is stock, **storage is already S3** (zero migration), nginx config is portable. Leaving Lightsail later is "redeploy the same containers + migrate the DB," not a rewrite. **Starting Tier A on Lightsail is not over-investing.**
- Lightsail ceilings that eventually force a move: **no autoscaling**; instance cap ~8GB/2vCPU; managed DB caps at 32GB and **can't resize in place**; thin networking/managed-service menu.

### Your cost driver is NOT compute
The monthly bill is dominated by **Grok API calls + S3 storage/egress**, NOT the ~$12/mo app box. So serverless/re-platforming saves little on the bill *today* — its value is **burst-scaling + ops**, not cost. Don't re-platform expecting savings.

### Serverless ("computeless") opportunities — ranked
1. 🟡 **AI job pipeline → AWS Step Functions + Lambda (the one real win).** Workers hold a slot up to 6 min idle-waiting on Grok = always-on paying to wait. Replace with: Lambda submits to Grok → Step Functions Wait/poll loop → Lambda finalizes to S3/DB. Pay per state transition + a few Lambda ms (not the wait); scales to any burst. *(Don't use a single 6-min Lambda — that pays for the wait.)* **First slice to peel off the monolith.** Effort: M–L.
2. 🟢 Image/video resize (`sharp`) → S3-event Lambda. Offloads CPU spikes. Effort: S–M.
3. 🟢 Scheduled jobs (guest cleanup, vuln/orphan scans) → EventBridge Scheduler + Lambda instead of BullMQ cron. Effort: S.
4. 🟢 Static surfaces (website, `/t/` share pages) → S3 + CloudFront. Tiny. Effort: S.
- **Keep the API tier on containers, NOT Lambda.** A latency-sensitive social feed + queue model is a poor Lambda fit (cold starts, long-lived connections). When you outgrow Lightsail, the API's home is **ECS Fargate** (serverless containers, autoscaling, the existing Docker image).

### The DB is the piece worth "investing ahead" on
Data is the hardest to migrate + the biggest current SPOF (single disk, single AZ, on the app box). Get it onto a managed, HA, backed-up engine early:
- **Lightsail Managed DB (HA)** — cheapest/simplest; caps at 32GB, no read replicas / in-place resize.
- **RDS Postgres (Multi-AZ)** — pricier, but the path to scale (read replicas for feed reads, bigger instances, PITR); most defensible "build for the future" choice since the DB is the painful one to move later.
- Neither is a one-way door (both `pg_dump`/restore). Lean: start Lightsail Managed DB HA unless read-replica / 30GB+ needs are already in sight → then RDS.

### HA cost tiers (live Lightsail list prices, pulled 2026-06-17)
Current prod = 1× 2GB box ($12/mo), single AZ, all-in-one = **the SPOF**.
- **Tier A-Lean ≈ $79/mo** — managed PG HA 1GB ($30) + 2× app 2GB ($24) + Lightsail LB ($18) + 1× dedicated Redis ($7). True HA (survives instance/AZ/DB failure) + PITR. *Redis is single = lower-stakes SPOF (queue loss ≠ data loss).*
- **Tier A-Comfortable ≈ $140–152/mo** — managed PG HA 2GB ($60) + 2× app 4GB ($48) + LB ($18) + Redis (dedicated $12 or ElastiCache Multi-AZ ~$26). **Lean→Comfortable is easy / near-zero-downtime** (LB-fronted stateless app nodes; the DB is the only brief-cutover piece, same snapshot/restore as initial setup → no lock-in).
- **Tier B — AWS-native HA** (ECS Fargate + RDS Multi-AZ + ElastiCache + ALB): ~$150–300/mo + a migration project. Adds autoscaling. Worth it once Lightsail ceilings bite.
- **Tier C — multi-region DR**: ~$300–600+/mo + major complexity. Overkill at current scale.
- ⚠️ **Lightsail has no managed Redis** — the awkward HA piece: single dedicated instance (cheap, SPOF) vs ElastiCache (AWS-native, Multi-AZ). Everything else (DB/app/AZ) gets real HA in Tier A.

### Recommended path + migration triggers (make it data-driven, not vibes)
1. **Now:** Tier A-Lean on Lightsail — the high-value piece is getting the DB off the single box. (Pairs with the §0 roadmap + a managed-PG cutover runbook.)
2. **First serverless move (when worker load/cost is real):** lift the AI pipeline to Step Functions + Lambda.
3. **Re-platform API → Fargate / DB → RDS when a trigger fires:** sustained API CPU >~60% across both LB nodes; OR DB nearing the 32GB ceiling / needing read replicas; OR worker queue depth / idle-wait cost climbing (→ do the serverless AI pipeline).

Cross-refs: §0 launch-readiness roadmap, §5 scale-dependent, §1.5 B2 (outfit enhancer overlaps the image-Lambda idea), CLAUDE.md → Infrastructure.

---

## ⚠️ Do NOT do

### ⛔ ATT (App Tracking Transparency) no-op — DO NOT ADD
Tried in a v1.0.15 build, immediately rejected by App Store Connect's automated scanner. Apple treats the *presence* of `NSUserTrackingUsageDescription` as a declaration of intent to track, regardless of whether the app calls `ATTrackingManager`. There is no "no-op." We don't track → no `NSUserTrackingUsageDescription`, no `expo-tracking-transparency` plugin, `NSPrivacyTracking: false` (already correct in [app.json](frontend/app.json)).

### ⛔ nginx → stdout logging for CloudWatch — DO NOT ADD
Previously floated as "Option A" to pull nginx access/error logs into CloudWatch via the agent. **Rejected on purpose:** fail2ban reads nginx logs from the shared `nginx_logs` Docker volume ([docker-compose.prod.yml](docker-compose.prod.yml#L100) — `nginx_logs:/var/log/nginx:ro`). Routing nginx to `/dev/stdout` would empty those files and blind every fail2ban jail (404-flood, no-php, wordpress, badbots, auth bans). Keeping fail2ban working is the priority. If nginx logs are ever wanted in CloudWatch, do it *additively* (e.g. a sidecar that tails the files) — never by redirecting nginx away from the volume fail2ban depends on.

---

## ✅ Done

### Engagement & growth feature batch — branch `feature/enjoyment` (2026-06-13)
Six brainstorm features built on `feature/enjoyment` (one commit each for easy rollback), all typechecked + tests green; **NOT yet merged/deployed** (app pieces ride 1.2.0). See CLAUDE.md → Engagement & Growth Features.
1. **Share a try-on** — public `GET /t/:jobId` page (OG/Twitter meta) + `GET /api/share/:jobId(/image)` + feed share button. Web/backend half needs no app review.
2. **Outfit Designer "Surprise me" + style/occasion chips** — pure UX, no moderation-surface change.
3. **Compare Looks** — split-screen of two past try-ons (Profile menu).
4. **Referral program** — `User.referralCode` + `Referral` model; `referralCreditGrant` admin setting (default 5); reward both sides at the referred user's verification; `GET /api/referral/me`; ReferralScreen + signup code field.
5. **Saved Looks** — `SavedLook` model; `GET/POST/DELETE /api/looks`; SavedLooksScreen + feed bookmark.
6. **Public `/api/config`** driving the dynamic join-offer copy.
**Pending before these go live:** (a) merge `feature/enjoyment` → develop; (b) `prisma migrate deploy` applies **two additive migrations** (`add_referrals`, `add_saved_looks`) — safe/backward-compatible; (c) deploy dev backend to runtime-verify share/referral/looks/config endpoints (only typecheck + unit tests so far — not yet exercised against a live DB); (d) the 1.2.0 EAS build for the app-side UI. **Versioning bumped to 1.2.0.**

### SMS toll-free live (2026-06-13)
Toll-free `+18337624449` registration APPROVED + number ACTIVE. Verified the user's destination (`+14436108379`) in the sandbox and sent end-to-end test ("Your OTP is: 7777") + a "Question?" page — both delivered & confirmed by the user. Still **SANDBOX tier** (verified destinations only; production access = a Service Quotas support case). **US toll-free has no alphanumeric sender ID** — recipients see the number, not "EvoFaceFlow". Paging channel established: text body "Question?" pings the user. See memory project-sms-setup.

### Admin-configurable welcome bonus ("join offer") + dynamic offer copy (2026-06-13)
Made the email-verification welcome bonus (the "free credits when you join" offer) admin-tunable at runtime, mirroring the guest-credit setting. New `AppSettings.signupCreditGrant` (default 10, 0–1000; **0 = discontinue the offer**) read via `getSignupCreditGrant()`; `authController.verifyEmail` reads it and skips the grant + GRANT transaction when 0. Admin Dashboard → ⚙️ Settings gained a **"Welcome Bonus Credits (join offer)"** field (`GET /api/admin/settings` extended; new `PATCH /api/admin/settings/signup-credits`). New **public** `GET /api/config` endpoint (`routes/config.ts`, unauthenticated like `/api/splash`) returns `{ signupCreditGrant, signupCreditsOffer }`; the app fetches it on launch (`store/useConfigStore.ts`, wired in `navigation/index.tsx`) and renders **"Limited time offer: N free credits when you join"** dynamically on `GuestPromptScreen`, `GuestProfileScreen`, `HomeScreen` guest banner, `PurchaseScreen`, and `AboutScreen` — hiding the offer when 0. Backend tsc + 95 tests green; frontend tsc green. CLAUDE.md (Free credit policy, AppSettings, admin endpoints) updated. ⚠️ **Dynamic copy rides 1.2.0** — keep the grant at 10 while ≤1.1.0 is the live build (those builds, incl. the 1.1.0 TestFlight build, hardcode "10 Free Credits", so a different grant would mis-advertise). The evofaceflow→tryon-mirror rebrand was also re-audited this session: **clean** — every remaining `evofaceflow` string is intentional infra (bundle id, IAP SKUs, the real `evofaceflow-uploads` bucket, legacy-domain fallbacks during migration), no stray user-facing brand text.

### 1.0.17 feature wave — signup, tips, low-res guard, worker resilience, web dashboard, tests, CI (2026-06-10)
One working day, all on `develop`, all validated on dev (prod untouched):
- **A1/A2/A3 binary items:** email+password-only signup (guest keeps `user#######`; website too), UploadTipsSheet on all upload surfaces, low-resolution warning before clothing/body uploads.
- **Worker resilience:** per-perspective outcomes — partial moderation block completes with survivors (no strike); transient failure on the final attempt also completes with survivors **+ refunds the credit + stores a user-facing note** on the COMPLETE job (rendered by ResultView); all-blocked = CONTENT_MODERATED with a 3-warning refund grace window; all-failed = ordinary refund, no strike. Admin email on every terminal failure + every partial (`sendTryOnFailureAlert`).
- **B1 new-user email** from `verifyEmail` (found dev's missing `ADMIN_EMAILS` in the process — set).
- **D1+ web try-on dashboard** live on dev (see §1.5 D1+).
- **Auth race fix:** `sessionExpired` idempotent + session-kind read before bootstrap call (stuck-on-feed bug after the dev wipe).
- **Test infra:** backend logic extracted into pure modules (`validation/authSchemas`, `utils/moderationGrace`, `utils/htmlEscape`) with 28 new tests (72 total); **jest-expo** set up in frontend with 14 tests (low-res guard incl. Android-dismiss, sessionExpired race). Review pass found + fixed: email-HTML injection of error text, web dashboard false empty-state, Android alert-dismiss hang.
- **Enterprise safeguards:** tests-only **GitHub Actions CI** (backend tsc+tests, frontend tsc+jest, committed-`ENV='prod'` guard, advisory npm audit) + **Dependabot** (weekly, grouped). Deploys remain manual by policy.

### Full develop→main promotion to prod (2026-06-10)
Merged the entire `develop` backlog into `main` (`cfb17b4`) and rebuilt the prod backend, promoting everything that had accumulated as dev-only or staged. Now **live on prod**: presigned-URL cache (A1), proactive queue-health monitor, `/metrics` (scraped by Alloy → Grafana Cloud), the 1.0.17 frontend changes (pinch-zoom removal, 2.5s try-on polling), and the new guest-credit admin setting (below). One merge conflict (`frontend/package-lock.json`) resolved in favor of develop; merged tree type-checked + 44 backend tests passed before push. No schema changes (migrate-deploy was a no-op). The Cloudflare real-IP nginx block landed on disk in prod but nginx was **deliberately not force-recreated** (still grey → inert); activate at orange-cloud cutover. `/health` 200 on both boxes after deploy.

### Guest welcome-credit admin setting (2026-06-10)
Made the guest first-open free-credit grant admin-configurable at runtime instead of a hardcoded constant. New `AppSettings.guestCreditGrant` (default `DEFAULT_GUEST_CREDIT_GRANT=2`, bounded 0–1000) read via [appSettingsService.ts](backend/src/services/appSettingsService.ts) `getGuestCreditGrant()` in `authController.createGuest`; admin endpoints `GET /api/admin/settings` + `PATCH /api/admin/settings/guest-credits`; new **⚙️ Settings** tab in the admin dashboard. Only affects newly created guests. Verified end-to-end on dev (GET→2, PATCH→5 persisted, reset→2) and prod (GET→2). Docs (CLAUDE.md guest-mode/AppSettings/admin endpoints) updated.

### Sentry backend SDK + Admin "🩺 Diagnostics" tab — dev (2026-06-08)
Integrated `@sentry/node` (v10) into the backend, **gated entirely on `SENTRY_DSN`** (unset = no-op, so it ships dark on both boxes and switches on per-environment with zero code change). [instrument.ts](backend/src/instrument.ts) inits before Express (verified first in the compiled `dist/index.js`); `Sentry.setupExpressErrorHandler` catches 5xx; the SDK's default integrations catch unhandled rejections/exceptions; and **terminal** failures in the `tryon` and `apple-notifications` workers `captureException` (content-moderation blocks excluded — policy, not error). PII scrubber ([utils/scrub.ts](backend/src/utils/scrub.ts)) wired as `beforeSend`, **unit-tested** (`npm test`, 9 tests, Node's built-in runner). New admin endpoints: `GET /diagnostics`, `GET /sentry/status`, `GET /sentry/issues`, `POST /sentry/test`. New **🩺 Diagnostics** dashboard tab: dep latency, queue depth + recent worker failures, integrations grid, config flags, 24h job throughput w/ "stuck >30m" counter, 7d credit economy, and a Sentry card (status + test button + recent-issues feed). Docs updated (CLAUDE.md Observability section, DEPLOYMENT.md §9 Sentry setup, `.env.example`, both compose files). **Bugs found + fixed in passing:** (1) the scrubber's regex didn't redact the **`x-admin-key`** header (admin key would have leaked to Sentry) — caught by a unit test, fixed by adding `admin` to `SENTRY_KEY`; (2) a pre-existing **`qs`/`express` moderate DoS** vuln — cleared via `npm audit fix` (express 4.22.2 / qs 6.15.2, 0 vulns). **Follow-up — DONE (2026-06-08):** the Sentry project was created and `SENTRY_DSN` is now set on **both dev and prod** `backend/.env`, so error capture + paging is **live** on both boxes (no longer shipping dark). _(Note: CLAUDE.md's "Error Tracking & Observability (Sentry)" section still says "prod and dev both run with `SENTRY_DSN` unset = disabled" — that line is now stale and should be corrected.)_

### Free AWS monitoring buildout — Lightsail alarms, host metrics, dashboard (2026-06-08)
Enabled the no-cost monitoring layers after an account review:
- **6 Lightsail instance alarms** (free) on prod + dev: `status-check-failed`, `cpu-high` (>80%/10m), `burst-capacity-low` (<20%/10m). These are Lightsail-native (not CloudWatch) and notify via a new Lightsail **Email contact method** (`bruhn@bruhnfreeman.com`, confirmed). Catches the burstable-instance failure modes (CPU-credit exhaustion, instance unreachable) that the app-level alarms can't see.
- **Host metrics via the existing CW agent** (prod): added a `metrics` block shipping `mem_used_percent` + root `disk_used_percent` to namespace `CWAgent` (3 custom metrics; 5 total, inside the always-free 10). Required adding inline IAM policy `tryon-metric-put-only` (`cloudwatch:PutMetricData` scoped to namespace `CWAgent`) to user `tryon-log-shipper` — the agent was getting `AccessDenied` without it. Also cleaned up a duplicate agent config file in `.d/` (moved canonical source to `…/etc/tryon-cwagent.json`).
- **2 CloudWatch host alarms** → SNS `tryon-alerts`: `tryon-prod-disk-high` (>85%) and `tryon-prod-memory-high` (>90%).
- **CloudWatch dashboard `TryOn-Prod`** (free): host mem/disk + app error/FATAL + alarm-status widget in one pane.
DEPLOYMENT.md §9 updated with all of the above (config, IAM, foot-guns, alarm table, dashboard). **Still optional/not done:** host metrics on *dev* (agent may not be installed there), network metrics, and SSM enrollment (Standard tier free for Inventory/Run Command/Patch; Session Manager on Lightsail needs the paid Advanced tier).

### CloudWatch alarms + log-shipping fix — prod live (2026-06-08)
Created two alarms (region us-east-1, account 165341015574), both → SNS topic `tryon-alerts`:
`tryon-backend-error-rate` (metric filter `tryon-backend-errors` on `/tryon/host-containers`, Sum `BackendErrorCount` > 10 / 5 min) and `tryon-postgres-fatal` (filter `tryon-postgres-fatal`, `PostgresFatalCount` > 0 / 5 min). **Email subscription confirmed (2026-06-08)** — `bruhn@bruhnfreeman.com` is confirmed on the `tryon-alerts` SNS topic, so both alarms now actually deliver email.
While validating, found + fixed two things: (1) the previously-documented filter pattern `level\":\"error` is **rejected** by CloudWatch — the Docker json-file driver double-escapes the logs, so the working pattern is the quoted/escaped `"\\\"level\\\":\\\"error\\\""` (validated against a real error). (2) **Postgres logs hadn't reached CloudWatch for ~30 days** — the agent's `log_stream_name` used an unsupported `{file_basename}` token that shipped literally, funnelling all containers into one mis-named stream and dropping low-volume postgres. Fixed by switching to `{instance_id}-{hostname}` + `fetch-config -s`; verified postgres `checkpoint`/`LOG:` now ship. Metric filters are group-scoped, so one combined stream is fine. DEPLOYMENT.md §9 updated to match (agent config, foot-gun note, live-alarm commands). Old config backed up on the host as `…file_amazon-cloudwatch-agent.json.bak-20260608`.

### SSL_CERTIFICATE scan type — dev + prod live (2026-06-07)
`scanSslCertificate()` in [vulnerabilityService.ts](backend/src/services/vulnerabilityService.ts) connects to each host in `SSL_SCAN_HOSTS` (default `api.tryon-mirror.ai`) via Node's `tls` module (no `openssl` binary dependency), reads the peer cert expiry, and writes a `VulnerabilityReport` (scanType `SSL_CERTIFICATE`) with severity from days-until-expiry (≤7 critical, ≤14 high, ≤30 moderate). Wired into `runAllScans()` (so the existing daily 2AM scan covers it) and `getLatestReportSummary()`. Admin dashboard gained a "🔒 SSL Certificate" card with a dedicated renderer showing per-host days-remaining + issuer. No migration (the enum value already existed in the DB). Verified by an immediate scan on **both dev and prod** — each reported `api.tryon-mirror.ai`, 50 days, Let's Encrypt.

### CloudWatch Logs documented in DEPLOYMENT.md (2026-06-07)
New "CloudWatch Logs & Alarms" subsection in [DEPLOYMENT.md](DEPLOYMENT.md) §9, written from the **actual prod host config** (read read-only over SSH): agent ships `/var/lib/docker/containers/*/*-json.log` → log group `/tryon/host-containers`; creds via `/etc/aws/credentials` profile `AmazonCloudWatchAgent` (IAM user `tryon-log-shipper`, account `165341015574`); config applied via local file (`fetch-config -c file:`), logs-only (no metrics section). Includes agent-management commands, a rebuild-from-snapshot recipe, and the do-not-route-nginx-to-stdout warning. (Alarm **creation** is still open — see §2; the runbook for it lives in the same doc section.)

### nginx admin allowlist — verified already live in prod (2026-06-07)
Was tracked as "code-complete on develop, pending prod deploy," but inspection on 2026-06-07 found it **already deployed**: the running prod nginx container has `allow 47.230.244.171; deny all;` in both `location = /admin` and `location /api/admin` (shipped with the v1.0.16 merge/deploy). Verified functionally: `/admin` → `200` from the allowlisted IP, `/api/admin/stats` (no key) → `403`. No action was needed.

### Postgres restore test on dev (2026-06-07)
Validated the nightly `pg_dump` backups are actually restorable. Pulled the latest dump (`20260607T020001Z.sql.gz`) from `s3://evofaceflow-backups/postgres/`, safety-dumped the dev DB first, restored onto dev Postgres per DEPLOYMENT.md §10.4 (adapted to `docker-compose.dev.yml`) — **0 errors, clean exit** (the `--no-owner` dump restored fine as `tryon_dev`). The dump predated the v1.0.16 prod deploy, so `prisma migrate deploy` correctly applied the 2 pending migrations afterward — validating that step too. After-restore counts matched prod (10 users / 49 jobs / 147 credit-tx) and `/health` was green. A dev safety dump remains on the box (`/home/ubuntu/dev_safety_*.sql.gz`) for optional rollback; dev now holds prod data by design.

### Backend memory ceiling 512M → 1G + `NODE_OPTIONS` — prod live (2026-06-05)
Backend `deploy.resources.limits.memory` raised to `1G` and `NODE_OPTIONS=--max-old-space-size=896` set in both [docker-compose.prod.yml](docker-compose.prod.yml) and [docker-compose.dev.yml](docker-compose.dev.yml), so V8 GCs hard before the container OOM-kills under Sharp/libvips bursts. Verified in prod (`printenv NODE_OPTIONS` → `--max-old-space-size=896`).

### Deep `/health` (Postgres + Redis probes) — prod live (2026-06-05)
[index.ts](backend/src/index.ts) now serves a deep `/health` that probes Postgres (`SELECT 1`) + Redis (`PING`) in parallel with a 2s timeout each, returning 503 + per-dependency status when degraded — and a shallow, dependency-free `/health/live` for the Docker liveness probe (both compose healthchecks repointed to it, so a transient dep blip can't make Docker kill a healthy backend). Verified in prod: `{"status":"ok","dependencies":{"postgres":"up","redis":"up"}}`. UptimeRobot now catches dependency outages, not just a dead process.

### Refresh-token rotation + reuse detection — ON in dev + prod with crash-grace (2026-06-10)
Rotation + reuse detection (revoke the token family on replay) and a unique `jti` per refresh token live in [authController.ts](backend/src/controllers/authController.ts) + [auth.ts](backend/src/middleware/auth.ts), gated behind `REFRESH_TOKEN_ROTATION`. Originally shipped 2026-06-05 with the flag OFF in prod because enabling strict rotation logged out any client that force-closed in the gap between the server rotating and the client persisting the new token. **Fixed 2026-06-10 with a successor-aware grace** (migration `add_refresh_token_rotation_grace` adds `rotatedAt` + `replacedByToken`): a rotation now tombstones the old row, and a replay whose successor was never itself used is recovered with a fresh token (`logSecurity('refresh_token_grace_recovery')`) instead of revoking — while a replay whose successor already advanced is still treated as theft and revokes the family. Safe for every shipped client (even one that never persists the rotated token keeps working via repeated grace recovery) and a net gain over OFF (30-day stolen-token validity). **Flag flipped ON in both `docker-compose.dev.yml` and `docker-compose.prod.yml`** and validated end-to-end on both boxes (normal rotation, reuse→401+revoke, grace recovery→200). Revert with `"false"` + redeploy.

### Sentry React Native (gated) + clear-locations admin endpoint (2026-06-10)
Two smaller items bundled for the 1.0.17 backend deploy + app build: **(1)** `@sentry/react-native ~7.2.0` + Expo config plugin, initialized in [App.tsx](frontend/App.tsx) gated on `EXPO_PUBLIC_SENTRY_DSN` (no-op until a DSN is set; `sendDefaultPii:false`, errors-only) — needs a Sentry RN project DSN + EAS source-map env to capture crashes. **(2)** `DELETE /api/admin/user/:userId/clear-locations` + a "Clear History" button in the user-detail modal, replacing the SSH+psql workaround. Both deployed; clear-locations verified on dev + prod.

### App approved & published — 1.0.16 LIVE; 1.0.17 prepping (2026-06-10)
Apple's Guideline 2.1 Face Data info request was answered and the app was approved. **As of 2026-06-10, 1.0.16 is approved + published (live) on the App Store**; 1.0.15 before it. **1.0.17 is now prepping for submission** (repo + both `package.json`s + `app.json` at 1.0.17). The refresh-token-rotation flip is no longer gated on this — the shipped app (≥1.0.15) already persists rotated tokens, so it's safe regardless of version adoption (see §1).

### Auth: rotation-forward-compat + graceful session-expiry redirect (shipped in 1.0.15)
[frontend/src/config/api.ts](frontend/src/config/api.ts) now (a) persists a rotated `data.refreshToken` when the backend returns one (falling back to the existing token), so the live app is ready for backend rotation, and (b) calls a registered `onAuthFailure` handler on an irrecoverable 401 that drops in-memory auth state (navigator routes to Login) and shows a "Session expired" alert. Single-flight refresh queue prevents stranded requests. **Backend rotation itself is still open — see §1.**

### Privacy Manifest (PrivacyInfo.xcprivacy) — shipped in 1.0.15
Full `privacyManifests` block in [frontend/app.json](frontend/app.json): `NSPrivacyTracking: false`, required-reason API declarations (UserDefaults CA92.1, FileTimestamp C617.1, SystemBootTime 35F9.1, DiskSpace E174.1), and collected-data-type declarations (email, name, userID, photos, other content, coarse location, purchase history, deviceID — all linked, none tracking).

### In-app Contact Support link — shipped in 1.0.15
Settings → Help → "Contact Support" opens `mailto:support@tryon-mirror.ai` ([SettingsScreen.tsx:226](frontend/src/screens/SettingsScreen.tsx#L226), `SUPPORT_EMAIL` in [legal.ts](frontend/src/constants/legal.ts)).

### Separate dev environment
`develop` branch → `api-dev.tryon-mirror.ai`, with `docker-compose.dev.yml`, `nginx/nginx.dev.conf`, and `eas.json` in the repo. Lets prod-affecting backend/nginx changes be validated before touching the live stack.

### CloudWatch Logs agent (log shipping)
The CloudWatch agent is installed on the prod host and shipping container logs. (Alarms, DEPLOYMENT.md docs, nginx-stdout routing, and per-service groups remain open — see §2.)

### Redis eviction policy: `allkeys-lru` → `noeviction` (2026-06-05)
`--maxmemory-policy noeviction` on the `redis` service in both `docker-compose.prod.yml` and `docker-compose.dev.yml`. Prevents BullMQ from silently dropping queued try-on jobs (and the credit-deduct-without-refund failure mode) if Redis hits its 256mb cap — an over-limit write now fails loudly. Takes effect on redis container restart.

---

## Maintenance of this file

- When you complete an item, move it to `## ✅ Done` (or delete it — git history preserves it).
- When something new is deferred mid-conversation, add it with the same template.
- Re-scan monthly: are 🟠 items still 🟠, or has urgency changed?
- Run `npm run build:docs` after editing this file.

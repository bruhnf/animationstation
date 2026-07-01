# Release Notes

## v1.3.0 (develop) — pending build

**Theme:** AI **Video** (image-to-video), a bottom-nav expansion, plus the try-on captions / web-gallery / anti-farming work from the 1.2.0→1.3.0 window.

> ⚠️ **Native rebuild required.** This version adds `expo-video` (a native module) for video playback — a JS reload will NOT pick it up; cut a fresh dev-client / EAS build to test. **Backend migrations:** `add_tryon_title`, `add_email_normalized`, **`add_video_jobs`** (adds `tryon_jobs.kind`/`videoUrl`/`motionPrompt`, makes `clothingPhoto1Url` nullable). Run `prisma migrate deploy` as usual.

**AI Video (image-to-video)**
- **New "Video" screen + tab.** Animate a source image — a completed try-on, a camera-roll photo, or a profile body photo — into a short clip via a motion prompt ("wave and smile", "do a slow spin", "morph into a cat"). Add a caption, keep it public or private — same rules as still images, with the ✨ AI-generated badge. Powered by xAI Grok Imagine video (`POST /v1/videos/generations`, polled to completion).
- **Bottom bar expanded to 7 items:** Home, Friends, **Design** | TryOn | **Video**, Inbox, Profile. "Design" opens the Closet / Outfit Designer. "Animate a Photo (Video)" also added to the 3-dot menu everywhere. Guests get a sign-up prompt on Design/Video.
- Public videos appear in the **Home feed** and on **profiles** with a ▶ play overlay (poster = the source image); tap to play full-screen. Shareable via the `/t/<id>` page (renders an inline `<video>` + OG video meta).
- **Economics:** each video costs **2 credits** by default (admin-tunable via Admin → Settings → Video Credit Cost, min 1). The live cost is shown right on the **"Create Video · N credits"** button (served via the public `/api/config`, no rebuild to change). Failures refund the charged credits; xAI moderation blocks reuse the try-on strike/grace policy.
- **Transition between two images.** A second, optional source-image picker sits beside the first; add one and describe the transition (e.g. "morph from the first outfit into the second"). With two images we use Grok's **reference-to-video** mode (both images in `reference_images`, prompt-driven); a single image uses **image-to-video**. The two modes are mutually exclusive (xAI has no literal first→last-frame interpolation).
- **Fixes:** the ✨AI-generated badge is centered over the video so it no longer covers the native player's fullscreen/cast/scrubber controls; and a moderation false-positive that discarded **every** successful video (a substring match on the normal `respect_moderation` field) was fixed — detection is now structural + unit-tested.

**New features (web/app)**
- **Name your try-on.** An optional caption field on the try-on screen (≤140 chars). The caption shows under the result image on the community feed, on the web "My Try-Ons" cards, and leads the link preview on the public share page. Editable after the fact via `PATCH /api/tryon/:jobId/title`.
- **Web "My Try-Ons" redesign.** Each session card now shows just **two thumbnails** — your body photo and the clothing item. Tap either (or "View all") to open a **full-screen carousel** that pages through every image in the session, inputs and AI results alike, with arrow/keyboard navigation and the ✨ AI-generated badge on results.

**Security audit (credits + subscriptions)**
- Reviewed the Guest Welcome, Welcome-Bonus (join offer), and Referral credit paths plus the Apple IAP/subscription pipeline for double-grant, race, and injection bugs. **No SQL injection surface** — every query is a Prisma parameterized call or a tagged-template `$queryRaw`. Grant paths are atomic + idempotent (conditional token consume, `updateMany` claims, `FOR UPDATE` locks). Findings logged in TODOS.md §0.5.

**Credit-farming hardening (anti-abuse)**
- **Email normalization at signup/claim.** New `User.emailNormalized` column (migration `add_email_normalized` + backfill) canonicalizes addresses (lowercase, strip `+tag`, remove Gmail dots) so one inbox can't register many aliased accounts to farm welcome + referral credits. Display/transactional mail still uses the verbatim address; login/forgot-password are unchanged.
- **Per-referrer cap.** A referrer can earn at most `referralMaxPerWindow` rewarded referrals per rolling 30-day window (admin-tunable, default 20, 0 = unlimited); past the cap the referrer's payout is withheld but the invitee still gets their join bonus. Plus an hourly referral-velocity alert to admins.
- **Guest welcome grant now requires a real `deviceId`.** Web/simulator/pre-rebuild clients (null deviceId) get a working guest but 0 credits, closing the easiest guest-credit farm. Real iOS devices are unaffected.
- Investigated a prod report of one user appearing from both IPv4 and IPv6 ("two cities"): confirmed **identity is never IP-based** (it's token + deviceId), so this is a cosmetic geo-display artifact only — **severity LOW**, no action taken.

**Fixes & polish**
- **Keyboard no longer covers text inputs.** Fixed the comment box (`TryOnCommentsScreen`), the try-on caption field (`TryOnScreen`), the Report sheet's details box, and the Admin-console key field — each kept its input above the keyboard (manual keyboard-height tracking / `automaticallyAdjustKeyboardInsets` / `KeyboardAvoidingView` as appropriate). Audited all 10 text-input surfaces.
- **Try-on screen spotlights the Outfit Designer.** The tiny "My Closet" text link is now a bold gold-on-black **"Design Your Own Outfit"** card (with a NEW badge + CTA) below the privacy toggle; the helper line moved beneath the clothing photos.

## v1.2.0 — 2026-06-13 (App Store build 34)

**Theme:** The big creative-features release. The public App Store jumps **1.0.17 → 1.2.0** (1.1.0 only ever reached TestFlight), so this build carries the **Outfit Designer / Closet** work *and* a new engagement/growth batch, plus admin-controlled promotions and several correctness/security fixes.

> ✅ **Live on the App Store (approved 2026-06-14) and the prod backend is cut over** (verified 2026-06-15): prod runs the 1.2.0 backend with `add_referrals` + `add_saved_looks` applied and nginx force-recreated for the `/t/` share-page proxy. Original cutover runbook retained in DEPLOYMENT.md → "1.2.0 production cutover."

**New features**
- **Outfit Designer / "My Closet."** Describe an outfit in words and AI generates a catalog-style product shot, saved to your Closet and tried on like a photographed item (1 credit/generation). Includes a **"Surprise me"** button and style/occasion chips to remove the blank-box friction. (From the 1.1.0 line; ships to the public here.)
- **"Clean Up a Photo."** Upload a messy clothing photo — a website screenshot full of text/prices, or a cluttered scene — and AI turns it into a clean product shot you can try on. Directly addresses "I uploaded a screenshot and the try-on looked wrong"; the photo tips now warn about screenshots too.
- **Share a try-on.** Every public try-on gets a shareable web page (`/t/<id>`) with rich link previews (OpenGraph/Twitter) for iMessage/social; share button on feed cards and Saved Looks.
- **Saved Looks.** Bookmark any try-on (yours or a public one) and revisit them; the bookmark turns yellow when saved. Save from the feed, the Saved Looks screen, or next to "Save All" in the full-screen detail view.
- **Compare Looks.** Pick two of your completed try-ons and view them side by side.
- **Invite Friends (referral program).** Share your code; you and your friend each get free credits when they join and verify (admin-tunable; can be disabled).
- **Designer entry on Profile** + Saved Looks / Compare Looks added to the feed dropdown menu (previously only on Profile).
- **Own-post quick actions.** The 3-dot menu on your own feed post now offers Make Private, Share, and Delete (it used to be empty).

**Admin / promotions**
- **Limited-time "free credits when you join" offer is now admin-controlled.** The welcome-bonus amount is editable from the Admin Dashboard (⚙️ Settings) and can be raised, lowered, or turned off without an app update; the app shows "Limited time offer: N free credits when you join" dynamically (and hides it when off). The Free-tier card on the purchase screen was reworded to a 4-bullet layout ("No credit card or subscription required", etc.). Referral reward amount is admin-controlled too.

**Fixes & hardening**
- **In-app purchases: refunded credit packs now correctly claw back credits.** A consumable-refund handler ordering bug meant the claw-back was effectively dead code (a user could refund a credit pack and keep the credits); now fixed and made concurrency-safe (security audit).
- **Admin "create user" validates email format.** A missing TLD (e.g. `name@host` with no `.com`) used to save silently and then login / forgot-password could never match it; the endpoint now rejects malformed emails.
- **Saved Looks privacy/GDPR.** Saved looks re-check visibility at read time (a look saved while public stops serving once the owner makes it private or blocks you) and never expose the original's input photos; data export now includes saved looks + referrals.
- **Join-offer config is no longer cached** (`/api/config` is `no-store`), so an admin change shows on the next app launch.

## v1.1.0 — superseded by v1.2.0 (TestFlight only; never shipped to the App Store)

- **Rebrand: the product is now "TryOn Mirror" on the domain `tryon-mirror.ai`** (previously "TryOn" by evoFaceFlow on `evofaceflow.com`). The website, legal documents (Privacy Policy / Terms), transactional emails, and in-app legal links all use the new brand + domain. The app now talks to `api.tryon-mirror.ai`; the legacy `api.evofaceflow.com` keeps serving so existing 1.0.17 installs are unaffected, and the old website 301-redirects to the new domain (except `sms.html`, kept serving for the pending toll-free SMS registration). The iOS bundle id and IAP product ids keep their `com.evofaceflow.tryon.*` prefix — Apple makes these permanent; they're invisible to users. Spare domains `tryon-mirror.{com,net,app}` 301 to the main site.
- *(plus the in-progress 1.1.0 features: Outfit Designer / Closet, fixed TryOn header, full-screen outfit viewer — notes to be finalized at release)*

## v1.0.17 — 2026-06-10

**Theme:** Fast-follow after the v1.0.16 App Store launch (1.0.16 is live) — a release-only carousel bug fix, frontend dependency security hardening + SDK-54 patch alignment, mobile crash reporting groundwork, and backend auth/admin hardening.

- **Mobile crash reporting (Sentry) — LIVE in the production build.** `@sentry/react-native` is integrated and gated on `EXPO_PUBLIC_SENTRY_DSN` (`sendDefaultPii:false`, errors-only, no tracing). The DSN + source-map upload are set via EAS production env vars, so crash + stack-trace reporting is **active** in the 1.0.17 store build (local dev clients without the env var stay dark). Privacy Policy §7/§8 updated to disclose Sentry as a diagnostics-only processor (2026-06-11); declare **Diagnostics → Crash Data** on the App Store Connect privacy label.

- **Backend: refresh-token rotation is now live (security hardening).** Each session refresh now rotates the refresh token with reuse detection, so a stolen/captured token is invalidated as soon as the real device refreshes (previously a leaked token stayed valid for its full 30 days). A server-side grace makes this safe across app force-closes — no spurious logouts. Backend + infra only; speeds nothing but meaningfully hardens account security for all app versions.

- **Admin/ops:** the guest welcome-credit grant is now editable from the Admin Dashboard (⚙️ Settings) without a redeploy, and a "Clear History" button wipes a user's stored login-location history. Internal tooling only.

- **Fixed: full-screen carousel images opening "out of frame."** Tapping a try-on in the Home feed to open the full-screen image carousel could show one or more images shifted off-center — most often the clothing photo (carousel slot 3), whose shopping-screenshot aspect ratio differs most from the body/result images — until you swiped to recenter. Root cause: a nested zoomable `ScrollView` (added in v1.0.16 for pinch-to-zoom) raced the layout in optimized **release** builds, so it reproduced on the App Store build but **not** the Expo dev client. The viewer now renders each image directly. **Pinch-to-zoom is temporarily removed** and will return via a `react-native-gesture-handler` + `reanimated` implementation (gated so the carousel only pages at scale 1). No backend or schema changes — frontend only.

- **Performance: try-on generation is ~2× faster.** The two result perspectives (full-body + waist-up) now generate **concurrently** on the backend instead of sequentially — a measured 2-photo generation dropped from **~25s → ~12s**. The app also polls for the result every **2.5s** (was 5s), so it appears promptly once ready. Two robustness fixes ride along: a retry of a partially-failed multi-perspective job now **skips** the perspective that already succeeded (no double Grok charge), and a queue-enqueue failure after a credit is spent now **refunds + asks the user to retry** instead of stranding the job. (The backend half deploys independently and speeds up all app versions, incl. live 1.0.16; the poll-interval change ships in the app.)

- **Security: patched all critical- and high-severity frontend dependency advisories.** Non-breaking `npm audit fix`: **axios** 1.15.2 → 1.17.0 (six high-severity CVEs — proxy-credential leak across HTTP→HTTPS redirects, MITM via prototype pollution in `config.proxy`, cookie-name ReDoS, and related), **shell-quote** 1.8.3 → 1.8.4 (critical), plus `ws` / `brace-expansion` / `expo-dev-launcher`. Frontend audit dropped from **28 critical / 1 high / 28 moderate → 0 / 0 / 17** (the remaining moderates are Expo SDK-54 build tooling, fixable only by jumping to expo@56 — deliberately not done). axios is the app's HTTP client, so this is a genuine runtime improvement shipping to users. `package.json` unchanged (axios `^1.6.8` still satisfied); no Expo package versions changed by the audit fix.

- **Admin: fixed the "Frontend (NPM)" vulnerability scan.** It had errored with "package.json not found in directory" on dev + prod — the backend container (built from the `./backend` context) couldn't reach the sibling `frontend/`. The frontend manifests are now bind-mounted into the backend container (with `group_add` so the non-root user can read them under umask 007) and audited via `npm audit --package-lock-only`. Backend change only.

- **Chore: aligned Expo packages to the SDK 54 expected patches.** `expo install --fix` bumped `expo` → ~54.0.35, `expo-file-system` → ~19.0.23, `expo-font` → ~14.0.12, clearing the `expo-doctor` "packages out of date" warning in the EAS build log. All within SDK 54.

### Late additions that rode the 1.0.17 build (2026-06-09 → 06-11, store build #28)

- **Simplified sign-up.** Account creation now asks for email + password only — no username field. A username is generated server-side (a claiming guest keeps their `user#######` handle) and stays renameable in Edit Profile. Body-photo screens gained upload tips, and the clothing/body pickers warn when a selected photo is low-resolution (longest side < 1024px) so users know why a result may look soft.
- **Partial-result delivery.** A multi-perspective try-on that loses one perspective no longer discards the survivor: a transient loss (Grok 5xx/S3) completes with the surviving image **and auto-refunds the credit**; a single-perspective moderation block completes with the survivor, with no strike and no refund (a passing sibling perspective is evidence of a filter false positive). Total losses keep the previous terminal behavior.
- **Honest purchase status.** When a StoreKit purchase succeeds but backend receipt verification is deferred (e.g. network blip), the purchase screen now reports the true pending state instead of a premature success/failure.
- **Case-insensitive account identity.** Email and username uniqueness + lookups are case-insensitive end-to-end (Postgres `citext`); duplicate-signup races map to 409 instead of 500. Profile data auto-refreshes when screens regain focus.
- **Session-expiry fix.** `sessionExpired` handling is idempotent and the session kind is read before bootstrap, removing a stale-token retry loop.
- **Fixed: permanent "Tap to reload" on older feed posts (resubmitted build).** Replacing or deleting a body photo removed its S3 object while historical try-on jobs still referenced it as their "original body" carousel slide — the slide then failed forever (404 NoSuchKey) with a retry button that couldn't work. Three-part fix: (a) backend — replacing/deleting a body photo now **detaches the references** on that user's historical jobs first (matches bare-key and legacy-URL rows; verified against both forms), so the slide is cleanly omitted instead of dead; (b) data — the three recoverable deleted photos were **restored from S3 versioning** (delete-marker removal) and the one past the 30-day window had its 2 references nulled; (c) client — `RetryableImage` now probes an exhausted-retries failure with a 1-byte ranged GET and shows a quiet **"Image unavailable"** for permanent failures (403/404/410) instead of a tap-to-reload that lies; transient failures keep the retry button. Unit-tested (`imageFailure.test.ts`).
- **Backend (deployed 2026-06-11, server-side only):** closed three credit-accounting concurrency holes — the email-verification welcome bonus could be granted more than once under concurrent clicks (now a conditional token consume); parallel submissions could overshoot the weekly try-on cap with free sessions (submission gate now serializes per user via a row lock + in-transaction recount); refund idempotency check-then-create gap closed. Verified with empirical race tests (`backend/scripts/raceChecks.mjs`).

---

## v1.0.16 — 2026-06-07

**Theme:** First feature release after the v1.0.15 App Store launch. Headlined by **Guest Mode** (browse and try the app before creating an account), plus content-moderation policy enforcement, try-on result reliability and quality improvements, and a round of backend/security hardening.

> **Migration required on deploy** — run `npx prisma migrate deploy`. Two new migrations (see *Database migrations* below).

---

### New: Guest Mode (browse & try before signup)

New users open straight into the browsable feed instead of a sign-in wall — they can scroll the feed, view public profiles, read comment threads, and run a couple of free try-ons before creating an account. Favorable under App Store Guideline 5.1.1(v).

- **Anonymous accounts:** first app open mints a real but anonymous `User` (`isGuest=true`, `email`/`passwordHash` null, `verified=true`) with a small welcome credit grant (2 credits). `POST /api/auth/guest`.
- **Device-scoped reuse:** the client sends its device identifier (iOS `identifierForVendor`) so logout/reopen reuses the same guest row instead of churning a new one — the welcome grant and the sign-up metric happen once per device, not on every open.
- **Write gating:** guests can read everything, but social writes (like, follow, comment, report, block, change-password) return **`403 GUEST_SIGNUP_REQUIRED`** to prompt sign-up. Guest try-ons are forced **private** so anonymous accounts never publish public UGC.
- **Conversion (claim):** `POST /api/auth/claim` upgrades the same row in place — the guest's try-ons, credits, and AI consent carry over — then requires email verification. Verifying adds the standard **+10** welcome bonus on top of any remaining guest credits.
- **Logout** drops to a 0-credit browsable guest session (no fresh grant — not a farm lever).
- **Abuse mitigations:** small grant, re-upload-photo + re-consent friction each cycle, per-IP rate limit on `/auth/guest` (10/hour), an hourly abuse-monitor that emails admins past a threshold, and daily cleanup of unconverted guests older than 30 days.

**Mobile app:**
- Guest-aware navigation: browsable tabs with the Login/Sign-Up flow presented as a modal; Profile and Inbox replaced by guest profile / prompt screens.
- Guest profile shows credit balance and the guest's own try-on history.
- Fixes for guest navigation dead-ends and a stale-token bootstrap retry loop.

**Admin dashboard:** new guest metrics — **Guests Today**, **Active Guests**, **Guest→User (7d)** conversion rate, and a 7-day sign-up mini-trend.

**Schema:** `User.isGuest`, `User.deviceId`, and nullable `User.email` / `User.passwordHash`.

---

### Content moderation: fashion-only policy (ToS §5.4)

- The AI try-on now rejects nude / sexual / revealing content via the provider's content filters; `grokService` distinguishes a content-moderation block from a transient technical failure.
- Per Terms of Service §5.4, a content-moderation block is **terminal and non-refundable** — it is not retried and the credit is not returned. Genuine technical failures are still retried (3 attempts) and the credit refunded as before. The failed-job view explains the policy to the user.
- Privacy Policy and Terms of Service updated to match.

---

### Try-on results: reliability & quality

- **Self-healing result images:** fixed the intermittent blank-white-box bug by retrying transient image-load failures; rolled the `RetryableImage` component out to every remote-image surface.
- **Pinch-to-zoom** in the full-screen image viewer (pure JS, no native module).
- **Prompt refinement** for e-commerce-catalog quality and modesty, plus a fix so results are **no longer cropped** when the source clothing/outfit photo is itself cropped.

---

### Account & session robustness

- A returning real user whose session has expired is now routed to **Login** (with a "session expired" banner) instead of being silently demoted to a guest.
- **Refresh-token rotation** with reuse-detection, gated behind `REFRESH_TOKEN_ROTATION` (kept off until a rotation-aware client build is live, so legacy clients aren't logged out).
- Credit balance refreshes on the TryOn screen after each submit.

---

### Security & infrastructure hardening

- **Auth hardening:** admin-output XSS escaping, refresh tokens stored **hashed** (a DB leak can't replay them), and closed account-enumeration vectors on signup / login / forgot-password / resend-verification (constant-time, generic responses).
- **Deep `/health`:** probes Postgres + Redis in parallel and returns `503` when degraded; a shallow `/health/live` backs the Docker liveness probe.
- Redis `maxmemory-policy=noeviction` for BullMQ safety; raised backend container memory; documented swap configuration.
- **Boot guard:** the backend refuses to start if `APP_URL` disagrees with `APPLE_ENVIRONMENT`.
- **Admin surface** IP-allowlisted at nginx on production (defense-in-depth on top of `X-Admin-Key`).
- **Server OS hardening** (dev + prod): UFW, host fail2ban, SSH hardening, sysctl, auditd, Docker log rotation, and locked-down secret-file permissions — see `scripts/harden-server.sh`.

---

### Pre-ship fixes

- **Uploads** now return clean 4xx (`413` too large / `400` too many or wrong field / `415` unsupported type) instead of an opaque `500`.
- **Credit deduction** is a conditional, atomic decrement — concurrent submissions can't double-spend into a negative balance.
- **`verify-receipt`** treats a duplicate-transaction race as already-processed instead of `500`ing (it still never double-grants).
- **Blocks** are enforced inside comment threads — a blocked user's comments/replies are hidden from the blocker in both directions, and commenting / replying / liking across a block returns `404`.
- Fixed a `404` on the email-verification success page.

---

### App Store / build

- Removed `NSUserTrackingUsageDescription` from `app.json` — App Store Connect treats the string's mere presence as an App Tracking Transparency declaration, and the app does not call `ATTrackingManager` or track users.

---

### Database migrations

Two new migrations — **run `npx prisma migrate deploy` on deploy**:
- `20260605233658_guest_mode_nullable_email_passwordhash`
- `20260606161454_add_user_device_id`

---

## v1.0.15 — 2026-05-26

**Theme:** First public **App Store** release, under the new name **TryOn Mirror**. Focused on Apple In-App Purchase robustness, admin subscription tooling, billing correctness, and App Store reviewer preparation.

### Rebrand

- App renamed to **TryOn Mirror** (display name and store metadata).

### Apple In-App Purchases

- Fixed the purchase spinner hanging after repeated credit purchases, including the "stuck on the 4th purchase" case — stale StoreKit transactions are now flushed on mount.
- Removed the unused server-side `/restore-purchases` endpoint; Restore Purchases is fully StoreKit-driven (each available receipt is re-verified).
- Reissued Product SKUs to clear an App Store Connect "needs attention" state.
- Fixed `downgradeIfNoActiveEntitlement` incorrectly dropping a user to FREE.
- The Apple Server API now returns a `503` JSON response on a file-not-found error instead of crashing to an HTML error page.

### Billing correctness

- A try-on credit is charged **only when the job row is created**, so an upload/enqueue failure can no longer bill the user. (Further hardened against concurrency in v1.0.16.)

### Admin dashboard

- Added stale-subscription cleanup: delete a single stale test subscription, or delete-all with a count of how many are stale.
- Admin user-delete now also cleans up the user's S3 objects; added an orphan-object scan with a weekly email alert.

### Reliability

- The token-refresh interceptor no longer strands in-flight requests when a refresh fails.
- Expired refresh tokens are purged on login and a `User` index was added.
- Memoized the Discover feed list to cut wasted re-renders.

### Security

- Locked local Redis and Postgres to loopback only (not published on the host's public interface); Postgres remains reachable for admin tooling via an SSH tunnel.

### App Store reviewer prep

- Reviewer demo accounts switched to the Free tier; consent and throttle behavior clarified for review.
- De-duplicated the iOS permission strings in `app.json`.
- Stopped tracking `AppReviewerSummary.md` (it contained demo-account passwords) and `.claude/settings.local.json`; brought `CLAUDE.md` into the repo.

---

## v1.0.14 — 2026-05-20

**Theme:** Apple In-App Purchase (StoreKit) integration and Admin Dashboard subscription tooling. Pre–App Store build — the first public App Store release was v1.0.15.

### Apple In-App Purchases (StoreKit)

- Integrated the App Store IAP path: the client posts the signed StoreKit transaction to the backend, which verifies it and applies the entitlement (tier or credits); App Store Server Notifications cover renewals and refunds. This is the foundation later refined in v1.0.16.

### Admin Dashboard

- Added per-user subscription-status tooling to the admin dashboard.
- Fixed a bug that prevented access to the admin panel.

### Docs

- Created the repository `RELEASE_NOTES.md`.

---

## v1.0.13 — not released

Version skipped. The app version went directly from 1.0.12 to 1.0.14 (commit `a2774e7`); there was never a 1.0.13 build in `app.json`/`package.json` or a 1.0.13 submission. This placeholder exists only to keep the changelog numbering continuous.

---

## v1.0.12 — 2026-05-14

**Theme:** App Store resubmission. Implements the explicit in-app AI-processing consent required by App Store Review Guidelines 5.1.1(i) and 5.1.2(i), and rewrites the Privacy Policy and EULA to satisfy 3.1.2(c) and the App-Review-mandated AI-data-disclosure language. Includes a UX fix to the clothing-photo picker that contributed to the original rejection.

### Why this release exists

App Store reviewer feedback (rejection of v1.0.11) under Guidelines 5.1.1(i) / 5.1.2(i):

> The app appears to share the user's personal data with a third-party AI service but the app does not clearly explain what data is sent, identify who the data is sent to, and ask the user's permission before sharing the data. Only including this information in the app's Terms of Service or Privacy Policy is not sufficient.

A separate finding under 3.1.2(c) called out missing functional EULA links in App Store Connect metadata.

This release closes both findings end-to-end: a dedicated in-app consent dialog, server-side enforcement, surfaces to grant and revoke, and a full Privacy Policy + EULA rewrite to bring the policy documents into line with Apple's "same or equal protection" language and other current App-Review expectations.

---

### New: AI Processing Consent

A new explicit opt-in is required before any body or clothing photo can be transmitted to xAI's Grok Imagine API. The modal names xAI by full legal name, lists exactly what data is sent, what is explicitly **not** sent (close-up profile photo), and links to both our and xAI's privacy policies. An affirmative "I Agree and Continue" tap is required.

**Schema:**
- New `User.aiProcessingConsentAt: DateTime?` column. `NULL` means consent has not been granted, or has been revoked.
- Migration: `backend/prisma/migrations/20260516000000_add_ai_processing_consent/`
- **Migration required on deploy** — run `npx prisma migrate deploy` per the standard checklist.

**Backend:**
- `POST /api/profile/me/ai-consent` — records consent (sets timestamp to `NOW()`).
- `DELETE /api/profile/me/ai-consent` — revokes consent (sets to `NULL`).
- `POST /api/tryon` now returns **`403 { error: 'AI_CONSENT_REQUIRED' }`** when consent is missing. The check runs **before** any S3 upload or credit deduction, so an unconsented submission costs the user nothing.
- `aiProcessingConsentAt` is included in `GET /profile/me`, the login response, and `GET /api/admin/users` / `GET /api/admin/user/:id`.

**Mobile app:**
- New `AiConsentModal` component ([frontend/src/components/AiConsentModal.tsx](frontend/src/components/AiConsentModal.tsx)).
- `TryOnScreen.handleSubmit` opens the modal when `user.aiProcessingConsentAt` is `null`. On agree, the client posts the consent endpoint, updates the local user store, and retries the submit.
- If the server returns `AI_CONSENT_REQUIRED` (stale client cache, e.g. after server-side reset), the modal re-opens automatically.
- Settings → Privacy & Data → **AI Processing Consent** row shows current status ("Granted" / "Not granted"); when granted, a **Revoke AI Processing Consent** button appears below.

**Admin dashboard:**
- Users table — new **AI Consent** column. Green "Granted M/D/YY" badge (hover for full timestamp) or muted "Not granted" badge.
- User-detail modal — new "AI Processing Consent" row showing `✓ Granted <full timestamp>` or `✗ Not granted`.

---

### UX fix: Clothing-photo picker permission flow

`TryOnScreen.pickClothingPhoto` previously requested iOS Camera permission **immediately and unconditionally** on tap, before the user had said whether they wanted to use the camera or the library. On denial, the app silently fell through to the library picker with no feedback.

This was almost certainly a contributing factor to the original 5.1.1(i) rejection: the reviewer's screen capture shows them stuck at the camera permission prompt, which presented `NSCameraUsageDescription`'s "Photos are processed by AI..." text as the *only* AI-data-sharing disclosure they saw. Apple explicitly says permission-string text is not sufficient.

**Fixed in this release:**
- Action sheet ("Take Photo / Choose from Library / Cancel") now appears **first**.
- Camera permission is requested only when the user explicitly picks "Take Photo" — Apple HIG-compliant (ask in context).
- Denial routes to a helpful three-button alert: **Choose from Library** / **Open Settings** (deep-link to iOS Settings) / **Cancel**.

See [frontend/src/screens/TryOnScreen.tsx](frontend/src/screens/TryOnScreen.tsx#L64-L100).

---

### Privacy Policy rewrite ([website/privacy.html](website/privacy.html))

Full rewrite to satisfy App Review's recent privacy expectations and to reach parity with comparable AI-image apps (Lensa, FaceApp, Reface).

**New / expanded sections:**
- At-a-glance plain-language summary at the top (no AI training; no tracking/ads/analytics; in-app delete; explicit consent named).
- **§2 iOS Permissions** — table mirrors the `NSCameraUsageDescription` and `NSPhotoLibraryUsageDescription` strings from `frontend/app.json`.
- **§4 Legal Bases for Processing (GDPR Art. 6)** — contract / consent / legitimate interests / legal obligation, per processing activity. Also explicit no-automated-decision-making (Art. 22) statement.
- **§5.1 No AI training** — explicit "we do not use your photos to train any AI model" commitment.
- **§5.2 Generative AI labeling** — cites App Store Guidelines 4.0 and 5.1.8 by number.
- **§6 State biometric laws** — Illinois BIPA / Texas CUBI / Washington defensive boilerplate.
- **§7 "Same or equal protection" language** — exact phrase from Apple's rejection text now in the policy.
- **§8 App Tracking, Analytics, Advertising** — explicit "no" list, including ATT non-participation, no IDFA, no third-party analytics or attribution SDKs (Sentry, Crashlytics, Amplitude, etc.).
- **§10 Privacy Rights** — enumerated CCPA/CPRA rights with 12-category personal-information table, GDPR rights cited by Article number, other-state-law acknowledgement (CO, CT, VA, UT, TX, OR, MT, TN, IA, IN).
- **§13 International Transfers** — strengthened with Standard Contractual Clauses / UK IDTA / EU-U.S. Data Privacy Framework references (replaces post-Schrems-II-unenforceable "you consent" language).
- **§14 Content Moderation, Reporting, and Account Deletion** — cites Guidelines 1.2 and 5.1.1(v), confirms in-app deletion is available.
- **§16 Contact** — full postal address.

The Face Data section (§6 in the new layout) is preserved as the strongest defensive language in the policy.

---

### EULA rewrite ([website/terms.html](website/terms.html))

Full rewrite to add the Apple-mandated minimum EULA clauses (per Schedule 1 of the Developer Program License Agreement) and AI-specific clauses comparable to peer AI-image apps.

**Apple-mandated clauses now present:**
- §1 Acknowledgement that the EULA is between user and developer (not Apple); Apple + subsidiaries as third-party beneficiaries with enforcement rights.
- §10 Scope of License — limited to Apple-branded products the user owns/controls, per App Store Usage Rules.
- §11 Maintenance & Support — developer-only obligation.
- §14 Warranty disclaimer + Apple-refund mechanism (notify Apple, Apple refunds).
- §15 Product Claims — developer responsibility.
- §16 IP infringement claims — developer responsibility.
- §19 Legal Compliance — US embargo / denied-parties warranty.
- §20 Third-party terms compliance (xAI + Apple Media Services).
- §24 Developer name and full postal address: **evoFaceFlow** (sole proprietorship of Bruhn Freeman) / 2767 Route 44/55 / Gardiner, NY 12525.

**AI-specific clauses added:**
- §5.1 Output ownership (user owns try-on outputs subject to acceptable use).
- §5.2 No-reliance + body-image / no-medical-advice disclaimer.
- §5.3 Prohibited uses of AI features: non-consensual intimate imagery, deepfakes of others, minor depictions, disinformation, model-training using outputs, AI resale, automated abuse.
- §8 DMCA-style copyright takedown process (notice format and `dmca@evofaceflow.com` contact).

**Other:**
- §17 Liability cap with floor (greater of $50 or 12 months of fees).
- §22 Governing law: New York state courts, with EEA/UK consumer-protection carve-out.
- §23 Severability, entire agreement, assignment, no-waiver boilerplate.

---

### Documentation

- `CLAUDE.md` updated to v1.0.12. Corrects a stale nginx-restart claim about HTML file changes (the website is bind-mounted; `git pull` is sufficient — no container rebuild needed for HTML-only edits), adds the new AI consent endpoints to the routes list, documents `AiConsentModal`, updates the SettingsScreen description, clarifies the Onboarding consent vs. AI consent distinction, and documents the camera-permission UX pattern with a warning not to revert it.
- Privacy Policy and EULA changes are also reflected in the rebuilt HTML at `docs/` via `npm run build:docs`.

---

### App Store Review Information (paste into App Store Connect)

**Required by Apple's reply-to-rejection.** Paste verbatim into App Store Connect → App Review Information → Notes:

> **AI processing consent flow:** The test account is pre-loaded with body photos. To see the AI consent dialog (required by Guidelines 5.1.1(i) / 5.1.2(i)):
>
> 1. Sign in with the credentials above.
> 2. Tap the center camera button in the bottom tab bar.
> 3. Tap the empty clothing-photo slot. A choice appears: Take Photo / Choose from Library / Cancel. Pick either.
> 4. After selecting a clothing photo, tap **"Generate Try-On"**.
> 5. **The AI Processing Consent dialog appears**, naming xAI, Inc., listing exactly what is sent (full-body and/or waist-up photo + clothing photo), what is NOT sent (close-up profile photo), with links to both our and xAI's privacy policies, and an explicit "I Agree and Continue" button.
> 6. Consent can be revoked at any time in Settings → Privacy & Data → Revoke AI Processing Consent.
>
> Server-side enforcement: the `/api/tryon` endpoint refuses requests with HTTP 403 `AI_CONSENT_REQUIRED` if consent is not on file, so a tampered client cannot bypass the dialog. Privacy policy at https://evofaceflow.com/privacy.html §5 details what is sent, to whom, retention, and how to revoke. Privacy policy §7 confirms third-party providers are contractually required to provide equivalent data protection.

Also required for resubmission:
- A screen recording showing: tap clothing slot → pick from library → tap Generate → consent modal appears with xAI clearly visible → tap I Agree → try-on proceeds. Attach this to the Resolution Center reply.
- App Store Connect → App Information → **License Agreement** — paste the new `terms.html` content as a custom EULA, or add `Terms of Use: https://evofaceflow.com/terms.html` to the App Description. This satisfies the 3.1.2(c) finding.
- Verify the **Privacy Policy URL** field on App Information is set to `https://evofaceflow.com/privacy.html`.

---

### Deployment checklist for this release

```bash
ssh ubuntu@<lightsail-ip>
cd /opt/evofaceflow/TryOn
git pull
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml exec backend npx prisma migrate deploy   # ⚠️ REQUIRED
```

The website bind mount picks up the new `privacy.html` and `terms.html` immediately on `git pull` — no nginx restart needed.

**Verify `dmca@evofaceflow.com` mailbox is configured** (referenced in `terms.html` §8 and §24, and in `privacy.html` indirectly). Forward to `support@` if no dedicated inbox exists.

**Existing users** (including the App Review test account) will all see the consent dialog the next time they tap Generate Try-On, because `aiProcessingConsentAt` defaults to `NULL`. This is intentional and is exactly what the reviewer needs to observe.

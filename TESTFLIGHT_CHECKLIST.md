# TestFlight / Real-Device Must-Test Checklist

**Why this file exists.** Automated tests (backend `node --test`, frontend `jest-expo`), the Expo **dev client**, and the iOS **simulator** all pass on a large class of bugs that still break on a real, signed **TestFlight / App Store** build. The defining reasons an item lands on this list:

- **(A) Apple StoreKit / sandbox** — IAP can't be exercised reliably in the simulator; TestFlight + App Review use **sandbox** receipts against the **production** backend.
- **(B) Release-build-only behavior** — optimized Hermes + minification commit work in a different order than the instrumented dev client, so timing/layout races appear **only** in release (the pinch-zoom carousel bug is the canonical example — a dev-client test *falsely passes*).
- **(C) Native modules** — `expo-iap`, `expo-video`, `expo-secure-store`, `expo-application` (IDFV), camera/library — behave differently or only exist on device.
- **(D) Real-device hardware / OS** — camera, HEIC photos, permission dialogs, real network/geo, email delivery.
- **(E) Persistence across reinstall** — iOS Keychain (`expo-secure-store`) and IDFV survive app delete/reinstall; this is load-bearing for guest anti-farming and can't be seen in a simulator.

> **Maintenance:** add a row here whenever a new native module, IAP SKU, or release-sensitive feature ships. Last updated 2026-06-18 (added the soft-throttle queue + reset-on-purchase items).

---

## 0. Before each TestFlight pass
- [ ] The build's committed `frontend/src/config/api.ts` is `'prod'` (CI + pre-push guard enforce this; local working copy is usually `'dev'`).
- [ ] Note the version + build number you're testing.
- [ ] Have the reviewer/test accounts handy (`testuser1@evofaceflow.com` / `testuser2@evofaceflow.com`) or use a fresh signup to test onboarding.

---

## 1. In-App Purchases — StoreKit / `expo-iap` *(reason A, C)*
The highest-risk surface; a regression here costs real money or fails App Review.
- [ ] Subscribe **BASIC** monthly → tier flips to BASIC instantly; **localized** price shown; auto-renew disclosure visible next to the button.
- [ ] Subscribe **PREMIUM** monthly → same.
- [ ] Buy **each** credit pack size (10 / 25 / 50 / 100) → credits land instantly; the price shown is the **tier-variant** matching the user's tier.
- [ ] **Restore Purchases** from **PurchaseScreen** *and* from **Settings** → re-grants entitlement.
- [ ] `appAccountToken` mapping — purchased credits/tier attach to the correct account.
- [ ] **Sandbox receipt verifies against the prod backend** (dual-environment verifier). This is the Jim Morris lost-credits regression — a Production-only verifier silently breaks App Review's IAP testing. Confirm a sandbox buy actually credits the account.
- [ ] Cancel the subscription in iOS Settings → entitlement shows **Pending cancel**, then drops to FREE at expiry (webhook path).
- [ ] **Manage Subscription** deep link opens the iOS subscription screen.
- [ ] Prices are **never hardcoded** (Guideline 3.1.1(a)) — every price comes from Apple's `displayPrice`.
- [ ] **NEW — throttle reset on purchase:** get into the queue (see §9), then buy a credit pack → the **next try-on is instant** (no countdown). Confirms `User.throttleResetAt` clears the pacing window so freshly bought credits are immediately spendable.

## 2. Release-build-only rendering *(reason B)* — the dev client will lie to you here
- [ ] **Pinch-to-zoom in `FullScreenImageModal`** (when re-added): odd-aspect images — especially the clothing screenshot (aspect ~0.46 vs ~0.75 for body/result) — must open **centered, not shifted out of frame**. The old nested-`ScrollView` approach raced layout **only** in release. Validate exclusively on a TestFlight build.
- [ ] Full-screen carousel: page through **all** images of a session (both inputs + every result), counter, swipe, prev/next.
- [ ] `AiGeneratedBadge` overlay sits correctly over result images **and** video (center placement clears the native player controls).

## 3. AI Video — `expo-video` native module (1.3.0) *(reason C)*
- [ ] Generate a video from a single source image → it plays in the in-screen `VideoView`.
- [ ] Two-image **transition** video → plays.
- [ ] `VideoPlayerModal` opens full-screen + loops from both the Home feed ▶ overlay and the Profile grid.
- [ ] Video **pauses on leaving the Video tab** (background-playback fix — frontend, only live in a new App Store build).
- [ ] A 9:16 phone/body-photo source is **not squished** (aspect-ratio fix).
- [ ] Video credit cost is charged; a failed generation refunds.

## 4. Camera & Photo Library *(reason C, D)*
- [ ] TryOn "add clothing" → the **source action sheet appears BEFORE any iOS permission prompt** (don't regress to up-front permission — it confused the 5.1.1 reviewer).
- [ ] "Take Photo" → camera permission requested **in context**; denial routes to the "Camera Access Needed" alert with Open Settings / Choose from Library.
- [ ] "Choose from Library" → picker works; a **HEIC/HEIF** photo (real iPhone default) converts to JPEG. The simulator often won't reproduce HEIC.
- [ ] Body photo upload (full + medium) from Profile / Onboarding / EditProfile; avatar (512² crop).

## 5. Guest mode + identity persistence *(reason C, E)* — IDFV + Keychain
- [ ] Fresh install, first open → guest session created **with** welcome credits (granted only when a `deviceId` is present).
- [ ] Guest free try-on runs and is **forced private**; still requires body-photo upload + AI consent.
- [ ] Logout → reopen reuses the **same** guest row (no new credit grant) — device-scoped reuse.
- [ ] **Delete the app and reinstall → the SAME guest resumes with 0 new credits**, because `expo-secure-store` is the iOS Keychain and persists across reinstall. Only a full device erase yields a fresh grant. This is the anti-farming guarantee — verify it on a real reinstall (can't be seen in simulator).
- [ ] Convert/claim a guest → real account: credits + AI consent carry over; **+10 welcome bonus** lands after email verification.

## 6. Auth, email & session *(reason C, D)* — `expo-secure-store` + SES + real network
- [ ] Signup → verification email arrives (SES) → verify link works → welcome-bonus credits granted once.
- [ ] Login / logout / token persistence across full app restarts.
- [ ] **Refresh-token rotation grace:** force-close the app mid-session, reopen → still logged in (grace recovery, not logged out).
- [ ] Change password → forces re-login (all refresh tokens revoked).
- [ ] Forgot / reset password email flow.
- [ ] Suspicious-login email fires when logging in from a far-away location (real device IP/geo).

## 7. AI processing consent — Guideline 5.1.1(i) / 5.1.2(i) *(reason D)*
- [ ] First try-on with no consent on file → `AiConsentModal` appears (names xAI, lists sent/not-sent, links both privacy policies); Agree → submit proceeds.
- [ ] First **video** → consent modal with **video-accurate** copy.
- [ ] Revoke consent in Settings → next try-on/video re-prompts.

## 8. Sentry crash reporting *(reason B)* — release-only
- [ ] A forced error in the TestFlight build surfaces in the **RN** Sentry project (`bruhnfreemancom/react-native`) with dSYM/source-map symbolication.
- [ ] The build itself succeeded (the `@sentry/react-native` plugin hard-fails the archive if `SENTRY_AUTH_TOKEN` is missing/unscoped).

## 9. Soft-throttle queue UX *(reason — UX wording + timing)*
- [ ] As a FREE user, submit rapidly: the **7th** try-on within 15 min shows **"You're in the queue"** with a seconds countdown + the "Subscribers get faster queues" line (hidden for PREMIUM).
- [ ] **No "limit" / "you're moving too fast" wording anywhere** — it's always framed as a shared queue.
- [ ] The countdown ticks down and the job auto-starts; closing the app still completes it (found later in Profile).

## 10. Splash / announcement *(reason D)* — cold start
- [ ] Publish a splash in the admin dashboard → **cold-start** the app → it shows full-screen behind an OK gate; 2nd launch shows "Don't show this again"; the Settings → Announcements toggle works; Remove → app starts normally.

## 11. Share / deep links *(reason D)*
- [ ] Share a try-on → native share sheet; opening the link shows the OG preview + "Get the app" CTA and routes correctly.
- [ ] Share a video → inline `<video>` + OG video meta.

## 12. Social / moderation — Guideline 1.2 *(verify on device)*
- [ ] Report (try-on / user / comment), Block / Unblock, own-post 3-dot menu (Make Private / Share / Delete).
- [ ] Comments + single-level replies + per-comment likes; Inbox notifications deep-link to the right comment/profile.

> **Note on completion notifications:** there is **no APNs push** wired (`expo-notifications` is not installed). Try-on/video completion is surfaced by **client polling + the in-app Inbox**, so there's no push to test — just confirm the Inbox/badge updates and the result appears in Profile.

---

## What Claude already covers automatically (so you carry less)
- **Backend** unit + integration tests (`node --test`, ~140+) and **frontend** `jest-expo` (35) run on every change; CI + the Husky pre-push hook re-run them plus Prettier/ESLint/Docker-build/`api.ts`-prod-guard.
- The **`/user-sim`** skill simulates a full user journey (open → login → checkpoints → edit profile → buy credits → logout) against the **live or dev** backend — runnable on demand after a deploy to smoke-test the **server side** of §1 (purchase plumbing) and §6 (auth). Ask me to run it after a dev deploy.
- What I **cannot** drive — and what therefore stays manual TestFlight work — is anything touching StoreKit on a device, the camera, real reinstall/Keychain persistence, a release-build render, or device geo/email: i.e. the on-device half of §1–§11.

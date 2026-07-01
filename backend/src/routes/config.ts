import { Router, Request, Response } from 'express';
import { getSignupCreditGrant, getVideoCreditCost } from '../services/appSettingsService';

// Public, unauthenticated client config. The app fetches this on launch (and on
// the signup/guest-prompt surfaces) so server-controlled promotional copy can
// change without an app rebuild.
//
// `signupCreditGrant` drives the "Limited time offer — N Free Credits when you
// join" messaging: when > 0 the app shows the offer with the live number; when
// 0 the offer is discontinued and the app hides the messaging entirely. Nothing
// user-specific or sensitive is served here.
const router = Router();

router.get('/', async (_req: Request, res: Response) => {
  const [signupCreditGrant, videoCreditCost] = await Promise.all([
    getSignupCreditGrant(),
    getVideoCreditCost(),
  ]);
  // No caching: the app fetches this once per launch, and an admin change must
  // be visible on the very next launch. A `max-age` here is honored by iOS's
  // URLCache (and any CDN), so a stale value would survive a force-close — the
  // bug that made an admin edit appear not to take effect. The query is a single
  // indexed lookup, so serving it fresh every time is cheap.
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    signupCreditGrant,
    signupCreditsOffer: signupCreditGrant > 0,
    // Live per-video credit cost so the app can show it on the Create Video
    // button without a rebuild (admin-tunable via /api/admin/settings/video-cost).
    videoCreditCost,
  });
});

export default router;

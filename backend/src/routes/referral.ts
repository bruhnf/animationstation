import { Router, Request, Response } from 'express';
import { requireAuth, blockGuests } from '../middleware/auth';
import { getReferralSummary } from '../services/referralService';
import { env } from '../config/env';

// Referral program. Real accounts only (a guest has nothing to refer with and
// no email to verify the reward against).
const router = Router();
router.use(requireAuth);
router.use(blockGuests);

// GET /api/referral/me — the caller's referral code, share link, and stats.
// Generates the code on first call.
router.get('/me', async (req: Request, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  const summary = await getReferralSummary(req.user.userId);
  // Deep-ish link: the signup screen reads ?ref=CODE (and a future web flow can
  // too). The marketing site is the friendly landing target.
  const shareUrl = `${env.websiteUrl}/?ref=${encodeURIComponent(summary.code)}`;
  res.json({ ...summary, shareUrl });
});

export default router;

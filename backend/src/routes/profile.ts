import { Router } from 'express';
import { requireAuth, optionalAuth } from '../middleware/auth';
import {
  getProfile,
  updateProfile,
  getMyProfile,
  deleteAccount,
  exportData,
  recordAiConsent,
  revokeAiConsent,
} from '../controllers/profileController';

const router = Router();

router.get('/me', requireAuth, getMyProfile);
router.patch('/me', requireAuth, updateProfile);
router.delete('/me', requireAuth, deleteAccount);
router.get('/me/export', requireAuth, exportData);
router.post('/me/ai-consent', requireAuth, recordAiConsent);
router.delete('/me/ai-consent', requireAuth, revokeAiConsent);
router.get('/:username', optionalAuth, getProfile);

export default router;

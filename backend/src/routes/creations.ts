import { Router } from 'express';
import { requireAuth, blockGuests } from '../middleware/auth';
import {
  getJobStatus,
  getCreationsHistory,
  updateJobPrivacy,
  updateJobTitle,
  bulkDeleteJobs,
} from '../controllers/creationsController';

const router = Router();

router.use(requireAuth);

router.get('/history', getCreationsHistory);
// Mounted before `/:jobId` so the literal segment matches first.
router.post('/bulk-delete', bulkDeleteJobs);
router.get('/:jobId', getJobStatus);
// Guests can view their own creations (forced private) but must not be able to
// publish them to the public feed — gate the privacy toggle.
router.patch('/:jobId/privacy', blockGuests, updateJobPrivacy);
// Title/caption is owner-only metadata (not a publish action), so guests may
// caption their own private creations — requireAuth is enough, owner is checked
// inside the controller.
router.patch('/:jobId/title', updateJobTitle);

export default router;

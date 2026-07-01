import { Router } from 'express';
import { requireAuth, blockGuests } from '../middleware/auth';
import { uploadMultiple } from '../middleware/uploadMiddleware';
import {
  submitTryOn,
  getJobStatus,
  getTryOnHistory,
  updateJobPrivacy,
  updateJobTitle,
  bulkDeleteJobs,
} from '../controllers/tryonController';

const router = Router();

router.use(requireAuth);

router.post('/', uploadMultiple, submitTryOn);
router.get('/history', getTryOnHistory);
// Mounted before `/:jobId` so the literal segment matches first.
router.post('/bulk-delete', bulkDeleteJobs);
router.get('/:jobId', getJobStatus);
// Guests can view their own try-ons (forced private) but must not be able to
// publish them to the public feed — gate the privacy toggle.
router.patch('/:jobId/privacy', blockGuests, updateJobPrivacy);
// Title/caption is owner-only metadata (not a publish action), so guests may
// caption their own private try-ons — requireAuth is enough, owner is checked
// inside the controller.
router.patch('/:jobId/title', updateJobTitle);

export default router;

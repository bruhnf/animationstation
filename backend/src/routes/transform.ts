import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { uploadMultiple } from '../middleware/uploadMiddleware';
import { submitTransform } from '../controllers/creationsController';

const router = Router();

router.use(requireAuth);

// Submit an image transform (multi-image compose): source/reference images +
// an optional free-form prompt. Async — returns 202 with the queued job.
router.post('/', uploadMultiple, submitTransform);

export default router;

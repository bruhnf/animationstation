import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { uploadVideoSources } from '../middleware/uploadMiddleware';
import { submitVideo, getVideoHistory } from '../controllers/videoController';

// AI Video (image-to-video). Guests WITH credits may create videos (a guardrailed
// draw to the app); their videos are forced PRIVATE in the controller, the prompt
// is sanitized, and the AI-consent gate + 3/min limiter still apply.
const router = Router();
router.use(requireAuth);

// Accepts an optional `photo` (primary) and `photo2` (transition) camera-roll
// upload via multer .fields → req.files; creation / body-photo sources arrive as
// body fields. The controller reads req.files.photo / req.files.photo2.
router.post('/', uploadVideoSources, submitVideo);
router.get('/', getVideoHistory);

export default router;

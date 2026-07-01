import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { uploadSingle } from '../middleware/uploadMiddleware';
import {
  generateOutfit,
  cleanupOutfit,
  listCloset,
  renameClosetItem,
  deleteClosetItem,
  surpriseOutfit,
} from '../controllers/closetController';

const router = Router();

router.use(requireAuth);
// Guests WITH credits may design outfits + clean up photos (a guardrailed draw
// to the app). The per-user closet is private content, and generation is still
// protected by the prompt sanitizer/denylist + the 3/min per-IP limiter +
// moderation-strike machinery. Conditional credit charge gates spend.

router.get('/', listCloset);
// Random outfit-idea for the designer's "Surprise me" button (no credit/Grok).
router.get('/surprise', surpriseOutfit);
router.post('/generate', generateOutfit);
// "Clean Up" an uploaded photo into a catalog-style product shot (multipart
// field `photo`). Same 1-credit charge + refund policy as /generate.
router.post('/cleanup', uploadSingle, cleanupOutfit);
router.patch('/:itemId', renameClosetItem);
router.delete('/:itemId', deleteClosetItem);

export default router;

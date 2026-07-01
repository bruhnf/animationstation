import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { uploadSingle } from '../middleware/uploadMiddleware';
import {
  uploadAvatar,
  uploadFullBody,
  uploadMediumBody,
  deleteAvatar,
  deleteFullBody,
  deleteMediumBody,
} from '../controllers/uploadController';

const router = Router();

router.use(requireAuth);

router.post('/avatar', uploadSingle, uploadAvatar);
router.post('/full-body', uploadSingle, uploadFullBody);
router.post('/medium-body', uploadSingle, uploadMediumBody);

router.delete('/avatar', deleteAvatar);
router.delete('/full-body', deleteFullBody);
router.delete('/medium-body', deleteMediumBody);

export default router;

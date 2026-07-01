import { Router } from 'express';
import { requireAuth, blockGuests } from '../middleware/auth';
import {
  follow,
  unfollow,
  getFollowing,
  getFollowers,
  searchUsers,
  getFollowStatus,
} from '../controllers/friendsController';

const router = Router();

router.use(requireAuth);

// Following/unfollowing are social writes — gate guests. The GET reads below
// (lists, search, status) stay open so a guest can browse a profile's network.
router.post('/follow/:userId', blockGuests, follow);
router.delete('/unfollow/:userId', blockGuests, unfollow);
router.get('/following', getFollowing);
router.get('/followers', getFollowers);
router.get('/search', searchUsers);
router.get('/status/:userId', getFollowStatus);

export default router;

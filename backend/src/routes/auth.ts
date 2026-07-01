import { Router } from 'express';
import {
  signup,
  verifyEmail,
  login,
  createGuest,
  claimGuest,
  refreshToken,
  logout,
  forgotPassword,
  resetPassword,
  resendVerification,
  changePassword,
} from '../controllers/authController';
import { requireAuth, blockGuests } from '../middleware/auth';

const router = Router();

router.post('/signup', signup);
router.get('/verify/:token', verifyEmail);
router.post('/login', login);
// Anonymous guest session minted on first app open (no auth).
router.post('/guest', createGuest);
// Convert the current guest into a real account (authenticated as the guest;
// NOT blockGuests-gated — this is the one write a guest must reach).
router.post('/claim', requireAuth, claimGuest);
router.post('/refresh', refreshToken);
router.post('/logout', logout);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);
router.post('/resend-verification', resendVerification);
// Authenticated password change — requires JWT + current password as re-auth.
// blockGuests: guests have no password to change.
router.post('/change-password', requireAuth, blockGuests, changePassword);

export default router;

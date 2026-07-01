import { Alert } from 'react-native';
import { useUserStore } from '../store/useUserStore';
import { navigateToAuth } from '../navigation/navigationRef';
import { setOnGuestBlocked } from '../config/api';

// Shared "you must sign up first" gate for guest (anonymous) sessions. Used both
// proactively (call requireRealUser before a social write to skip the wasted
// request) and reactively (the api.ts interceptor calls promptSignup on a
// GUEST_SIGNUP_REQUIRED 403).

export function isGuestUser(): boolean {
  return useUserStore.getState().user?.isGuest === true;
}

export function promptSignup(message = 'Create a free account to do that.'): void {
  Alert.alert('Sign up to continue', message, [
    { text: 'Not now', style: 'cancel' },
    { text: 'Sign Up', onPress: () => navigateToAuth('Signup') },
  ]);
}

/**
 * Returns true if the current user is a real account (action may proceed). If
 * they're a guest, shows the signup prompt and returns false so the caller
 * aborts the action.
 */
export function requireRealUser(message?: string): boolean {
  if (isGuestUser()) {
    promptSignup(message);
    return false;
  }
  return true;
}

// Wire the interceptor's central guest-blocked handler to the same prompt.
setOnGuestBlocked(() => promptSignup());

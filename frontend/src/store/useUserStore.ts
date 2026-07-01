import { create } from 'zustand';
import { Platform } from 'react-native';
import axios from 'axios';
import { User } from '../types';
import { storage } from '../utils/storage';
import api, { setOnAuthFailure } from '../config/api';

// Stable per-device identifier so the backend can reuse one guest per device
// (POST /auth/guest) instead of minting a new row on every logout/reopen. iOS
// identifierForVendor is vendor-scoped (not cross-app tracking, no ATT prompt);
// Android SSAID is the analogue. Null on failure/web → server mints per-call.
//
// expo-application is a NATIVE module. It's lazy-required inside the try (typed
// via `typeof import`, which is erased at runtime) so a dev client that doesn't
// yet bundle ExpoApplication — e.g. before the rebuild that adds the dependency
// — degrades to "no device id" instead of crashing at startup. A top-level
// import would evaluate the missing native module during bundle load and throw
// before any guard could catch it. After the dev-client rebuild this resolves
// normally.
async function getDeviceId(): Promise<string | null> {
  try {
    // Lazy require (not import) so jest's expo-application mock applies and the
    // native module is only touched when actually present at runtime.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Application = require('expo-application') as typeof import('expo-application');
    if (Platform.OS === 'ios') return await Application.getIosIdForVendorAsync();
    if (Platform.OS === 'android') return Application.getAndroidId();
  } catch {
    // Native module absent (pre-rebuild) or the call failed — fall back to the
    // per-call guest behavior so the app still launches and works.
  }
  return null;
}

interface UserStore {
  user: User | null;
  accessToken: string | null;
  isLoading: boolean;
  isInitialized: boolean;
  // True when bootstrap couldn't establish ANY session (network/5xx, including a
  // failed guest mint). The navigator shows a retry instead of stranding on a
  // blank state or silently demoting a real user to a guest.
  bootstrapError: boolean;
  // True when a *real* user's session ended and couldn't be recovered (dead/
  // expired token). The navigator shows the Login flow so they can sign back
  // into their real account, rather than silently minting a guest. New/guest
  // sessions never set this — they fall back to a fresh guest instead.
  sessionEnded: boolean;

  initialize: () => Promise<void>;
  // Mints a fresh anonymous guest session (tokens + user). Used on first launch
  // and after logout, so the app always lands on the browsable guest experience
  // rather than a blank/null state. `welcomeCredits` defaults to true (the
  // new-visitor free-try-on hook); pass false for logout so a former real user
  // isn't handed a fresh credit grant.
  createGuestSession: (welcomeCredits?: boolean) => Promise<void>;
  setUser: (user: User, accessToken: string, refreshToken: string) => Promise<void>;
  updateUser: (partial: Partial<User>) => void;
  refreshUser: () => Promise<void>;
  logout: () => Promise<void>;
  sessionExpired: () => Promise<void>;
}

export const useUserStore = create<UserStore>((set, get) => ({
  user: null,
  accessToken: null,
  isLoading: false,
  isInitialized: false,
  bootstrapError: false,
  sessionEnded: false,

  createGuestSession: async (welcomeCredits = true) => {
    const deviceId = await getDeviceId();
    const { data } = await api.post('/auth/guest', { welcomeCredits, deviceId });
    await storage.setTokens(data.accessToken, data.refreshToken);
    await storage.setSessionKind('guest');
    set({
      user: { ...data.user, isGuest: true },
      accessToken: data.accessToken,
      sessionEnded: false,
    });
  },

  initialize: async () => {
    set({ isLoading: true, bootstrapError: false, sessionEnded: false });
    try {
      const token = await storage.getAccessToken();
      if (token) {
        // Read the session kind BEFORE the profile call. If that call 401s, the
        // api interceptor's failed refresh clears the tokens AND this marker
        // before our catch runs — reading it afterwards always yields null,
        // which mis-routes a dead guest session to the Login screen.
        const kind = await storage.getSessionKind();
        try {
          const { data } = await api.get<User>('/profile/me');
          // Keep the session-kind marker fresh (covers tokens stored before this
          // marker existed, and upgrades-in-place via claim).
          await storage.setSessionKind(data.isGuest ? 'guest' : 'real');
          set({ user: data, accessToken: token });
        } catch (err) {
          // A stored token the server rejects (401) OR that resolves to no user
          // (404 — account deleted / dev DB reset) is unusable. Any 4xx is an
          // auth/identity problem, not a transient one. A network error or 5xx
          // is transient, so preserve the token and surface a retry instead.
          const status = axios.isAxiosError(err) ? err.response?.status : undefined;
          if (status !== undefined && status >= 400 && status < 500) {
            await storage.clearTokens();
            if (kind === 'guest') {
              // A guest's token expired/was cleaned up → just mint a new guest.
              await get().createGuestSession();
            } else {
              // A real user (kind 'real'), or an unknown token from a pre-marker
              // build — route to Login so they re-authenticate into their real
              // account rather than being silently demoted to a credited guest.
              set({ user: null, accessToken: null, sessionEnded: true });
            }
          } else {
            throw err;
          }
        }
      } else {
        // No stored token at all = genuinely first-time/anonymous → guest.
        await get().createGuestSession();
      }
    } catch {
      set({ bootstrapError: true });
    } finally {
      set({ isLoading: false, isInitialized: true });
    }
  },

  setUser: async (user, accessToken, refreshToken) => {
    await storage.setTokens(accessToken, refreshToken);
    await storage.setSessionKind(user.isGuest ? 'guest' : 'real');
    set({ user, accessToken, sessionEnded: false });
  },

  updateUser: (partial) =>
    set((state) => ({ user: state.user ? { ...state.user, ...partial } : null })),

  refreshUser: async () => {
    try {
      const { data } = await api.get<User>('/profile/me');
      set({ user: data });
    } catch {
      // Silently fail - user will see stale data
    }
  },

  logout: async () => {
    const refreshToken = await storage.getRefreshToken();
    if (refreshToken) {
      api.post('/auth/logout', { refreshToken }).catch(() => {});
    }
    await storage.clearTokens();
    // Drop back to a guest session rather than a null user so the always-mounted
    // tabs stay usable (browsable feed) after logout. welcomeCredits:false — a
    // user logging out of a real account must NOT be granted fresh free credits.
    // If the guest mint fails (offline), fall back to null + retry state.
    try {
      await get().createGuestSession(false);
    } catch {
      set({ user: null, accessToken: null, bootstrapError: true });
    }
  },

  // Called when a token refresh fails irrecoverably mid-session (see api.ts).
  // The interceptor already cleared the tokens (and the kind marker) before
  // invoking this, so decide from the in-memory user: a real user is routed to
  // Login to sign back into their account; a guest falls back to a fresh guest
  // so browsing stays available.
  sessionExpired: async () => {
    // Concurrent 401s (feed + polls failing together) invoke this repeatedly.
    // Once the first call has routed a real user to Login, a trailing call sees
    // user=null and — without this guard — would take the guest branch, minting
    // a guest that flips sessionEnded back off and yanks the navigator from
    // Login back to the tabs mid-transition (seen live after a dev DB wipe:
    // stuck on the feed with a spinner instead of landing on Login).
    if (get().sessionEnded) return;
    const user = get().user;
    // No in-memory user = we're inside bootstrap; initialize() owns the routing
    // decision in that window (it read the session kind up front). Doing a
    // guest mint here too would race it.
    if (!user) return;
    await storage.clearTokens();
    if (!user.isGuest) {
      set({ user: null, accessToken: null, sessionEnded: true });
      return;
    }
    try {
      await get().createGuestSession();
    } catch {
      set({ user: null, accessToken: null, bootstrapError: true });
    }
  },
}));

// Let the API layer trigger a clean logout when a refresh fails. Registered here
// (rather than api.ts importing the store) to avoid a circular dependency.
setOnAuthFailure(() => {
  void useUserStore.getState().sessionExpired();
});

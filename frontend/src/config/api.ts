import axios from 'axios';
import { Alert } from 'react-native';
import { storage } from '../utils/storage';

// ============================================
// API ENVIRONMENT CONFIGURATION
// ============================================
// Pick the backend this build talks to by setting ENV below:
//   - 'local'   = Local development. Replace LOCAL_URL with whatever the device
//                 can actually reach: a LAN IP for an emulator on the same Wi-Fi,
//                 or your personal ngrok hostname for a physical device. Do NOT
//                 commit your ngrok URL — it's tied to your free-tier session.
//   - 'dev' = Dev server (animationstation.bruhnfreeman.com/api). Used for the
//                 Expo dev-client builds that exercise the dev backend,
//                 including Apple Sandbox in-app purchases.
//   - 'prod'    = Live server (animationstation.bruhnfreeman.com/api).
//
// ⚠️ MUST be 'prod' for any App Store / production EAS build. A dev or local
//    URL shipped to the App Store points real users at the wrong backend.
//    Confirm ENV === 'prod' in the release checklist before `eas build --profile production`.
// ============================================
type ApiEnv = 'local' | 'dev' | 'prod';
// `as ApiEnv` keeps the type as the full union (not the narrowed 'prod' literal)
// so the comparisons below type-check when you flip this to 'dev' or 'local'.
const ENV = 'prod' as ApiEnv;

const LOCAL_URL = 'http://localhost:3000/api';
const DEV_URL = 'https://animationstation.bruhnfreeman.com/api';
const LIVE_URL = 'https://animationstation.bruhnfreeman.com/api';

export const BASE_URL = ENV === 'local' ? LOCAL_URL : ENV === 'dev' ? DEV_URL : LIVE_URL;

// Loud reminder in dev builds when not pointed at production, so a stray
// 'dev'/'local' value can't silently ride along into a release build.
if (__DEV__ && ENV !== 'prod') {
  console.warn(
    `[api] BASE_URL is "${ENV}" (${BASE_URL}). Set ENV='prod' before any production build.`,
  );
}

const api = axios.create({ baseURL: BASE_URL, timeout: 30000 });

// Registered by the user store so the response interceptor can force a clean
// logout (drop in-memory auth state → navigator routes to Login) when a refresh
// fails irrecoverably. Done via a registered callback rather than importing the
// store directly, which would create a circular dependency (the store imports
// this module).
let onAuthFailure: (() => void) | null = null;
export function setOnAuthFailure(handler: () => void): void {
  onAuthFailure = handler;
}

// Registered by the guest gate so the response interceptor can centrally prompt
// signup when the backend rejects a guest's write with GUEST_SIGNUP_REQUIRED.
// This is the safety net behind the proactive client-side checks (which avoid
// the wasted round-trip for the common case).
let onGuestBlocked: (() => void) | null = null;
export function setOnGuestBlocked(handler: () => void): void {
  onGuestBlocked = handler;
}

// Single-flight token refresh. When several requests get a 401 at once, the
// first performs the refresh and the rest queue here. Every queued waiter MUST
// be settled exactly once — resolved with the new token, or rejected if the
// refresh fails. This is critical: a waiter is a bare Promise wrapper with no
// HTTP timeout, so silently dropping one strands the awaiting request forever.
let isRefreshing = false;
let refreshQueue: {
  resolve: (token: string) => void;
  reject: (err: unknown) => void;
}[] = [];

function settleRefreshQueue(token: string | null, err: unknown) {
  const queued = refreshQueue;
  refreshQueue = [];
  for (const { resolve, reject } of queued) {
    if (token) resolve(token);
    else reject(err);
  }
}

api.interceptors.request.use(async (config) => {
  const token = await storage.getAccessToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  // Skip ngrok browser warning for API calls
  config.headers['ngrok-skip-browser-warning'] = 'true';
  return config;
});

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config;

    // Guest attempted a write the backend gates behind sign-up. Surface the
    // signup prompt centrally so even un-wrapped call sites recover gracefully.
    if (error.response?.status === 403 && error.response?.data?.error === 'GUEST_SIGNUP_REQUIRED') {
      onGuestBlocked?.();
      return Promise.reject(error);
    }

    if (error.response?.status === 401 && original && !original._retry) {
      original._retry = true;

      // A refresh is already in flight — wait for its outcome instead of
      // starting a second one. settleRefreshQueue() below always settles this
      // Promise (resolve on success, reject on failure), so it cannot strand.
      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          refreshQueue.push({
            resolve: (token) => {
              original.headers.Authorization = `Bearer ${token}`;
              resolve(api(original));
            },
            reject,
          });
        });
      }

      isRefreshing = true;
      try {
        const refreshToken = await storage.getRefreshToken();
        if (!refreshToken) throw new Error('No refresh token');
        // Bare axios (not the `api` instance) so this call doesn't recurse
        // through this interceptor. An explicit timeout is required — the
        // global axios default is no timeout, so a stalled refresh would hang
        // every queued request indefinitely.
        const { data } = await axios.post(
          `${BASE_URL}/auth/refresh`,
          { refreshToken },
          { timeout: 30000 },
        );
        // Forward-compatible with refresh-token rotation: persist a rotated
        // refreshToken if the backend returns one, otherwise keep the current
        // token. Lets this build ship before the server enables rotation.
        await storage.setTokens(data.accessToken, data.refreshToken ?? refreshToken);
        settleRefreshQueue(data.accessToken, null);
        original.headers.Authorization = `Bearer ${data.accessToken}`;
        return api(original);
      } catch (refreshErr) {
        await storage.clearTokens();
        // Reject every queued waiter so their requests fail fast instead of
        // hanging forever.
        settleRefreshQueue(null, refreshErr);
        // Force a clean logout so the navigator routes to Login, rather than
        // stranding the user on an authed screen with a generic data error.
        // Only show the "session expired" prompt on a real auth rejection (401);
        // a transient network failure during refresh shouldn't alarm the user.
        if (axios.isAxiosError(refreshErr) && refreshErr.response?.status === 401) {
          Alert.alert('Session expired', 'Please sign in again.');
        }
        onAuthFailure?.();
        return Promise.reject(refreshErr);
      } finally {
        isRefreshing = false;
      }
    }
    return Promise.reject(error);
  },
);

export default api;

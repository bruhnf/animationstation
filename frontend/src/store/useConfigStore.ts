import { create } from 'zustand';
import api from '../config/api';

// Server-controlled client config (public, unauthenticated GET /api/config).
// Fetched once on launch so promotional copy can change without an app rebuild.
//
// `signupCreditGrant` is the live "free credits when you join" amount; 0 means
// the offer is discontinued. `signupCreditsOffer` is the convenience boolean
// (grant > 0). The defaults below match the backend default so the very first
// render (before the fetch resolves) shows a sensible, honest offer rather than
// flashing 0 — the fetch then corrects it if an admin has changed it.
interface ConfigStore {
  signupCreditGrant: number;
  signupCreditsOffer: boolean;
  // Live credits charged per AI video (admin-tunable). Defaults to the backend
  // default so the first render before the fetch is honest.
  videoCreditCost: number;
  // Admin toggle: when true, the welcome splash screen is shown at login (users
  // can still opt out locally). Default false.
  welcomeSplashEnabled: boolean;
  loaded: boolean;
  fetchConfig: () => Promise<void>;
}

const DEFAULT_SIGNUP_CREDIT_GRANT = 10;
const DEFAULT_VIDEO_CREDIT_COST = 2;

export const useConfigStore = create<ConfigStore>((set) => ({
  signupCreditGrant: DEFAULT_SIGNUP_CREDIT_GRANT,
  signupCreditsOffer: true,
  videoCreditCost: DEFAULT_VIDEO_CREDIT_COST,
  welcomeSplashEnabled: false,
  loaded: false,

  fetchConfig: async () => {
    try {
      // Cache-buster: defense-in-depth against any client/CDN caching so an
      // admin change to the join offer is always reflected on the next launch.
      // (The backend also sends `Cache-Control: no-store`.)
      const { data } = await api.get('/config', { params: { t: Date.now() } });
      const grant =
        typeof data?.signupCreditGrant === 'number' && data.signupCreditGrant >= 0
          ? Math.floor(data.signupCreditGrant)
          : DEFAULT_SIGNUP_CREDIT_GRANT;
      const videoCost =
        typeof data?.videoCreditCost === 'number' && data.videoCreditCost >= 1
          ? Math.floor(data.videoCreditCost)
          : DEFAULT_VIDEO_CREDIT_COST;
      set({
        signupCreditGrant: grant,
        signupCreditsOffer: grant > 0,
        videoCreditCost: videoCost,
        welcomeSplashEnabled: data?.welcomeSplashEnabled === true,
        loaded: true,
      });
    } catch {
      // Network/endpoint error: keep the defaults (an honest standing offer) and
      // mark loaded so the UI doesn't sit in a loading state. The actual grant is
      // enforced server-side at verify time regardless of what the copy shows.
      set({ loaded: true });
    }
  },
}));

/**
 * Functional tests for the session-expiry race fix (2026-06-10): concurrent
 * 401s after an irrecoverable refresh failure must route a real user to Login
 * exactly once — a trailing sessionExpired() call must NOT demote them to a
 * fresh guest and yank the navigator back to the tabs.
 */
jest.mock('../../config/api', () => ({
  __esModule: true,
  default: { post: jest.fn(), get: jest.fn() },
  setOnAuthFailure: jest.fn(),
  BASE_URL: 'http://test/api',
}));
jest.mock('../../utils/storage', () => ({
  storage: {
    setTokens: jest.fn().mockResolvedValue(undefined),
    getAccessToken: jest.fn().mockResolvedValue(null),
    getRefreshToken: jest.fn().mockResolvedValue(null),
    setSessionKind: jest.fn().mockResolvedValue(undefined),
    getSessionKind: jest.fn().mockResolvedValue(null),
    clearTokens: jest.fn().mockResolvedValue(undefined),
  },
}));
jest.mock('expo-application', () => ({
  getIosIdForVendorAsync: jest.fn().mockResolvedValue('test-device-id'),
  getAndroidId: jest.fn().mockReturnValue('test-android-id'),
}));

import api from '../../config/api';
import { useUserStore } from '../useUserStore';
import type { User } from '../../types';

const realUser = { id: 'u1', username: 'jane', isGuest: false } as unknown as User;
const guestUser = { id: 'g1', username: 'user1234567', isGuest: true } as unknown as User;

const guestMintResponse = {
  data: {
    accessToken: 'new-access',
    refreshToken: 'new-refresh',
    user: { id: 'g2', username: 'user7654321', isGuest: true, credits: 2 },
  },
};

function resetStore(partial: Partial<ReturnType<typeof useUserStore.getState>>) {
  useUserStore.setState({
    user: null,
    accessToken: null,
    isLoading: false,
    isInitialized: true,
    bootstrapError: false,
    sessionEnded: false,
    ...partial,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  (api.post as jest.Mock).mockResolvedValue(guestMintResponse);
});

describe('sessionExpired — real user', () => {
  it('routes a real user to Login (sessionEnded) without minting a guest', async () => {
    resetStore({ user: realUser, accessToken: 'tok' });
    await useUserStore.getState().sessionExpired();

    const s = useUserStore.getState();
    expect(s.user).toBeNull();
    expect(s.sessionEnded).toBe(true);
    expect(api.post).not.toHaveBeenCalled(); // no guest mint
  });

  it('is idempotent: a trailing call after sessionEnded must NOT demote to guest (the race)', async () => {
    resetStore({ user: realUser, accessToken: 'tok' });
    await useUserStore.getState().sessionExpired(); // first 401 → Login
    await useUserStore.getState().sessionExpired(); // trailing 401 → must no-op

    const s = useUserStore.getState();
    expect(s.sessionEnded).toBe(true); // NOT flipped back off
    expect(s.user).toBeNull(); // NOT replaced by a fresh guest
    expect(api.post).not.toHaveBeenCalled();
  });

  it('no-ops during bootstrap (no in-memory user): initialize() owns routing in that window', async () => {
    resetStore({ user: null });
    await useUserStore.getState().sessionExpired();

    const s = useUserStore.getState();
    expect(s.sessionEnded).toBe(false);
    expect(api.post).not.toHaveBeenCalled();
  });
});

describe('sessionExpired — guest', () => {
  it('falls back to a fresh guest session so browsing stays available', async () => {
    resetStore({ user: guestUser, accessToken: 'tok' });
    await useUserStore.getState().sessionExpired();

    const s = useUserStore.getState();
    expect(api.post).toHaveBeenCalledWith('/auth/guest', expect.any(Object));
    expect(s.user?.isGuest).toBe(true);
    expect(s.user?.id).toBe('g2'); // the NEW guest
    expect(s.sessionEnded).toBe(false);
  });

  it('surfaces a retry state instead of a blank screen when the guest mint fails', async () => {
    (api.post as jest.Mock).mockRejectedValueOnce(new Error('network down'));
    resetStore({ user: guestUser, accessToken: 'tok' });
    await useUserStore.getState().sessionExpired();

    const s = useUserStore.getState();
    expect(s.user).toBeNull();
    expect(s.bootstrapError).toBe(true);
  });
});

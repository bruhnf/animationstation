/**
 * Functional tests for ProfileScreen's focus-refresh contract.
 *
 * The creations grid (history + closet fetching) now lives in the embedded
 * <CreationsGrid>, which is stubbed here so these tests exercise only what
 * ProfileScreen itself owns: on every tab focus it calls refreshUser() to keep
 * the header stats (credits, creation count) current. The tab navigator keeps the
 * screen mounted, so this must fire on EVERY focus, not just first mount.
 */
import React from 'react';
import { render, act, waitFor } from '@testing-library/react-native';

// Captures the callback ProfileScreen registers with useFocusEffect so tests
// can simulate the tab gaining focus any number of times.
let mockFocusCallback: (() => void) | null = null;

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn() }),
  useFocusEffect: (cb: () => void) => {
    mockFocusCallback = cb;
  },
}));
jest.mock('../../config/api', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() },
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
jest.mock('expo-image-picker', () => ({
  requestCameraPermissionsAsync: jest.fn(),
  requestMediaLibraryPermissionsAsync: jest.fn(),
  launchCameraAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
  MediaTypeOptions: { Images: 'Images' },
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('../../utils/imageUtils', () => ({
  processImageForUpload: jest.fn(),
  isLowResolution: jest.fn(() => false),
  confirmLowResolution: jest.fn(),
}));
// Child components are out of scope here — stub them as host components so
// this test exercises only ProfileScreen's data-fetching contract. CreationsGrid
// owns the history/closet fetching + its own focus refresh; stubbing it isolates
// ProfileScreen's own contract (refreshUser on focus).
jest.mock('../../components/CreationsGrid', () => 'CreationsGrid');
jest.mock('../../components/CreationDetailModal', () => 'CreationDetailModal');
jest.mock('../../components/RetryableImage', () => 'RetryableImage');
jest.mock('../../components/UploadTipsSheet', () => 'UploadTipsSheet');

import api from '../../config/api';
import { useUserStore } from '../../store/useUserStore';
import type { User } from '../../types';
import ProfileScreen from '../ProfileScreen';

const profileUser = {
  id: 'u1',
  username: 'jane',
  email: 'jane@example.com',
  isGuest: false,
  tier: 'FREE',
  credits: 10,
  creationCount: 3,
  followersCount: 1,
  followingCount: 2,
  likesCount: 0,
  verified: true,
} as unknown as User;

function mockApiRoutes() {
  (api.get as jest.Mock).mockImplementation((url: string) => {
    if (url === '/profile/me') return Promise.resolve({ data: profileUser });
    return Promise.reject(new Error(`unexpected GET ${url}`));
  });
}

async function focusScreen() {
  // The first render's commit can be async-scheduled (React 19 concurrent
  // rendering), so wait for the component to register its focus effect. The
  // very first render in the suite also pays the cold transform/init cost, which
  // on a slow CI runner can exceed waitFor's 1s default and leave the callback
  // unset — so give it a generous timeout (waitFor polls, so a warm render still
  // resolves immediately and this costs nothing in the common case).
  await waitFor(() => expect(mockFocusCallback).not.toBeNull(), { timeout: 10000 });
  await act(async () => {
    mockFocusCallback!();
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockFocusCallback = null;
  mockApiRoutes();
  useUserStore.setState({
    user: profileUser,
    accessToken: 'tok',
    isLoading: false,
    isInitialized: true,
    bootstrapError: false,
    sessionEnded: false,
  });
});

describe('ProfileScreen focus refresh', () => {
  it('refreshes user stats when the tab gains focus', async () => {
    render(<ProfileScreen />);
    await focusScreen();

    expect(api.get).toHaveBeenCalledWith('/profile/me');
  });

  it('re-fetches on EVERY focus, not just the first (the stale-header bug)', async () => {
    render(<ProfileScreen />);

    await focusScreen(); // initial load
    (api.get as jest.Mock).mockClear();
    mockApiRoutes();

    await focusScreen(); // user comes back from another tab
    expect(api.get).toHaveBeenCalledWith('/profile/me');

    (api.get as jest.Mock).mockClear();
    mockApiRoutes();

    await focusScreen(); // and again — every focus re-fetches
    expect(api.get).toHaveBeenCalledWith('/profile/me');
  });

  it('updates the stored user from the focus refresh (stats stay current)', async () => {
    const refreshedUser = { ...profileUser, creationCount: 4, credits: 9 };
    (api.get as jest.Mock).mockImplementation((url: string) => {
      if (url === '/creations/history') return Promise.resolve({ data: { jobs: [] } });
      if (url === '/profile/me') return Promise.resolve({ data: refreshedUser });
      return Promise.reject(new Error(`unexpected GET ${url}`));
    });

    render(<ProfileScreen />);
    await focusScreen();

    const stored = useUserStore.getState().user;
    expect(stored?.creationCount).toBe(4);
    expect(stored?.credits).toBe(9);
  });

  it('survives a failed history fetch without crashing (offline focus)', async () => {
    (api.get as jest.Mock).mockRejectedValue(new Error('network down'));

    render(<ProfileScreen />);
    await focusScreen();

    // Screen still mounted, store untouched.
    expect(useUserStore.getState().user?.id).toBe('u1');
  });
});

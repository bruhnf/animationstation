import * as SecureStore from 'expo-secure-store';

const ACCESS_TOKEN_KEY = 'access_token';
const REFRESH_TOKEN_KEY = 'refresh_token';
// 'real' | 'guest' — records what kind of session the stored tokens belong to,
// so that when a stored session turns out to be dead on bootstrap we can tell a
// returning real user (→ route to Login to re-authenticate) apart from a guest
// or a genuinely first-time user (→ mint a fresh guest). Cleared with the tokens.
const SESSION_KIND_KEY = 'session_kind';

export type SessionKind = 'real' | 'guest';

export const storage = {
  setTokens: async (accessToken: string, refreshToken: string) => {
    await SecureStore.setItemAsync(ACCESS_TOKEN_KEY, accessToken);
    await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, refreshToken);
  },
  getAccessToken: () => SecureStore.getItemAsync(ACCESS_TOKEN_KEY),
  getRefreshToken: () => SecureStore.getItemAsync(REFRESH_TOKEN_KEY),
  setSessionKind: (kind: SessionKind) => SecureStore.setItemAsync(SESSION_KIND_KEY, kind),
  getSessionKind: () => SecureStore.getItemAsync(SESSION_KIND_KEY) as Promise<SessionKind | null>,
  clearTokens: async () => {
    await SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY);
    await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY);
    await SecureStore.deleteItemAsync(SESSION_KIND_KEY);
  },
};

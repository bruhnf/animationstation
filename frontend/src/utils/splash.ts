import * as SecureStore from 'expo-secure-store';

// Local tracking for the backend-controlled splash/announcement screen.
// The backend identifies each published splash by an `id` that changes
// whenever the image file is replaced. All "seen / don't show again" state is
// keyed on that id, so a NEW splash always shows at least once even to users
// who dismissed the previous one.

const SPLASH_STATE_KEY = 'splash_state';

export interface SplashInfo {
  id: string;
  imageUrl: string;
}

export interface SplashLocalState {
  id: string; // which published splash this state belongs to
  seenCount: number; // launches on which this splash was displayed
  dismissed: boolean; // user opted out of seeing this splash again
}

export interface SplashDisplayDecision {
  show: boolean;
  // Offer the "Don't show this again" option only from the second showing
  // onward — the first time a new splash is published, the user must simply
  // tap OK.
  offerDismiss: boolean;
  // State to persist when the splash is shown (seenCount already incremented).
  nextState: SplashLocalState | null;
}

// Pure decision logic — unit-tested in __tests__/splash.test.ts.
export function resolveSplashDisplay(
  current: SplashInfo | null,
  stored: SplashLocalState | null,
): SplashDisplayDecision {
  if (!current) return { show: false, offerDismiss: false, nextState: null };

  // A different id than what we tracked means a new splash was published —
  // start fresh (forces at least one showing and clears any old opt-out).
  const base: SplashLocalState =
    stored && stored.id === current.id
      ? stored
      : { id: current.id, seenCount: 0, dismissed: false };

  if (base.dismissed) return { show: false, offerDismiss: false, nextState: null };

  return {
    show: true,
    offerDismiss: base.seenCount >= 1,
    nextState: { ...base, seenCount: base.seenCount + 1 },
  };
}

export async function getSplashLocalState(): Promise<SplashLocalState | null> {
  try {
    const raw = await SecureStore.getItemAsync(SPLASH_STATE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SplashLocalState;
    if (typeof parsed.id !== 'string') return null;
    return {
      id: parsed.id,
      seenCount: typeof parsed.seenCount === 'number' ? parsed.seenCount : 0,
      dismissed: parsed.dismissed === true,
    };
  } catch {
    return null;
  }
}

export async function setSplashLocalState(state: SplashLocalState): Promise<void> {
  try {
    await SecureStore.setItemAsync(SPLASH_STATE_KEY, JSON.stringify(state));
  } catch {
    // Non-fatal — worst case the splash shows again next launch.
  }
}

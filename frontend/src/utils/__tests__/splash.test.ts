import { resolveSplashDisplay, SplashLocalState } from '../splash';

const splash = { id: 'abc123', imageUrl: 'https://api.example.com/api/splash/image?v=abc123' };

describe('resolveSplashDisplay', () => {
  it('does not show when no splash is published', () => {
    expect(resolveSplashDisplay(null, null)).toEqual({
      show: false,
      offerDismiss: false,
      nextState: null,
    });
    const stored: SplashLocalState = { id: 'abc123', seenCount: 3, dismissed: false };
    expect(resolveSplashDisplay(null, stored).show).toBe(false);
  });

  it('first showing of a new splash: show, no dismiss option', () => {
    const d = resolveSplashDisplay(splash, null);
    expect(d.show).toBe(true);
    expect(d.offerDismiss).toBe(false);
    expect(d.nextState).toEqual({ id: 'abc123', seenCount: 1, dismissed: false });
  });

  it('second showing: show with the dismiss option', () => {
    const d = resolveSplashDisplay(splash, { id: 'abc123', seenCount: 1, dismissed: false });
    expect(d.show).toBe(true);
    expect(d.offerDismiss).toBe(true);
    expect(d.nextState).toEqual({ id: 'abc123', seenCount: 2, dismissed: false });
  });

  it('does not show once dismissed', () => {
    const d = resolveSplashDisplay(splash, { id: 'abc123', seenCount: 2, dismissed: true });
    expect(d.show).toBe(false);
    expect(d.nextState).toBeNull();
  });

  it('a NEWLY published splash overrides a previous dismissal and resets the count', () => {
    const d = resolveSplashDisplay(splash, { id: 'old-splash', seenCount: 5, dismissed: true });
    expect(d.show).toBe(true);
    expect(d.offerDismiss).toBe(false); // first showing of the new one
    expect(d.nextState).toEqual({ id: 'abc123', seenCount: 1, dismissed: false });
  });
});

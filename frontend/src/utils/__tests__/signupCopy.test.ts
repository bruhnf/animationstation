import { getSignupCopy, FREE_BULLETS, SignupContext } from '../signupCopy';

describe('getSignupCopy', () => {
  const contexts: SignupContext[] = [
    'design',
    'video',
    'credits',
    'inbox',
    'profile',
    'save',
    'generic',
  ];

  it('returns a title + message + the free bullets for every context', () => {
    for (const ctx of contexts) {
      const copy = getSignupCopy(ctx);
      expect(copy.title.length).toBeGreaterThan(0);
      expect(copy.message.length).toBeGreaterThan(0);
      expect(copy.bullets).toEqual([...FREE_BULLETS]);
    }
  });

  it('always leads with the free / no-credit-card reassurance', () => {
    const copy = getSignupCopy('design');
    expect(copy.bullets[0].toLowerCase()).toContain('free');
    expect(copy.bullets.some((b) => b.toLowerCase().includes('no credit card'))).toBe(true);
    expect(copy.bullets.some((b) => b.toLowerCase().includes('subscription'))).toBe(true);
  });

  it('uses context-specific copy (design vs video differ)', () => {
    expect(getSignupCopy('design').message).not.toEqual(getSignupCopy('video').message);
    expect(getSignupCopy('video').title.toLowerCase()).toContain('animate');
  });

  it('falls back to generic copy for an unknown context', () => {
    const copy = getSignupCopy('nonsense' as SignupContext);
    expect(copy.title).toEqual(getSignupCopy('generic').title);
  });
});

/**
 * Guards the Apple 5.1.1(i)/5.1.2(i) consent disclosure copy via the pure copy
 * helper (the modal renders straight from this). The copy must accurately
 * describe what is sent for the CURRENT flow — the video flow produces a video
 * from a motion prompt, so reusing the image-generation copy would be a (soft)
 * rejection risk. Pure test (no RN render) so it can't be defeated by renderer
 * version quirks.
 */
import { getAiConsentCopy } from '../aiConsentCopy';

describe('getAiConsentCopy', () => {
  it('video mode: describes animating image(s) + a motion prompt, returns a video', () => {
    const c = getAiConsentCopy('video');
    const all = [c.actionPhrase, ...c.bullets, c.outputPhrase].join(' ');
    expect(all).toContain('animate');
    expect(all).toContain('motion prompt');
    expect(all).toContain('generated video');
    expect(c.bullets.length).toBe(2);
  });

  it('image mode: describes the photo(s) + text prompt, returns a generated image', () => {
    const c = getAiConsentCopy('transform');
    const all = [c.actionPhrase, ...c.bullets, c.outputPhrase].join(' ');
    expect(all).toContain('photo');
    expect(all).toContain('text prompt');
    expect(all).toContain('generated image');
    expect(all).not.toContain('motion prompt');
    expect(c.bullets.length).toBe(2);
  });

  it('neither mode leaks the other mode’s wording', () => {
    expect(getAiConsentCopy('video').outputPhrase).not.toContain('generated image');
    expect(getAiConsentCopy('transform').outputPhrase).not.toContain('video');
  });
});

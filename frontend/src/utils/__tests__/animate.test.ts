import { animatableImageUrl, canMakeVideo } from '../animate';

describe('animatableImageUrl', () => {
  it('returns the primary result image for an image creation', () => {
    expect(
      animatableImageUrl({ kind: 'IMAGE', resultImageUrl: 'a.jpg', resultImage2Url: 'b.jpg' }),
    ).toBe('a.jpg');
  });

  it('falls back to the second result when the primary is missing', () => {
    expect(
      animatableImageUrl({ kind: 'IMAGE', resultImageUrl: undefined, resultImage2Url: 'b.jpg' }),
    ).toBe('b.jpg');
  });

  it('treats a missing kind as an image (old payloads)', () => {
    expect(animatableImageUrl({ resultImageUrl: 'a.jpg' })).toBe('a.jpg');
  });

  it('returns null for a video creation (nothing to animate)', () => {
    expect(
      animatableImageUrl({ kind: 'VIDEO', resultImageUrl: 'a.jpg', resultImage2Url: 'b.jpg' }),
    ).toBeNull();
  });

  it('returns null when there is no result image at all', () => {
    expect(animatableImageUrl({ kind: 'IMAGE' })).toBeNull();
  });
});

describe('canMakeVideo', () => {
  it('is true for an image creation with a result', () => {
    expect(canMakeVideo({ kind: 'IMAGE', resultImageUrl: 'a.jpg' })).toBe(true);
  });

  it('is false for a video creation', () => {
    expect(canMakeVideo({ kind: 'VIDEO', resultImageUrl: 'a.jpg' })).toBe(false);
  });

  it('is false for an image creation with no result image', () => {
    expect(canMakeVideo({ kind: 'IMAGE' })).toBe(false);
  });
});

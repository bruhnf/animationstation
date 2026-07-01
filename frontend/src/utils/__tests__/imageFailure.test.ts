import { classifyImageProbe } from '../imageFailure';

describe('classifyImageProbe — permanent vs transient image failures', () => {
  it('treats 404 (S3 NoSuchKey — object deleted) as permanent', () => {
    expect(classifyImageProbe(404)).toBe('permanent');
  });

  it('treats 403 (expired/denied presigned URL) as permanent for the same URL', () => {
    expect(classifyImageProbe(403)).toBe('permanent');
  });

  it('treats 410 Gone as permanent', () => {
    expect(classifyImageProbe(410)).toBe('permanent');
  });

  it('treats success-ish statuses as transient (render hiccup, retry can work)', () => {
    expect(classifyImageProbe(200)).toBe('transient');
    expect(classifyImageProbe(206)).toBe('transient');
    expect(classifyImageProbe(416)).toBe('transient');
  });

  it('treats server errors and throttling as transient', () => {
    expect(classifyImageProbe(500)).toBe('transient');
    expect(classifyImageProbe(503)).toBe('transient');
    expect(classifyImageProbe(429)).toBe('transient');
  });

  it('treats a network failure (null status) as transient', () => {
    expect(classifyImageProbe(null)).toBe('transient');
  });
});

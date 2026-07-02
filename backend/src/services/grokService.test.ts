/**
 * Unit tests for grokService's pure parsers — both are security-relevant:
 *  - detectImageFormat: the only gate that rejects non-image bytes before they
 *    reach the AI provider (magic-byte sniffing, not Content-Type trust).
 *  - resolveS3Key: decides whether an input ref is treated as one of OUR S3
 *    keys vs. something else (foreign URLs must NOT be misread as keys).
 * Run with: npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectImageFormat, resolveS3Key } from './grokService';

test('detectImageFormat accepts JPEG/PNG/WebP by magic bytes', () => {
  assert.equal(detectImageFormat(Buffer.from([0xff, 0xd8, 0xff, 0xe0])), 'jpeg');
  assert.equal(detectImageFormat(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a])), 'png');
  const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.from([1, 2, 3, 4]), Buffer.from('WEBP')]);
  assert.equal(detectImageFormat(webp), 'webp');
});

test('detectImageFormat rejects non-image, short, and look-alike buffers', () => {
  assert.equal(detectImageFormat(Buffer.from('GIF89a')), null, 'GIF is not allowed');
  assert.equal(
    detectImageFormat(Buffer.from('<!DOCTYPE html>')),
    null,
    'HTML error pages rejected',
  );
  assert.equal(detectImageFormat(Buffer.from([0xff, 0xd8])), null, 'truncated JPEG rejected');
  assert.equal(detectImageFormat(Buffer.from([])), null, 'empty buffer rejected');
  // RIFF container that is NOT WebP (e.g. a WAV) must not pass as an image.
  const wav = Buffer.concat([Buffer.from('RIFF'), Buffer.from([1, 2, 3, 4]), Buffer.from('WAVE')]);
  assert.equal(detectImageFormat(wav), null);
});

test('resolveS3Key returns bare keys unchanged (sans leading slash)', () => {
  assert.equal(
    resolveS3Key('source-images/u1/a.jpg', 'animationstation-uploads-dev'),
    'source-images/u1/a.jpg',
  );
  assert.equal(
    resolveS3Key('/ref-images/u1/b.jpg', 'animationstation-uploads-dev'),
    'ref-images/u1/b.jpg',
  );
});

test('resolveS3Key extracts the key from our own (virtual-hosted) S3 URLs', () => {
  assert.equal(
    resolveS3Key(
      'https://animationstation-uploads-dev.s3.amazonaws.com/source-images/u1/a.jpg?X-Amz-Signature=x',
      'animationstation-uploads-dev',
    ),
    'source-images/u1/a.jpg',
  );
});

test('resolveS3Key returns null for foreign hosts (not treated as our key)', () => {
  assert.equal(
    resolveS3Key('https://evil.example.com/x.jpg', 'animationstation-uploads-dev'),
    null,
  );
  assert.equal(
    resolveS3Key('http://169.254.169.254/latest/meta-data/iam/', 'animationstation-uploads-dev'),
    null,
  );
});

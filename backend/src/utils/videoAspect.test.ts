import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nearestVideoAspectRatio } from './videoAspect';

test('exact matches map to themselves', () => {
  assert.equal(nearestVideoAspectRatio(864, 1152), '3:4'); // try-on result canvas
  assert.equal(nearestVideoAspectRatio(1920, 1080), '16:9');
  assert.equal(nearestVideoAspectRatio(1080, 1920), '9:16'); // phone portrait
  assert.equal(nearestVideoAspectRatio(1000, 1000), '1:1');
  assert.equal(nearestVideoAspectRatio(1024, 768), '4:3');
});

test('near-portrait phone photos pick a portrait ratio, never the 16:9 default', () => {
  // A typical 3024x4032 (3:4) iPhone photo.
  assert.equal(nearestVideoAspectRatio(3024, 4032), '3:4');
  // A tall crop closer to 9:16 must NOT collapse to a landscape ratio.
  const r = nearestVideoAspectRatio(900, 1600);
  assert.equal(r, '9:16');
});

test('invalid / missing dimensions fall back to portrait 3:4', () => {
  assert.equal(nearestVideoAspectRatio(undefined, undefined), '3:4');
  assert.equal(nearestVideoAspectRatio(0, 100), '3:4');
  assert.equal(nearestVideoAspectRatio(100, 0), '3:4');
  assert.equal(nearestVideoAspectRatio(null, null), '3:4');
});

test('landscape source picks a landscape ratio (no vertical squish)', () => {
  assert.equal(nearestVideoAspectRatio(1500, 1000), '3:2');
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripNonOwnerJobInputs } from './jobVisibility';

const imageJob = {
  kind: 'IMAGE' as const,
  bodyPhotoUrl: 'body.jpg',
  clothingPhoto1Url: 'cloth1.jpg',
  clothingPhoto2Url: 'cloth2.jpg',
  resultFullBodyUrl: 'result.jpg',
};

const videoJob = {
  kind: 'VIDEO' as const,
  bodyPhotoUrl: 'poster.jpg', // the public poster/thumbnail
  clothingPhoto1Url: 'transition.jpg', // 2nd transition input — private
  clothingPhoto2Url: null,
  videoUrl: 'clip.mp4',
};

test('owner keeps all inputs (IMAGE)', () => {
  assert.deepEqual(stripNonOwnerJobInputs(imageJob, true), imageJob);
});

test('owner keeps all inputs (VIDEO)', () => {
  assert.deepEqual(stripNonOwnerJobInputs(videoJob, true), videoJob);
});

test('non-owner IMAGE: body photo + both clothing inputs stripped, result kept', () => {
  const out = stripNonOwnerJobInputs(imageJob, false);
  assert.equal(out.bodyPhotoUrl, null);
  assert.equal(out.clothingPhoto1Url, null);
  assert.equal(out.clothingPhoto2Url, null);
  assert.equal(out.resultFullBodyUrl, 'result.jpg'); // results stay public
});

test('non-owner VIDEO: poster (bodyPhotoUrl) + videoUrl kept, transition inputs stripped', () => {
  const out = stripNonOwnerJobInputs(videoJob, false);
  assert.equal(out.bodyPhotoUrl, 'poster.jpg'); // poster IS the public thumbnail
  assert.equal(out.videoUrl, 'clip.mp4'); // result stays public
  assert.equal(out.clothingPhoto1Url, null); // 2nd transition image is private
  assert.equal(out.clothingPhoto2Url, null);
});

test('does not mutate the input object', () => {
  const copy = { ...imageJob };
  stripNonOwnerJobInputs(imageJob, false);
  assert.deepEqual(imageJob, copy);
});

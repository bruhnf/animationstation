/**
 * Unit tests for the Grok video poll interpreter. Pure → no env/DB.
 * Run with: npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyVideoPoll } from './videoPoll';

// The EXACT successful response observed from xAI (dev logs, 2026-06-16) for the
// "Mad Hatter" job that was wrongly blocked. Note `respect_moderation: true` —
// a normal field that a substring match on the body mis-read as a block.
const REAL_SUCCESS = {
  status: 'done',
  video: {
    url: 'https://vidgen.x.ai/xai-vidgen-bucket/xai-video-5f6112cd.mp4',
    duration: 8,
    respect_moderation: true,
  },
  model: 'grok-imagine-video',
  usage: { cost_in_usd_ticks: 5620000000 },
  progress: 100,
} as const;

test('the real success response classifies as success (the regression that lost videos)', () => {
  const v = classifyVideoPoll(REAL_SUCCESS);
  assert.equal(v.kind, 'success');
  assert.equal(v.kind === 'success' && v.url, REAL_SUCCESS.video.url);
});

test('respect_moderation:true is NEVER treated as a block', () => {
  assert.equal(
    classifyVideoPoll({ status: 'done', video: { url: 'x', respect_moderation: true } }).kind,
    'success',
  );
  assert.equal(
    classifyVideoPoll({ respect_moderation: true, status: 'processing' }).kind,
    'pending',
  );
});

test('a genuine block (respect_moderation:false, no usable video) is moderated', () => {
  assert.equal(classifyVideoPoll({ status: 'done', respect_moderation: false }).kind, 'moderated');
  assert.equal(
    classifyVideoPoll({ status: 'done', video: { respect_moderation: false } }).kind,
    'moderated',
  );
});

test('success wins even if a moderation flag is somehow false but a url exists', () => {
  // Deliver any finished video; don't discard a paid result on an ambiguous flag.
  assert.equal(
    classifyVideoPoll({ status: 'done', video: { url: 'x', respect_moderation: false } }).kind,
    'success',
  );
});

test('pending while processing; failed on terminal error status', () => {
  assert.equal(classifyVideoPoll({ status: 'processing' }).kind, 'pending');
  assert.equal(classifyVideoPoll({}).kind, 'pending');
  assert.equal(classifyVideoPoll({ status: 'failed' }).kind, 'failed');
  assert.equal(classifyVideoPoll({ status: 'error' }).kind, 'failed');
});

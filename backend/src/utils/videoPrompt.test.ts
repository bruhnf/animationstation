/**
 * Unit tests for the AI Video motion-prompt sanitizer. Pure → no env/DB.
 * Run with: npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeMotionPrompt, MOTION_PROMPT_MAX } from './videoPrompt';

test('accepts ordinary motion prompts', () => {
  for (const p of ['wave and smile', 'do a slow 360 spin', 'blow a kiss', 'morph into a cat']) {
    const r = sanitizeMotionPrompt(p);
    assert.equal(r.ok, true, p);
    assert.equal(r.value, p);
  }
});

test('trims, collapses whitespace, strips control chars', () => {
  const r = sanitizeMotionPrompt('  wave   and \n smile  ');
  assert.equal(r.ok, true);
  assert.equal(r.value, 'wave and smile');
});

test('rejects non-strings and too-short input', () => {
  for (const v of [null, undefined, 42, {}, '', ' ', 'a']) {
    assert.equal(sanitizeMotionPrompt(v as unknown).ok, false, String(v));
  }
});

test('rejects over-long input', () => {
  const long = 'a'.repeat(MOTION_PROMPT_MAX + 1);
  const r = sanitizeMotionPrompt(long);
  assert.equal(r.ok, false);
});

test('accepts input exactly at the max length', () => {
  const exact = 'a'.repeat(MOTION_PROMPT_MAX);
  const r = sanitizeMotionPrompt(exact);
  assert.equal(r.ok, true);
  assert.equal(r.value?.length, MOTION_PROMPT_MAX);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  screenImageDecision,
  DEFAULT_IMAGE_SCREEN_CONFIG,
  type ScreenLabel,
  type ScreenFace,
} from './imageScreenService';

const cfg = DEFAULT_IMAGE_SCREEN_CONFIG; // explicit≥90, suggestive≥75, minorAgeHigh≤20
const lbl = (name: string, parent: string, confidence: number): ScreenLabel => ({
  name,
  parent,
  confidence,
});
const face = (ageHigh: number): ScreenFace => ({ ageHigh });

test('clean image with no labels → allow', () => {
  assert.equal(screenImageDecision([], [face(30)], cfg).block, false);
});

test('explicit nudity above threshold → block regardless of age', () => {
  const d = screenImageDecision([lbl('Explicit Nudity', '', 96)], [face(45)], cfg);
  assert.equal(d.block, true);
  assert.equal(d.reason, 'explicit');
});

test('explicit detected via ParentName → block', () => {
  const d = screenImageDecision([lbl('Graphic Female Nudity', 'Explicit Nudity', 92)], [], cfg);
  assert.equal(d.block, true);
  assert.equal(d.reason, 'explicit');
});

test('explicit BELOW threshold → allow', () => {
  assert.equal(screenImageDecision([lbl('Explicit Nudity', '', 80)], [], cfg).block, false);
});

test('suggestive + apparent minor → block', () => {
  const d = screenImageDecision([lbl('Revealing Clothes', 'Suggestive', 88)], [face(19)], cfg);
  assert.equal(d.block, true);
  assert.equal(d.reason, 'suggestive_minor');
});

test('suggestive + clearly adult → allow (permissive policy)', () => {
  const d = screenImageDecision([lbl('Revealing Clothes', 'Suggestive', 95)], [face(35)], cfg);
  assert.equal(d.block, false);
});

test('suggestive + NO face detected → allow (age rule needs a face)', () => {
  assert.equal(screenImageDecision([lbl('Suggestive', '', 95)], [], cfg).block, false);
});

test('suggestive below threshold + minor → allow', () => {
  assert.equal(
    screenImageDecision([lbl('Revealing Clothes', 'Suggestive', 60)], [face(16)], cfg).block,
    false,
  );
});

test('uses the YOUNGEST face when multiple are present', () => {
  const d = screenImageDecision(
    [lbl('Revealing Clothes', 'Suggestive', 90)],
    [face(40), face(18), face(50)],
    cfg,
  );
  assert.equal(d.block, true);
  assert.equal(d.reason, 'suggestive_minor');
});

test('explicit takes precedence over suggestive+minor in the detail/reason', () => {
  const d = screenImageDecision(
    [lbl('Explicit Nudity', '', 99), lbl('Revealing Clothes', 'Suggestive', 99)],
    [face(15)],
    cfg,
  );
  assert.equal(d.reason, 'explicit');
});

/**
 * Unit tests for the image-prompt safety module. Pure → no env/DB.
 * Run with: npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateOutfitDescription,
  buildOutfitPrompt,
  validateCleanupInstruction,
  buildCleanupPrompt,
  deriveItemName,
  randomOutfitIdea,
  OUTFIT_DESCRIPTION_MAX,
  OUTFIT_POLICY_MESSAGE,
  CLEANUP_INSTRUCTION_MAX,
  CLEANUP_BASE_PROMPT,
  CLOSET_ITEM_NAME_MAX,
} from './outfitPrompt';

test('accepts ordinary creative image prompts', () => {
  for (const desc of [
    'a neon-lit cyberpunk city street at night',
    'a majestic dragon perched on a cliff over the ocean',
    'a cozy cabin in a snowy forest at golden hour',
    'a red plaid flannel shirt with dark jeans',
  ]) {
    const r = validateOutfitDescription(desc);
    assert.equal(r.ok, true, desc);
  }
});

test('cleans whitespace, newlines, and control characters', () => {
  const r = validateOutfitDescription('  red\nshirt\twith   blue   jeans  ');
  assert.deepEqual(r, { ok: true, cleaned: 'red shirt with blue jeans' });
});

test('rejects non-strings and too-short input', () => {
  assert.equal(validateOutfitDescription(undefined).ok, false);
  assert.equal(validateOutfitDescription(42).ok, false);
  assert.equal(validateOutfitDescription('ab').ok, false);
  assert.equal(validateOutfitDescription('   ').ok, false);
});

test('rejects over-length input', () => {
  const r = validateOutfitDescription('x'.repeat(OUTFIT_DESCRIPTION_MAX + 1));
  assert.equal(r.ok, false);
});

test('rejects sexually explicit content with the policy message', () => {
  for (const desc of [
    'a naked person on a beach',
    'a nude figure study',
    'explicit pornographic scene',
    'topless woman',
    'an erotic fetish scene',
    'a sexual act',
  ]) {
    const r = validateOutfitDescription(desc);
    assert.equal(r.ok, false, desc);
    if (!r.ok) assert.equal(r.error, OUTFIT_POLICY_MESSAGE);
  }
});

test('does not false-positive on ordinary content (relaxed to sexual-only)', () => {
  for (const desc of [
    'a model in a bikini on the beach', // swimwear is fine for a general app
    'a lingerie shop window display',
    'a see-through glass building at dusk',
    'a sundress with espadrilles', // near-miss letters must not match
    'the county of Essex at sunset', // 'Essex' must not match 'sex'
  ]) {
    const r = validateOutfitDescription(desc);
    assert.equal(r.ok, true, desc);
  }
});

test('wrapped prompt embeds the cleaned text with light quality guidance', () => {
  const prompt = buildOutfitPrompt('a dragon over the ocean');
  assert.ok(prompt.includes('a dragon over the ocean'));
  assert.ok(prompt.startsWith('High-quality, detailed image.'));
  // General app: no forced no-people / clothing constraints.
  assert.ok(!/no people/i.test(prompt));
});

test('deriveItemName: short descriptions pass through capitalized', () => {
  assert.equal(deriveItemName('red flannel shirt'), 'Red flannel shirt');
});

test('deriveItemName: long descriptions truncate at a word boundary with ellipsis', () => {
  const name = deriveItemName(
    'a very long and extremely detailed description of an outfit with many words in it',
  );
  assert.ok(name.length <= CLOSET_ITEM_NAME_MAX + 1); // +1 for the ellipsis
  assert.ok(name.endsWith('…'));
  assert.ok(!name.includes('  '));
});

// --- Edit/transform custom instruction (optional) ---

test('validateCleanupInstruction: absent/empty is valid → empty cleaned', () => {
  for (const v of [undefined, null, '', '   ']) {
    const r = validateCleanupInstruction(v);
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.cleaned, '');
  }
});

test('validateCleanupInstruction: trims + collapses whitespace and control chars', () => {
  const r = validateCleanupInstruction('  make it   navy\tblue  ');
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.cleaned, 'make it navy blue');
});

test('validateCleanupInstruction: rejects sexually explicit terms (shared denylist)', () => {
  const r = validateCleanupInstruction('make it explicit');
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.error, OUTFIT_POLICY_MESSAGE);
});

test('validateCleanupInstruction: rejects over-length input', () => {
  const r = validateCleanupInstruction('a'.repeat(CLEANUP_INSTRUCTION_MAX + 1));
  assert.equal(r.ok, false);
});

test('validateCleanupInstruction: non-string is rejected', () => {
  assert.equal(validateCleanupInstruction(42 as unknown).ok, false);
});

test('buildCleanupPrompt: no instruction → base prompt + gentle enhance fallback', () => {
  const p = buildCleanupPrompt('');
  assert.ok(p.startsWith(CLEANUP_BASE_PROMPT));
  assert.ok(/enhance this image/i.test(p));
});

test('buildCleanupPrompt: instruction is the primary directive, embedded quoted', () => {
  const p = buildCleanupPrompt('make it navy blue');
  assert.ok(p.startsWith(CLEANUP_BASE_PROMPT));
  assert.ok(p.includes('"make it navy blue"'));
});

// --- "Surprise me" creative prompt generator ---

test('randomOutfitIdea: every output is a valid, accepted prompt', () => {
  for (let i = 0; i < 200; i += 1) {
    const rand = () => (i % 100) / 100;
    const idea = randomOutfitIdea(rand);
    assert.equal(typeof idea, 'string');
    const v = validateOutfitDescription(idea);
    assert.equal(v.ok, true, idea);
  }
});

test('randomOutfitIdea: deterministic given rand, picks from the idea list', () => {
  const first = randomOutfitIdea(() => 0);
  assert.equal(
    first,
    randomOutfitIdea(() => 0),
  );
  const last = randomOutfitIdea(() => 0.999);
  assert.equal(typeof last, 'string');
  assert.notEqual(first, last);
});

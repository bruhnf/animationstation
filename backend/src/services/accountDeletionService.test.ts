import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ACTOR_ORPHAN_NOTIFICATION_TYPES } from './accountDeletionService';

test('actor-orphan cleanup targets exactly LIKE / FOLLOW / COMMENT_LIKE', () => {
  const set = new Set<string>(ACTOR_ORPHAN_NOTIFICATION_TYPES);
  assert.equal(set.size, 3);
  assert.ok(set.has('LIKE'));
  assert.ok(set.has('FOLLOW'));
  assert.ok(set.has('COMMENT_LIKE'));
});

test('actor-orphan cleanup NEVER sweeps durable comment / system notifications', () => {
  // Deleting these on account deletion would break comment threads or lose
  // legitimate history — they must keep the SetNull tombstone behavior instead.
  for (const t of ['COMMENT', 'COMMENT_REPLY', 'TRYON_COMPLETE']) {
    assert.ok(
      !(ACTOR_ORPHAN_NOTIFICATION_TYPES as string[]).includes(t),
      `${t} must NOT be in the orphan-sweep set`,
    );
  }
});

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyOutcomes,
  isWithinModerationGrace,
  moderationWarningMessage,
  MODERATION_USER_MESSAGE,
  MODERATION_GRACE_WARNINGS,
  PARTIAL_TRANSIENT_USER_NOTE,
  PARTIAL_MODERATION_USER_NOTE,
} from './moderationGrace';

describe('classifyOutcomes — partial-results decision', () => {
  it('all perspectives generated → clean', () => {
    assert.equal(classifyOutcomes(['ok']), 'clean');
    assert.equal(classifyOutcomes(['ok', 'ok']), 'clean');
  });

  it('every perspective blocked → all_blocked (CONTENT_MODERATED failure, strike applies)', () => {
    assert.equal(classifyOutcomes(['moderated']), 'all_blocked');
    assert.equal(classifyOutcomes(['moderated', 'moderated']), 'all_blocked');
  });

  it('any survivor → partial (job completes), regardless of what the loss was', () => {
    assert.equal(classifyOutcomes(['ok', 'moderated']), 'partial');
    assert.equal(classifyOutcomes(['moderated', 'ok']), 'partial');
    assert.equal(classifyOutcomes(['ok', 'failed']), 'partial');
    assert.equal(classifyOutcomes(['failed', 'ok']), 'partial');
  });

  it('nothing generated with a transient loss → all_failed (refund, NO strike)', () => {
    assert.equal(classifyOutcomes(['failed']), 'all_failed');
    assert.equal(classifyOutcomes(['failed', 'failed']), 'all_failed');
    // A mixed moderated+failed total loss must NOT count as a banned-content
    // attempt — the transient error, not the filter, may explain the miss.
    assert.equal(classifyOutcomes(['moderated', 'failed']), 'all_failed');
  });

  it('empty outcome list classifies as all_failed (conservative, never strikes; unreachable in practice)', () => {
    assert.equal(classifyOutcomes([]), 'all_failed');
  });
});

describe('isWithinModerationGrace — 3-warning refund window', () => {
  it('strikes 1 through 3 are refunded warnings', () => {
    assert.equal(isWithinModerationGrace(1), true);
    assert.equal(isWithinModerationGrace(2), true);
    assert.equal(isWithinModerationGrace(3), true);
  });

  it('strike 4+ exits the grace window (no refund)', () => {
    assert.equal(isWithinModerationGrace(4), false);
    assert.equal(isWithinModerationGrace(100), false);
  });

  it('unknown count (bookkeeping failed) → no refund, matching pre-grace behavior', () => {
    assert.equal(isWithinModerationGrace(null), false);
  });

  it('counts below 1 never qualify (count is post-increment, so 0/negative = bug upstream)', () => {
    assert.equal(isWithinModerationGrace(0), false);
    assert.equal(isWithinModerationGrace(-1), false);
  });

  it('respects a custom limit', () => {
    assert.equal(isWithinModerationGrace(1, 1), true);
    assert.equal(isWithinModerationGrace(2, 1), false);
  });
});

describe('moderation user messages', () => {
  it('warning message states the refund and the warning position', () => {
    const msg = moderationWarningMessage(2);
    assert.match(msg, /refunded/i);
    assert.match(msg, new RegExp(`warning 2 of ${MODERATION_GRACE_WARNINGS}`));
  });

  it('post-grace message states the credit was NOT refunded', () => {
    assert.match(MODERATION_USER_MESSAGE, /not refunded/i);
  });

  it('the two messages are distinct for every grace strike', () => {
    for (let n = 1; n <= MODERATION_GRACE_WARNINGS; n++) {
      assert.notEqual(moderationWarningMessage(n), MODERATION_USER_MESSAGE);
    }
  });

  it('the transient partial note states the refund; the moderation partial note does not promise one', () => {
    assert.match(PARTIAL_TRANSIENT_USER_NOTE, /refunded/i);
    assert.doesNotMatch(PARTIAL_MODERATION_USER_NOTE, /refunded/i);
    assert.match(PARTIAL_MODERATION_USER_NOTE, /content policy/i);
    assert.notEqual(PARTIAL_TRANSIENT_USER_NOTE, PARTIAL_MODERATION_USER_NOTE);
  });
});

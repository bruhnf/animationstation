/**
 * Unit tests for adminDashboardUrl. The first case is a regression guard: the
 * old `replace('/api','')` produced `https:/.animationstation.com/admin` for the prod
 * host. Run with: npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adminDashboardUrl } from './adminUrl';

test('prod API host — no /api corruption (regression)', () => {
  assert.equal(
    adminDashboardUrl('https://api.animationstation.com'),
    'https://api.animationstation.com/admin',
  );
});

test('dev API host', () => {
  assert.equal(
    adminDashboardUrl('https://api-dev.animationstation.com'),
    'https://api-dev.animationstation.com/admin',
  );
});

test('strips a single trailing slash', () => {
  assert.equal(
    adminDashboardUrl('https://api.animationstation.com/'),
    'https://api.animationstation.com/admin',
  );
});

test('strips multiple trailing slashes', () => {
  assert.equal(
    adminDashboardUrl('https://api.animationstation.com///'),
    'https://api.animationstation.com/admin',
  );
});

test('localhost dev', () => {
  assert.equal(adminDashboardUrl('http://localhost:3000'), 'http://localhost:3000/admin');
});

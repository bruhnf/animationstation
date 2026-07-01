/**
 * Unit tests for the great-circle distance used by suspicious-login detection
 * (a wrong sign/radian here would mis-flag or miss impossible-travel logins).
 * Run with: npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { haversineDistance } from './haversine';

test('identical points are 0 km', () => {
  assert.equal(haversineDistance(40.7, -74, 40.7, -74), 0);
});

test('one degree of latitude is ~111 km', () => {
  const d = haversineDistance(0, 0, 1, 0);
  assert.ok(Math.abs(d - 111.19) < 1, `expected ~111.19, got ${d}`);
});

test('NYC to LA is ~3936 km', () => {
  const d = haversineDistance(40.7128, -74.006, 34.0522, -118.2437);
  assert.ok(Math.abs(d - 3936) < 40, `expected ~3936, got ${d}`);
});

test('distance is symmetric', () => {
  const a = haversineDistance(51.5, -0.12, 48.85, 2.35);
  const b = haversineDistance(48.85, 2.35, 51.5, -0.12);
  assert.ok(Math.abs(a - b) < 1e-9);
});

test('crosses the 500 km suspicious threshold correctly', () => {
  // ~350 km (NYC↔Boston) is under; ~1300 km (NYC↔Chicago) is over.
  assert.ok(haversineDistance(40.7128, -74.006, 42.3601, -71.0589) < 500);
  assert.ok(haversineDistance(40.7128, -74.006, 41.8781, -87.6298) > 500);
});

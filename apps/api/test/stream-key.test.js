import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  STREAM_KEY_TTL_SECONDS,
  signStreamKey,
  verifyStreamKey
} from '../lib/stream-key.js';

const FIXED_NOW = Date.UTC(2026, 10, 15, 0, 0, 0); // 2026-11-15T00:00:00Z

// Keep the suite deterministic and quiet: the secret is read lazily on each
// sign/verify, so setting it at module scope is enough.
process.env.STREAM_KEY_SECRET = process.env.STREAM_KEY_SECRET || 'test-only-stream-secret';

function partsOf(token) {
  const [header, payload, signature] = token.split('.');
  return { header, payload, signature };
}

test('sign and verify round-trip keeps the player id', () => {
  const token = signStreamKey('wayne19980', { now: FIXED_NOW });
  const verified = verifyStreamKey(token, { now: FIXED_NOW + 1000 });
  assert.equal(verified.playerId, 'wayne19980');
  assert.equal(
    verified.expiresAt,
    new Date(FIXED_NOW + STREAM_KEY_TTL_SECONDS * 1000).toISOString()
  );
});

test('expired keys are rejected', () => {
  const token = signStreamKey('wayne19980', { ttlSeconds: 60, now: FIXED_NOW });
  assert.equal(verifyStreamKey(token, { now: FIXED_NOW + 61_000 }), null);
});

test('a token issued far in the future is rejected (clock skew guard)', () => {
  const token = signStreamKey('wayne19980', { now: FIXED_NOW + 3_600_000 });
  assert.equal(verifyStreamKey(token, { now: FIXED_NOW }), null);
});

test('tampered payloads fail the signature check', () => {
  const token = signStreamKey('wayne19980', { now: FIXED_NOW });
  const { header, signature } = partsOf(token);
  const forgedPayload = Buffer.from(
    JSON.stringify({ sub: 'someone-else', scope: 'broadcast', iat: 1, exp: 9_999_999_999 })
  ).toString('base64url');
  assert.equal(verifyStreamKey(`${header}.${forgedPayload}.${signature}`, { now: FIXED_NOW }), null);
});

test('alg=none and unknown algorithms are rejected', () => {
  const token = signStreamKey('wayne19980', { now: FIXED_NOW });
  const { payload, signature } = partsOf(token);
  const noneHeader = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  assert.equal(verifyStreamKey(`${noneHeader}.${payload}.${signature}`, { now: FIXED_NOW }), null);
});

test('a key signed with another secret is rejected', () => {
  const previous = process.env.STREAM_KEY_SECRET;
  process.env.STREAM_KEY_SECRET = 'rotation-one-secret';
  const token = signStreamKey('wayne19980', { now: FIXED_NOW });
  process.env.STREAM_KEY_SECRET = 'rotation-two-secret';
  try {
    assert.equal(verifyStreamKey(token, { now: FIXED_NOW }), null);
  } finally {
    if (previous === undefined) delete process.env.STREAM_KEY_SECRET;
    else process.env.STREAM_KEY_SECRET = previous;
  }
});

test('garbage, empty and truncated tokens are rejected', () => {
  for (const token of ['', 'a.b', 'a.b.c', '....', 'not-a-jwt', null, undefined, 42]) {
    assert.equal(verifyStreamKey(token, { now: FIXED_NOW }), null);
  }
  const token = signStreamKey('wayne19980', { now: FIXED_NOW });
  assert.equal(verifyStreamKey(token.slice(0, -2), { now: FIXED_NOW }), null);
});

test('missing player id cannot be signed', () => {
  assert.throws(() => signStreamKey('', { now: FIXED_NOW }), /playerId is required/);
});

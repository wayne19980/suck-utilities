import { createHmac, timingSafeEqual } from 'node:crypto';

// Stateless stream key: a compact HS256 JWT whose `sub` is the player id.
// There is no key table; rotation only needs a new STREAM_KEY_SECRET.
const ALG = 'HS256';
const TYP = 'JWT';
const SCOPE = 'broadcast';
export const STREAM_KEY_TTL_SECONDS = 180 * 24 * 60 * 60;
const DEV_SECRET = 'dev-insecure-stream-key';
const CLOCK_SKEW_SECONDS = 300;

let warnedMissingSecret = false;

export function streamKeySecret() {
  const configured = (process.env.STREAM_KEY_SECRET || '').trim();
  if (configured) return configured;
  if (!warnedMissingSecret) {
    warnedMissingSecret = true;
    console.warn(
      '[stream-key] STREAM_KEY_SECRET is not set; falling back to an insecure development secret.'
    );
  }
  return DEV_SECRET;
}

function base64url(value) {
  return Buffer.from(value).toString('base64url');
}

function sign(signingInput) {
  return createHmac('sha256', streamKeySecret()).update(signingInput).digest('base64url');
}

export function signStreamKey(playerId, { ttlSeconds = STREAM_KEY_TTL_SECONDS, now = Date.now() } = {}) {
  const subject = String(playerId || '').trim();
  if (!subject) throw new Error('playerId is required');

  const issuedAt = Math.floor(now / 1000);
  const header = { alg: ALG, typ: TYP };
  const payload = {
    sub: subject,
    scope: SCOPE,
    iat: issuedAt,
    exp: issuedAt + Math.max(1, Math.floor(ttlSeconds))
  };
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  return `${signingInput}.${sign(signingInput)}`;
}

// Returns { playerId, expiresAt } for a valid key, otherwise null. Any failure is
// a null: callers turn that into 401 without leaking which check failed.
export function verifyStreamKey(token, { now = Date.now() } = {}) {
  if (typeof token !== 'string' || token.length === 0 || token.length > 4096) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  if (!encodedHeader || !encodedPayload || !encodedSignature) return null;

  let header;
  let payload;
  try {
    header = JSON.parse(Buffer.from(encodedHeader, 'base64url').toString('utf8'));
    payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }

  if (!header || header.alg !== ALG || header.typ !== TYP) return null;
  if (!payload || typeof payload.sub !== 'string' || payload.sub.length === 0) return null;
  if (payload.scope !== SCOPE) return null;

  const expected = createHmac('sha256', streamKeySecret())
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest();
  let provided;
  try {
    provided = Buffer.from(encodedSignature, 'base64url');
  } catch {
    return null;
  }
  if (provided.length !== expected.length) return null;
  if (!timingSafeEqual(provided, expected)) return null;

  const nowSeconds = Math.floor(now / 1000);
  if (typeof payload.exp !== 'number' || payload.exp <= nowSeconds) return null;
  if (typeof payload.iat === 'number' && payload.iat > nowSeconds + CLOCK_SKEW_SECONDS) return null;

  return {
    playerId: payload.sub,
    expiresAt: new Date(payload.exp * 1000).toISOString()
  };
}

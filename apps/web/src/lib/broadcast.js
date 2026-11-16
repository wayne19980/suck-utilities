import { API } from './api.js';
import { userState } from './user.svelte.js';

// The overlay URL is bound to the caster, so the OBS browser source never has to
// change. Writes are authenticated with a stateless JWT stored per browser; the
// key is re-claimed automatically when it expires.
export const STREAM_KEY_STORAGE = 'suck_stream_key';

function readStoredKey() {
  if (typeof window === 'undefined') return '';
  return localStorage.getItem(STREAM_KEY_STORAGE) || '';
}

function writeStoredKey(key) {
  if (typeof window === 'undefined') return;
  if (key) localStorage.setItem(STREAM_KEY_STORAGE, key);
  else localStorage.removeItem(STREAM_KEY_STORAGE);
}

export function hasStreamKey() {
  return Boolean(readStoredKey());
}

export function clearStreamKey() {
  writeStoredKey('');
}

export async function ensureStreamKey({ force = false } = {}) {
  const playerId = userState.id;
  if (!playerId) throw new Error('请先设置选手 ID');
  if (!userState.qqGroup) throw new Error('请先验证 QQ 群号');

  if (!force) {
    const existing = readStoredKey();
    if (existing) return existing;
  }

  // The endpoint returns a fresh JWT; re-claiming keeps earlier keys valid until
  // they expire, so an OBS source on another machine does not break.
  const result = await API.claimStreamKey();
  writeStoredKey(result.key);
  return result.key;
}

// Run a broadcast write, re-claiming the key once if the server rejects it (a
// stateless key can expire or belong to a previous deployment's secret).
async function withStreamKey(run) {
  await ensureStreamKey();
  try {
    return await run();
  } catch (error) {
    if (error?.status !== 401) throw error;
    clearStreamKey();
    await ensureStreamKey({ force: true });
    return await run();
  }
}

export function startBroadcast({ tournamentId, matchId = null }) {
  return withStreamKey(() =>
    API.startBroadcast({ tournament_id: tournamentId, match_id: matchId })
  );
}

export function updateBroadcastMatch(matchId) {
  return withStreamKey(() => API.updateBroadcastMatch(matchId));
}

export function endBroadcast() {
  return withStreamKey(() => API.endBroadcast());
}

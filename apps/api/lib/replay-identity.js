// Pure helpers that map a replay player onto a registered player.
//
// Identity is keyed by the Battle.net account URL (`region/subregion/toon`)
// rather than the in-game display name, because players rename themselves and
// two players can share a display name. Name / battle-tag matching is only the
// fallback for older replay records without account URLs.

// Normalize a Battle.net account reference to a stable `region/subregion/toon` key.
// Handles profile URLs, `toon_handle` strings, and already-normalized keys.
export function normalizeBnetUrl(input) {
  if (!input || typeof input !== 'string') return '';
  const s = input.trim().toLowerCase();
  if (!s) return '';
  const profile = s.match(/profile\/(\d+)\/(\d+)\/(\d+)/);
  if (profile) return `${profile[1]}/${profile[2]}/${profile[3]}`;
  const handle = s.match(/^(\d+)-[^-]+-(\d+)-(\d+)$/);
  if (handle) return `${handle[1]}/${handle[2]}/${handle[3]}`;
  return s;
}

// Stable account key for a player object parsed from a replay.
export function replayPlayerAccountKey(p) {
  if (!p) return '';
  if (p.region_id != null && p.subregion != null && p.toon_id != null) {
    return `${p.region_id}/${p.subregion}/${p.toon_id}`;
  }
  return normalizeBnetUrl(p.bnet_url || p.toon_handle || '');
}

// Battle.net server labels by region id (sc2reader GATEWAY_LOOKUP: 1 us, 2 eu, 3 kr, 5 cn, 6 sea).
const REGION_LABELS = { 1: '美服', 2: '欧服', 3: '亚服', 5: '国服', 6: '东南亚', 98: '—' };
const SUBREGION_LABELS = { '1/2': '拉美', '2/2': '俄服', '3/2': '台服' };

export function regionLabel(regionKey) {
  const m = String(regionKey || '').match(/^(\d+)\/(\d+)/);
  if (!m) return '';
  const r = parseInt(m[1], 10);
  const s = parseInt(m[2], 10);
  return SUBREGION_LABELS[`${r}/${s}`] || REGION_LABELS[r] || '';
}

export function accountEntryRegionLabel(entry) {
  if (!entry) return '';
  const key = normalizeBnetUrl(entry.url || entry.toon_handle || entry.account_key || '');
  return regionLabel(key);
}

// Normalize a tournament_player_accounts row into a bnet_ids-like entry.
export function tournamentAccountToBnetEntry(a) {
  return {
    id: a.account_name || a.id || '',
    url: a.url || '',
    toon_handle: a.toon_handle || '',
    region: a.region || null,
    subregion: a.subregion != null ? a.subregion : null
  };
}

// Every account key a stored account entry could resolve to.
export function bnetEntryAccountKeys(entry) {
  const keys = [];
  if (!entry) return keys;
  if (typeof entry === 'string') {
    const k = normalizeBnetUrl(entry);
    if (k) keys.push(k);
    return keys;
  }
  for (const field of [entry.url, entry.toon_handle, entry.toonHandle, entry.account_key]) {
    const k = normalizeBnetUrl(field);
    if (k) keys.push(k);
  }
  return keys;
}

export function bnetEntryKey(entry) {
  return bnetEntryAccountKeys(entry)[0] || '';
}

export function parseBnetIdsField(playerBnetIds) {
  let bnetIds = [];
  if (playerBnetIds) {
    try {
      bnetIds = typeof playerBnetIds === 'string' ? JSON.parse(playerBnetIds) : playerBnetIds;
    } catch (_) {}
  }
  return Array.isArray(bnetIds) ? bnetIds : [];
}

// Combined account entries for a player: global bnet_ids + tournament links.
export function playerAccountEntries(p) {
  const base = parseBnetIdsField(p?.bnet_ids);
  const extra = Array.isArray(p?.tournament_accounts)
    ? p.tournament_accounts.map(tournamentAccountToBnetEntry)
    : [];
  return [...base, ...extra];
}

// Insert/update one account in a bnet_ids array, keyed by the account URL
// (region/subregion/toon) so an account stays a single entry even if the
// in-game display name changes. Returns true if anything changed.
export function upsertGlobalAccountEntry(bnetIds, repPlayer) {
  const key = replayPlayerAccountKey(repPlayer);
  const repName = (repPlayer?.name || '').trim();
  if (!key && !repName) return false;
  const nameLower = repName.toLowerCase();

  let idx = key ? bnetIds.findIndex(e => bnetEntryKey(e) === key) : -1;
  const matchedByKey = idx >= 0;
  if (idx < 0 && repName) {
    idx = bnetIds.findIndex(e =>
      ((typeof e === 'string' ? e : e?.id) || '').toLowerCase().trim() === nameLower
    );
  }

  let changed = false;
  let target = null;

  if (idx < 0) {
    target = { id: repName, url: repPlayer?.bnet_url || '', toon_handle: repPlayer?.toon_handle || null };
    bnetIds.push(target);
    changed = true;
  } else {
    const entry = bnetIds[idx];
    if (typeof entry === 'string') {
      target = { id: repName || entry, url: repPlayer?.bnet_url || '', toon_handle: repPlayer?.toon_handle || null };
      bnetIds[idx] = target;
      changed = true;
    } else if (!matchedByKey && entry.url && key && bnetEntryKey(entry) && bnetEntryKey(entry) !== key) {
      // Same display name but a different known account -> a separate account.
      target = { id: repName, url: repPlayer?.bnet_url || '', toon_handle: repPlayer?.toon_handle || null };
      bnetIds.push(target);
      changed = true;
    } else {
      target = entry;
      if (!entry.url && repPlayer?.bnet_url) { entry.url = repPlayer.bnet_url; changed = true; }
      if (!entry.toon_handle && repPlayer?.toon_handle) { entry.toon_handle = repPlayer.toon_handle; changed = true; }
      if (repName && entry.id !== repName && (matchedByKey || !entry.url)) { entry.id = repName; changed = true; }
    }
  }

  // Merge leftover name-only aliases that share the replay's display name into
  // the account entry (these are the same account seen under an old name).
  const targetKey = bnetEntryKey(target);
  if (targetKey && repName) {
    for (let j = bnetIds.length - 1; j >= 0; j--) {
      const e = bnetIds[j];
      if (e === target) continue;
      const eKey = bnetEntryKey(e);
      const eId = ((typeof e === 'string' ? e : e?.id) || '').toLowerCase().trim();
      if (!eKey && eId === nameLower) { bnetIds.splice(j, 1); changed = true; }
    }
  }

  return changed;
}

// Collapse entries that resolve to the same account URL into one (keeps the url).
export function dedupeAccountEntries(bnetIds) {
  const byKey = new Map();
  const out = [];
  for (const e of bnetIds) {
    const k = bnetEntryKey(e);
    if (!k) { out.push(e); continue; }
    if (byKey.has(k)) {
      const prev = byKey.get(k);
      const eObj = typeof e === 'string' ? { id: e, url: '' } : e;
      if (!prev.url && eObj.url) { prev.url = eObj.url; prev.toon_handle = prev.toon_handle || eObj.toon_handle || null; }
      if (eObj.id) prev.id = eObj.id;
    } else {
      const clone = typeof e === 'string' ? { id: e, url: '' } : { ...e };
      byKey.set(k, clone);
      out.push(clone);
    }
  }
  return out;
}

export function flattenReplayPlayers(parsedData) {
  return parsedData?.teams?.flatMap((t, tIdx) => (t.players || []).map(p => ({ ...p, teamIdx: tIdx }))) || [];
}

// Shape a replay account for the manual-mapping UI, including a stable key.
export function describeReplayAccount(repPlayer, matchedPlayer) {
  return {
    name: repPlayer?.name || '',
    race: repPlayer?.race || (repPlayer?.pick_race || '?')[0] || '',
    pick_race: repPlayer?.pick_race || '',
    play_race: repPlayer?.play_race || '',
    bnet_url: repPlayer?.bnet_url || '',
    toon_handle: repPlayer?.toon_handle || '',
    region: repPlayer?.region || null,
    subregion: repPlayer?.subregion != null ? repPlayer.subregion : null,
    result: repPlayer?.result || null,
    accountKey: replayPlayerAccountKey(repPlayer),
    regionLabel: accountEntryRegionLabel({
      url: repPlayer?.bnet_url || '',
      toon_handle: repPlayer?.toon_handle || ''
    }),
    matchedPlayerId: matchedPlayer ? matchedPlayer.id : null
  };
}

/**
 * Find the replay player that belongs to `player`.
 * `player` needs { id, display_name?, battle_tags?, bnet_ids? }; account URLs
 * win over names so renamed accounts still resolve.
 */
export function findReplayPlayerForPlayer(repPlayers, player, extraAccounts = []) {
  if (!Array.isArray(repPlayers) || !player) return null;

  const pIdLower = (player.id || '').toLowerCase().trim();
  const pDispLower = (player.display_name || '').toLowerCase().trim();

  let tags = {};
  if (player.battle_tags) {
    try {
      tags = typeof player.battle_tags === 'string' ? JSON.parse(player.battle_tags) : player.battle_tags;
    } catch (_) {}
  }
  const tagList = [];
  if (tags) {
    for (const key of Object.keys(tags)) {
      const val = tags[key];
      if (Array.isArray(val)) {
        tagList.push(...val.filter(Boolean).map(t => t.toLowerCase().trim()));
      } else if (typeof val === 'string' && val) {
        tagList.push(val.toLowerCase().trim());
      }
    }
  }

  const extraEntries = (Array.isArray(extraAccounts) ? extraAccounts : []).map(a =>
    a && (a.account_key !== undefined || a.account_name !== undefined) ? tournamentAccountToBnetEntry(a) : a
  );
  const bnetIds = [...parseBnetIdsField(player.bnet_ids), ...extraEntries];
  const bnetNames = bnetIds.map(b => (typeof b === 'string' ? b : b.id).toLowerCase().trim());

  // 1. Prefer an exact Battle.net account match (disambiguates identical display names).
  const accountKeys = new Set();
  for (const entry of bnetIds) {
    for (const k of bnetEntryAccountKeys(entry)) accountKeys.add(k);
  }
  if (accountKeys.size > 0) {
    const accountMatch = repPlayers.find(p => {
      const k = replayPlayerAccountKey(p);
      return k && accountKeys.has(k);
    });
    if (accountMatch) return accountMatch;
  }

  // 2. Fall back to name / battle tag / historical bnet id matching.
  return repPlayers.find(p => {
    if (!p.name) return false;
    const nameLower = p.name.toLowerCase().trim();
    return nameLower === pIdLower ||
           nameLower === pDispLower ||
           tagList.some(tag => tag === nameLower || tag.split('#')[0] === nameLower) ||
           bnetNames.includes(nameLower);
  }) || null;
}

export function getPlayerInfoFromReplay(playerId, playerDisplayName, playerBattleTags, playerBnetIds, parsedData, extraAccounts = []) {
  return findReplayPlayerForPlayer(
    flattenReplayPlayers(parsedData),
    {
      id: playerId,
      display_name: playerDisplayName,
      battle_tags: playerBattleTags,
      bnet_ids: playerBnetIds
    },
    extraAccounts
  );
}

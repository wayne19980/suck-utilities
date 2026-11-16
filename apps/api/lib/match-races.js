// Derive the race each registered player used in a match from its replays.
//
// Replays are attached to a `matches` row, so a 1v1 replay always describes
// exactly the two players in that row. Account identity resolves which replay
// side belongs to which player; when only one side is linked, the other side of
// a two-player replay is known by elimination. That fallback keeps old replay
// rows useful even when an opponent's Battle.net account was never learned.

import {
  findReplayPlayerForPlayer,
  flattenReplayPlayers
} from './replay-identity.js';

function firstRace(values) {
  for (const raw of values) {
    const letter = String(raw || '').trim().charAt(0).toUpperCase();
    if (letter && letter !== '?') return letter;
  }
  return null;
}

/** The race a replay player actually played, as a single uppercase letter. */
export function replayRace(replayPlayer) {
  return firstRace([replayPlayer?.play_race, replayPlayer?.race, replayPlayer?.pick_race]);
}

/** The race a replay player selected before the game (R for Random). */
export function replayPickRace(replayPlayer) {
  return firstRace([replayPlayer?.pick_race, replayPlayer?.race, replayPlayer?.play_race]);
}

function replayPlayersOf(replay) {
  if (Array.isArray(replay?.players)) return replay.players;
  if (Array.isArray(replay?.repPlayers)) return replay.repPlayers;
  let parsed = replay?.parsed_data;
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed);
    } catch (_) {
      return [];
    }
  }
  return flattenReplayPlayers(parsed);
}

function resolveSide(replayPlayers, player, accounts) {
  if (!player?.id) return null;
  return findReplayPlayerForPlayer(replayPlayers, player, accounts || []);
}

/**
 * Resolve both sides of one replay for a match.
 * Returns replay player objects (or null) in player1/player2 order.
 */
export function resolveReplaySides(match, replayPlayers, playersById, accountsByPlayer = {}) {
  const p1 = playersById.get(match.player1_id);
  const p2 = playersById.get(match.player2_id);
  let side1 = resolveSide(replayPlayers, p1, accountsByPlayer[match.player1_id]);
  let side2 = resolveSide(replayPlayers, p2, accountsByPlayer[match.player2_id]);

  if (replayPlayers.length === 2) {
    // Both sides pointing at the same account is ambiguous, not evidence.
    if (side1 && side2 && side1 === side2) return { side1: null, side2: null };
    if (side1 && !side2) {
      const other = replayPlayers.find((rep) => rep !== side1);
      if (other) side2 = other;
    } else if (!side1 && side2) {
      const other = replayPlayers.find((rep) => rep !== side2);
      if (other) side1 = other;
    }
  }

  return { side1, side2 };
}

function addTally(tally, matchId, playerId, kind, race) {
  if (!race) return;
  let byPlayer = tally.get(matchId);
  if (!byPlayer) {
    byPlayer = new Map();
    tally.set(matchId, byPlayer);
  }
  let counts = byPlayer.get(playerId);
  if (!counts) {
    counts = { pick: new Map(), play: new Map() };
    byPlayer.set(playerId, counts);
  }
  const map = counts[kind];
  map.set(race, (map.get(race) || 0) + 1);
}

function topRace(counts) {
  let best = null;
  let bestCount = 0;
  for (const [race, count] of counts) {
    if (count > bestCount) {
      best = race;
      bestCount = count;
    }
  }
  return best ? { race: best, counts: Object.fromEntries(counts) } : null;
}

/**
 * Per-match race map.
 *
 * @param {object} input
 * @param {Array} input.matches  rows with id/player1_id/player2_id
 * @param {Array} input.replays  rows with match_id + parsed_data | players
 * @param {Array} input.players  registered players (id/display_name/battle_tags/bnet_ids)
 * @param {object} [input.accountsByPlayer]
 * @returns {Map<number, Map<string, {race: string, pick_race: string, play_race: string, counts: Record<string, number>, pick_counts: Record<string, number>, play_counts: Record<string, number>}>>}
 */
export function computeMatchRaces({
  matches = [],
  replays = [],
  players = [],
  accountsByPlayer = {}
} = {}) {
  const matchById = new Map(
    matches.filter((m) => m && m.id != null).map((m) => [m.id, m])
  );
  const playersById = new Map(
    players.filter((p) => p && p.id).map((p) => [p.id, p])
  );
  const tally = new Map();

  for (const replay of replays) {
    const match = matchById.get(replay?.match_id);
    if (!match?.player1_id || !match?.player2_id) continue;

    const replayPlayers = replayPlayersOf(replay);
    if (replayPlayers.length === 0) continue;

    const { side1, side2 } = resolveReplaySides(
      match,
      replayPlayers,
      playersById,
      accountsByPlayer
    );
    addTally(tally, match.id, match.player1_id, 'pick', replayPickRace(side1));
    addTally(tally, match.id, match.player1_id, 'play', replayRace(side1));
    addTally(tally, match.id, match.player2_id, 'pick', replayPickRace(side2));
    addTally(tally, match.id, match.player2_id, 'play', replayRace(side2));
  }

  const races = new Map();
  for (const [matchId, byPlayer] of tally) {
    const resolved = new Map();
    for (const [playerId, counts] of byPlayer) {
      const pick = topRace(counts.pick);
      const play = topRace(counts.play);
      if (!pick && !play) continue;
      const pickRace = pick?.race || play?.race || null;
      const playRace = play?.race || pick?.race || null;
      resolved.set(playerId, {
        race: playRace,
        pick_race: pickRace,
        play_race: playRace,
        counts: play?.counts || {},
        pick_counts: pick?.counts || {},
        play_counts: play?.counts || {}
      });
    }
    if (resolved.size > 0) races.set(matchId, resolved);
  }
  return races;
}

/** Race letter for one player in one match, or null. */
export function matchRaceFor(races, matchId, playerId) {
  return races.get(matchId)?.get(playerId)?.race || null;
}

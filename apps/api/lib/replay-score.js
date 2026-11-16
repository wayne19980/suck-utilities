// Read-only replay scoring.
//
// Importing replays never changes a match result: replay uploads are a record
// (VOD / stats / account learning). The result dialog can ask for the score
// these replays imply and pre-fill the form, but a human still submits it, so
// the same best-of validation and advancement rules as a manual result apply.

import { getPlayerDisplayName } from '../repositories/player-repo.js';
import { getPlayerInfoFromReplay } from './replay-identity.js';

/** Sum the games won by player1 / player2 across the match's replays. */
export function computeReplaySeriesStats({ replays = [], player1 = null, player2 = null, accountsByPlayer = {} } = {}) {
  let score1 = 0;
  let score2 = 0;

  for (const r of replays) {
    let parsed;
    try {
      parsed = typeof r.parsed_data === 'string' ? JSON.parse(r.parsed_data) : r.parsed_data;
    } catch (_) {
      continue;
    }
    if (!parsed) continue;

    // Attribute each game to the registered player whose account actually
    // appears in the replay (URL-aware), so identical display names are safe.
    const repP1 = player1
      ? getPlayerInfoFromReplay(player1.id, getPlayerDisplayName(player1), player1.battle_tags, player1.bnet_ids, parsed, accountsByPlayer[player1.id] || [])
      : null;
    const repP2 = player2
      ? getPlayerInfoFromReplay(player2.id, getPlayerDisplayName(player2), player2.battle_tags, player2.bnet_ids, parsed, accountsByPlayer[player2.id] || [])
      : null;

    const p1Won = repP1?.result === 'Win';
    const p2Won = repP2?.result === 'Win';

    if (p1Won && !p2Won) score1++;
    else if (p2Won && !p1Won) score2++;
  }

  return { score1, score2, games: replays.length };
}

/** Best-of framing around the raw score: target wins and whether the series is decided. */
export function summarizeSeries({ score1 = 0, score2 = 0, games = 0, bestOf = 1 } = {}) {
  const bo = Math.max(1, Number(bestOf) || 1);
  const target = Math.floor(bo / 2) + 1;
  const top = Math.max(score1, score2);
  const complete = score1 !== score2 && top >= target && top <= bo;
  return { score1, score2, games, best_of: bo, target, complete };
}
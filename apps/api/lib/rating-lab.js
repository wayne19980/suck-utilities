// Read-only rating experiments. Nothing here feeds the ladder, tiers or seeds.
//
// 1. Weighted Bradley-Terry: all games in one batch, so head-to-head records
//    are part of the likelihood. Off-race games against much lower-rated
//    opponents are down-weighted (0.25) instead of being thrown away.
// 2. Race-specific Glicko: a separate rating per (player, actual play race).
//    Random games update the race that was actually played.
// 3. Best race: each player's highest race rating with a minimum sample.

import { glickoUpdate, inflateRd } from './glicko.js';
import { MAIN_RACE_OVERRIDES } from './main-races.js';

export { MAIN_RACE_OVERRIDES } from './main-races.js';

export const BT_SCALE = 173.7178;
export const BT_LAMBDA = 1;
export const BT_ITERATIONS = 20000;
export const BT_LEARNING_RATE = 0.1;
export const OFF_RACE_GAP = 150;
export const OFF_RACE_WEIGHT = 0.25;
export const RACE_INITIAL_RD = 250;
export const RACE_INFLATION_DAYS = 7;
export const MIN_RACE_GAMES = 5;

function actualRace(info) {
  if (!info) return null;
  const candidates = [info.play_race, info.race, info.pick_race];
  for (const raw of candidates) {
    const race = String(raw || '').trim().charAt(0).toUpperCase();
    if (race && race !== 'R' && race !== '?') return race;
  }
  return null;
}

function pickRace(info) {
  if (!info) return null;
  const raw = info.pick_race || info.race || info.play_race;
  const race = String(raw || '').trim().charAt(0).toUpperCase();
  return race && race !== '?' ? race : null;
}

function countBy(values) {
  const counts = new Map();
  for (const value of values) {
    if (!value) continue;
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  return counts;
}

function inferMainRaces(games, races, overrides = MAIN_RACE_OVERRIDES) {
  const picks = new Map();
  for (const game of games) {
    const byPlayer = races.get(game.id);
    for (const id of [game.player1_id, game.player2_id]) {
      const race = pickRace(byPlayer?.get(id));
      if (!race) continue;
      if (!picks.has(id)) picks.set(id, []);
      picks.get(id).push(race);
    }
  }
  const main = new Map();
  for (const [id, values] of picks) {
    const counts = countBy(values);
    let best = null;
    let bestCount = -1;
    for (const [race, count] of counts) {
      if (count > bestCount) {
        best = race;
        bestCount = count;
      }
    }
    main.set(id, best);
  }
  for (const [id, race] of Object.entries(overrides || {})) {
    if (race) main.set(id, race);
  }
  return main;
}

function buildGames(games, races) {
  return games.map((game) => {
    const byPlayer = races.get(game.id);
    return {
      id: game.id,
      a: game.player1_id,
      b: game.player2_id,
      y: Number(game.score1) > Number(game.score2) ? 1 : 0,
      aPick: pickRace(byPlayer?.get(game.player1_id)),
      bPick: pickRace(byPlayer?.get(game.player2_id)),
      aPlay: actualRace(byPlayer?.get(game.player1_id)),
      bPlay: actualRace(byPlayer?.get(game.player2_id)),
      playedAt: game.played_at || null
    };
  });
}

function fitBT(games, ids, weights = null) {
  const index = new Map(ids.map((id, i) => [id, i]));
  const strength = new Float64Array(ids.length);
  for (let iteration = 0; iteration < BT_ITERATIONS; iteration += 1) {
    const gradient = new Float64Array(ids.length);
    for (let i = 0; i < games.length; i += 1) {
      const game = games[i];
      const a = index.get(game.a);
      const b = index.get(game.b);
      if (a == null || b == null) continue;
      const expected = 1 / (1 + Math.exp(-(strength[a] - strength[b])));
      const diff = game.y - expected;
      const weight = weights ? weights[i] : 1;
      gradient[a] -= weight * diff;
      gradient[b] += weight * diff;
    }
    for (let i = 0; i < ids.length; i += 1) {
      gradient[i] += BT_LAMBDA * strength[i];
      strength[i] -= (BT_LEARNING_RATE * gradient[i]) / games.length;
    }
  }
  return new Map(
    ids.map((id, i) => [
      id,
      {
        id,
        strength: strength[i],
        rating: 3000 + BT_SCALE * strength[i]
      }
    ])
  );
}

function btWeights(games, mainRaces, ratings) {
  return games.map((game) => {
    const aMain = mainRaces.get(game.a);
    const bMain = mainRaces.get(game.b);
    const aRating = ratings.get(game.a)?.rating ?? 3000;
    const bRating = ratings.get(game.b)?.rating ?? 3000;
    const aOff =
      aMain &&
      aMain !== 'R' &&
      game.aPick &&
      game.aPick !== aMain &&
      game.aPick !== 'R' &&
      aRating - bRating > OFF_RACE_GAP;
    const bOff =
      bMain &&
      bMain !== 'R' &&
      game.bPick &&
      game.bPick !== bMain &&
      game.bPick !== 'R' &&
      bRating - aRating > OFF_RACE_GAP;
    return Math.min(aOff ? OFF_RACE_WEIGHT : 1, bOff ? OFF_RACE_WEIGHT : 1);
  });
}

function recordFor(games, id) {
  let wins = 0;
  let losses = 0;
  for (const game of games) {
    if (game.a !== id && game.b !== id) continue;
    const won = game.a === id ? game.y === 1 : game.y === 0;
    if (won) wins += 1;
    else losses += 1;
  }
  return { games: wins + losses, wins, losses };
}

function computeRaceGlicko(games) {
  const states = new Map();
  const get = (id, race) => {
    const key = `${id}\u0000${race}`;
    if (!states.has(key)) {
      states.set(key, {
        id,
        race,
        rating: 3000,
        rd: RACE_INITIAL_RD,
        volatility: 0.06,
        games: 0,
        wins: 0,
        losses: 0,
        last_game_at: null
      });
    }
    return states.get(key);
  };

  for (const game of games) {
    if (!game.aPlay || !game.bPlay) continue;
    const a = get(game.a, game.aPlay);
    const b = get(game.b, game.bPlay);
    const timestamp = game.playedAt ? new Date(game.playedAt).getTime() : 0;
    for (const player of [a, b]) {
      inflateRd(player, timestamp, { periodDays: RACE_INFLATION_DAYS });
    }
    const aBefore = { rating: a.rating, rd: a.rd, volatility: a.volatility };
    const bBefore = { rating: b.rating, rd: b.rd, volatility: b.volatility };
    const aNext = glickoUpdate(aBefore, bBefore, game.y);
    const bNext = glickoUpdate(bBefore, aBefore, 1 - game.y);
    Object.assign(a, aNext);
    Object.assign(b, bNext);
    a.games += 1;
    a.wins += game.y;
    a.losses += 1 - game.y;
    a.last_game_at = game.playedAt;
    b.games += 1;
    b.wins += 1 - game.y;
    b.losses += game.y;
    b.last_game_at = game.playedAt;
  }

  const byRace = { P: [], T: [], Z: [] };
  for (const state of states.values()) {
    byRace[state.race]?.push(state);
  }
  for (const race of Object.keys(byRace)) {
    byRace[race].sort((a, b) => b.rating - a.rating);
  }
  return byRace;
}

function decorate(player, players) {
  const meta = players.get(player.id) || {};
  return {
    ...player,
    display_name: meta.display_name || player.id,
    flag: meta.flag || 'cn',
    team: meta.team || ''
  };
}

/**
 * @param {object} input
 * @param {Array} input.games match rows
 * @param {Map} input.races per-match race map
 * @param {Map} input.players id -> metadata
 * @param {object} [overrides]
 */
export function computeRatingLab({
  games = [],
  races = new Map(),
  players = new Map(),
  mainRaceOverrides = MAIN_RACE_OVERRIDES
} = {}) {
  const labGames = buildGames(games, races);
  const ids = [...new Set(labGames.flatMap((game) => [game.a, game.b]))];
  const mainRaces = inferMainRaces(games, races, mainRaceOverrides);

  let ratings = fitBT(labGames, ids);
  const firstWeights = btWeights(labGames, mainRaces, ratings);
  ratings = fitBT(labGames, ids, firstWeights);
  const finalWeights = btWeights(labGames, mainRaces, ratings);
  ratings = fitBT(labGames, ids, finalWeights);

  const overall = ids
    .map((id) => {
      const base = ratings.get(id);
      const record = recordFor(labGames, id);
      return decorate(
        {
          id,
          rating: base.rating,
          mmr: Math.round(base.rating),
          main_race: mainRaces.get(id) || null,
          ...record
        },
        players
      );
    })
    .sort((a, b) => b.rating - a.rating)
    .map((player, index) => ({ ...player, rank: index + 1 }));

  const raceBoards = computeRaceGlicko(labGames);
  for (const race of Object.keys(raceBoards)) {
    raceBoards[race] = raceBoards[race]
      .sort((a, b) => {
        const aUsable = a.games >= MIN_RACE_GAMES ? 1 : 0;
        const bUsable = b.games >= MIN_RACE_GAMES ? 1 : 0;
        if (aUsable !== bUsable) return bUsable - aUsable;
        return b.rating - a.rating;
      })
      .map((player, index) => ({
        ...decorate(
          {
            ...player,
            mmr: Math.round(player.rating),
            rd: Math.round(player.rd),
            win_rate: player.games ? player.wins / player.games : 0
          },
          players
        ),
        rank: index + 1
      }));
  }

  const bestRace = [];
  for (const [id, mainRace] of mainRaces) {
    const candidates = ['P', 'T', 'Z']
      .map((race) => raceBoards[race].find((player) => player.id === id))
      .filter((player) => player && player.games >= MIN_RACE_GAMES);
    if (candidates.length === 0) continue;
    const best = candidates.sort((a, b) => b.rating - a.rating)[0];
    bestRace.push(
      decorate(
        {
          id,
          main_race: mainRace,
          race: best.race,
          rating: best.rating,
          mmr: Math.round(best.rating),
          rd: Math.round(best.rd),
          games: best.games,
          wins: best.wins,
          losses: best.losses
        },
        players
      )
    );
  }
  bestRace.sort((a, b) => b.rating - a.rating);
  bestRace.forEach((player, index) => {
    player.rank = index + 1;
  });

  const weightedGames = finalWeights.filter((weight) => weight < 0.999).length;
  const raceGames = labGames.filter((game) => game.aPlay && game.bPlay).length;
  return {
    meta: {
      games_total: games.length,
      games_with_race: raceGames,
      weighted_games: weightedGames,
      race_buckets: Object.values(raceBoards).reduce((sum, rows) => sum + rows.length, 0),
      min_race_games: MIN_RACE_GAMES,
      off_race_gap: OFF_RACE_GAP,
      off_race_weight: OFF_RACE_WEIGHT,
      race_initial_rd: RACE_INITIAL_RD,
      race_inflation_days: RACE_INFLATION_DAYS,
      main_race_overrides: mainRaceOverrides
    },
    overall,
    races: raceBoards,
    best_race: bestRace
  };
}

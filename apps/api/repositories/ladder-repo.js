import {
  BASE_MMR,
  ACTIVE_DAYS,
  PROVISIONAL_GAMES,
  computeLadder,
  lastGameByPlayer,
  randomizeSeedOrder,
  sortForSeeds,
  assignPercentileTiers,
  UNRATED_TIER,
} from '../lib/ladder.js';
import { getPlayerDisplayName } from './player-repo.js';
import { TournamentRepo } from './tournament-repo.js';
import { computeMatchRaces } from '../lib/match-races.js';

export function LadderRepo(db) {
  const tournaments = TournamentRepo(db);

  async function loadGames() {
    const res = await db.query(`
      SELECT
        m.id,
        m.tournament_id,
        m.round,
        m.position,
        m.player1_id,
        m.player2_id,
        m.score1,
        m.score2,
        t.name AS tournament_name,
        t.created_at AS played_at
      FROM axsuck.matches m
      JOIN axsuck.tournaments t ON t.id = m.tournament_id
      WHERE m.status = 'completed'
        AND m.player1_id IS NOT NULL
        AND m.player2_id IS NOT NULL
        AND m.player1_id <> m.player2_id
        AND m.score1 <> m.score2
      ORDER BY t.created_at ASC, m.round DESC, m.position ASC, m.id ASC
    `);
    return res.rows;
  }

  async function loadPlayers() {
    const res = await db.query('SELECT id, flag, team FROM axsuck.players');
    return new Map(res.rows.map((p) => [p.id, p]));
  }

  // Map of player id -> ISO timestamp of their latest completed game. This is
  // the same activity signal the ladder leaderboard filters on.
  async function lastGameAt() {
    const games = await loadGames();
    const latest = lastGameByPlayer(games);
    return new Map(
      [...latest.entries()].map(([id, ms]) => [id, new Date(ms).toISOString()])
    );
  }

  // Race per side for the given matches, derived from uploaded replays. Only
  // the identity/race fields of each replay player are pulled out of the JSON
  // blob, so this stays cheap even though parsed_data is large.
  async function loadMatchRaces(games) {
    const matchIds = [...new Set(games.map((g) => g.id))];
    if (matchIds.length === 0) return new Map();

    const replayRows = (await db.query(`
      SELECT
        r.match_id,
        COALESCE(jsonb_agg(jsonb_build_object(
          'name', pl->>'name',
          'race', pl->>'race',
          'pick_race', pl->>'pick_race',
          'play_race', pl->>'play_race',
          'bnet_url', pl->>'bnet_url',
          'toon_handle', pl->>'toon_handle',
          'region_id', CASE WHEN pl->>'region_id' ~ '^[0-9]+$' THEN (pl->>'region_id')::int END,
          'subregion', CASE WHEN pl->>'subregion' ~ '^[0-9]+$' THEN (pl->>'subregion')::int END,
          'toon_id', CASE WHEN pl->>'toon_id' ~ '^[0-9]+$' THEN (pl->>'toon_id')::bigint END,
          'result', pl->>'result'
        )) FILTER (WHERE pl IS NOT NULL), '[]'::jsonb) AS players
      FROM axsuck.match_replays r
      LEFT JOIN LATERAL jsonb_array_elements(r.parsed_data::jsonb->'teams') AS team ON TRUE
      LEFT JOIN LATERAL jsonb_array_elements(team->'players') AS pl ON TRUE
      WHERE r.match_id = ANY($1::int[])
      GROUP BY r.id, r.match_id
    `, [matchIds])).rows;

    if (replayRows.length === 0) return new Map();

    const [playerRows, accountRows] = await Promise.all([
      db.query('SELECT id, battle_tags, bnet_ids FROM axsuck.players'),
      db.query(`
        SELECT tournament_id, player_id, account_name, url, toon_handle, region, subregion
        FROM axsuck.tournament_player_accounts
      `),
    ]);
    const accountsByPlayer = {};
    for (const account of accountRows.rows) {
      (accountsByPlayer[account.player_id] = accountsByPlayer[account.player_id] || []).push(account);
    }

    return computeMatchRaces({
      matches: games,
      replays: replayRows,
      players: playerRows.rows,
      accountsByPlayer,
    });
  }

  async function ratingLabData() {
    const [games, playerRows] = await Promise.all([loadGames(), loadPlayers()]);
    const races = await loadMatchRaces(games);
    const players = new Map(
      [...playerRows.entries()].map(([id, player]) => [
        id,
        {
          ...player,
          display_name: getPlayerDisplayName(player) || id
        }
      ])
    );
    return { games, races, players };
  }

  async function getRatings({ activeDays = ACTIVE_DAYS, includeInactive = false } = {}) {
    const [games, playerRows] = await Promise.all([loadGames(), loadPlayers()]);
    const { players: allPlayers, history } = computeLadder(games);
    const byId = new Map(
      allPlayers.map((p) => {
        const meta = playerRows.get(p.id) || {};
        return [
          p.id,
          {
            ...p,
            display_name: getPlayerDisplayName(meta) || p.id,
            flag: meta.flag || 'cn',
            team: meta.team || '',
          },
        ];
      })
    );

    const cutoff = Date.now() - activeDays * 86400000;
    const isActive = (p) =>
      p.last_game_at != null && new Date(p.last_game_at).getTime() >= cutoff;
    const visible = [...byId.values()]
      .filter((p) => includeInactive || isActive(p))
      .map((p, index) => ({
        ...p,
        rank: index + 1,
        active: isActive(p),
      }));
    const tiered = assignPercentileTiers(visible);

    return {
      players: tiered,
      byId,
      history,
      games,
      activeDays,
      includeInactive,
      cutoff,
    };
  }

  async function leaderboard(options = {}) {
    const { players } = await getRatings(options);
    return players;
  }

  async function playerDetail(playerId, { activeDays = ACTIVE_DAYS } = {}) {
    const { byId, history, games, cutoff } = await getRatings({ activeDays, includeInactive: true });
    const player = byId.get(playerId);
    if (!player) return null;

    const tournamentNames = new Map(
      games.map((g) => [g.tournament_id, g.tournament_name])
    );
    const playerHistory = history.filter((h) => h.player_id === playerId);
    const matchIds = new Set(playerHistory.map((h) => h.game_id));
    const matchRaces = await loadMatchRaces(games.filter((g) => matchIds.has(g.id)));
    // `history` is already in Elo calculation order; reverse it for newest-first
    // instead of re-sorting by timestamps (bulk-imported matches can share dates).
    const rows = playerHistory
      .reverse()
      .map((h) => {
        const races = matchRaces.get(h.game_id);
        return {
          ...h,
          opponent_name: byId.get(h.opponent_id)?.display_name || h.opponent_id,
          tournament_name: tournamentNames.get(h.tournament_id) || h.tournament_id,
          mmr_before: Math.round(h.rating_before),
          mmr_after: Math.round(h.rating_after),
          mmr_delta: Math.round(h.delta),
          opponent_mmr: Math.round(h.opponent_rating_before),
          opponent_mmr_after: Math.round(h.opponent_rating_after),
          race: races?.get(h.player_id)?.race || null,
          opponent_race: races?.get(h.opponent_id)?.race || null,
        };
      });

    return {
      ...player,
      active: player.last_game_at != null && new Date(player.last_game_at).getTime() >= cutoff,
      history: rows,
    };
  }

  function withDefaults(player) {
    return {
      id: player.id,
      display_name: player.display_name || getPlayerDisplayName(player) || player.id,
      flag: player.flag || 'cn',
      team: player.team || '',
      seed: player.seed ?? null,
      registered_at: player.registered_at || null,
      rating: player.rating ?? BASE_MMR,
      mmr: player.mmr ?? BASE_MMR,
      games: player.games ?? 0,
      wins: player.wins ?? 0,
      losses: player.losses ?? 0,
      win_rate: player.win_rate ?? 0,
      last_game_at: player.last_game_at ?? null,
      provisional: player.provisional ?? (player.games ?? 0) < PROVISIONAL_GAMES,
      tier: player.tier || { ...UNRATED_TIER },
    };
  }

  async function seedCandidates(tournamentId) {
    const [registrations, { byId }, tournament] = await Promise.all([
      db.query(
        `
        SELECT tp.player_id AS id, tp.seed, tp.registered_at,
               p.flag, p.team
        FROM axsuck.tournament_players tp
        JOIN axsuck.players p ON p.id = tp.player_id
        WHERE tp.tournament_id = $1
      `,
        [tournamentId]
      ),
      getRatings({ includeInactive: true }),
      tournaments.getById(tournamentId),
    ]);

    const players = registrations.rows.map((row) => {
      const rating = byId.get(row.id);
      return withDefaults({
        ...row,
        display_name: rating?.display_name || getPlayerDisplayName(row) || row.id,
        ...(rating
          ? {
              rating: rating.rating,
              mmr: rating.mmr,
              games: rating.games,
              wins: rating.wins,
              losses: rating.losses,
              win_rate: rating.win_rate,
              last_game_at: rating.last_game_at,
              provisional: rating.provisional,
              tier: rating.tier,
            }
          : {}),
      });
    });

    // Loser-advances brackets reward the lowest MMR with the top seed (and the
    // bye), so invert the MMR direction for those tournaments.
    return { players, descending: !tournament?.loser_advances };
  }

  async function suggestSeeds(tournamentId) {
    const { players, descending } = await seedCandidates(tournamentId);
    return sortForSeeds(players, { descending }).map((p, index) => ({ ...p, seed: index + 1 }));
  }

  async function setSeedMode(tournamentId, mode) {
    await db.query(
      'UPDATE axsuck.tournaments SET seed_mode = $1, updated_at = NOW() WHERE id = $2',
      [mode, tournamentId]
    );
  }

  async function applySeeds(tournamentId, ordered, mode = 'auto') {
    await tournaments.setSeeds(
      tournamentId,
      ordered.map((p) => p.id)
    );
    await setSeedMode(tournamentId, mode);
    return ordered.map((p, index) => ({ ...p, seed: index + 1 }));
  }

  async function autoSeeds(tournamentId) {
    const ordered = await suggestSeeds(tournamentId);
    return applySeeds(tournamentId, ordered, 'auto');
  }

  async function randomizeSeeds(
    tournamentId,
    { band = 80, keepTop = 2, keepBottom = 2 } = {}
  ) {
    const { players, descending } = await seedCandidates(tournamentId);
    const randomized = randomizeSeedOrder(players, {
      band,
      keepTop,
      keepBottom,
      descending,
    });
    return applySeeds(tournamentId, randomized, 'manual');
  }

  return {
    loadGames,
    lastGameAt,
    ratingLabData,
    getRatings,
    leaderboard,
    playerDetail,
    suggestSeeds,
    autoSeeds,
    randomizeSeeds,
    setSeedMode,
  };
}

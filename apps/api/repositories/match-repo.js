import { describeBracket, findLateEntrySlot } from '../lib/bracket.js';

function httpError(statusCode, message) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

export function MatchRepo(db) {
  async function getById(id, runner = db) {
    const res = await runner.query('SELECT * FROM axsuck.matches WHERE id = $1', [id]);
    return res.rows[0] || null;
  }

  async function getByTournament(tournamentId, runner = db) {
    const res = await runner.query(`
      SELECT * FROM axsuck.matches WHERE tournament_id = $1 ORDER BY round DESC, position ASC
    `, [tournamentId]);
    return res.rows;
  }

  async function getNextPosition(tournamentId, round, runner = db) {
    const res = await runner.query(`
      SELECT COALESCE(MAX(position), 0) as pos FROM axsuck.matches
      WHERE tournament_id = $1 AND round = $2
    `, [tournamentId, round]);
    return (res.rows[0]?.pos || 0) + 1;
  }

  async function create({ tournament_id, round, position, player1_id, player2_id }, runner = db) {
    const res = await runner.query(`
      INSERT INTO axsuck.matches (tournament_id, round, position, player1_id, player2_id)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `, [tournament_id, round, position, player1_id || null, player2_id || null]);
    return res.rows[0];
  }

  async function submitResult(id, score1, score2) {
    const match = await getById(id);
    if (!match) throw new Error('Match not found');

    const tourneyRes = await db.query('SELECT loser_advances, best_of FROM axsuck.tournaments WHERE id = $1', [match.tournament_id]);
    const tournament = tourneyRes.rows[0];
    const loserAdvances = tournament ? (tournament.loser_advances !== 0) : true;
    const bestOf = Math.max(1, Number(tournament?.best_of) || 1);
    const target = Math.floor(bestOf / 2) + 1;
    const s1 = Number(score1);
    const s2 = Number(score2);

    if (!Number.isInteger(s1) || !Number.isInteger(s2) || s1 < 0 || s2 < 0) {
      throw new Error('Scores must be non-negative integers');
    }
    if (s1 === s2) {
      throw new Error('A match cannot end in a tie');
    }
    if (Math.max(s1, s2) < target) {
      throw new Error(`A best-of-${bestOf} match needs ${target} wins`);
    }
    if (Math.max(s1, s2) > bestOf) {
      throw new Error(`Scores cannot exceed best of ${bestOf}`);
    }

    let winnerId = null;
    if (s1 > s2) {
      winnerId = loserAdvances ? match.player2_id : match.player1_id;
    } else if (s2 > s1) {
      winnerId = loserAdvances ? match.player1_id : match.player2_id;
    }

    const updateRes = await db.query(`
      UPDATE axsuck.matches SET score1 = $1, score2 = $2, winner_id = $3, status = 'completed', completed_at = NOW()
      WHERE id = $4
      RETURNING *
    `, [s1, s2, winnerId, id]);

    return updateRes.rows[0];
  }

  async function generateBracket(tournamentId) {
    const client = await db.connect();
    try {
      await client.query('BEGIN');

      const playersRes = await client.query(`
        SELECT p.id, tp.seed FROM axsuck.tournament_players tp
        JOIN axsuck.players p ON p.id = tp.player_id
        WHERE tp.tournament_id = $1
        ORDER BY tp.seed IS NULL, tp.seed ASC, tp.registered_at ASC
      `, [tournamentId]);

      const players = playersRes.rows;
      if (players.length < 2) throw new Error('Need at least 2 players');

      // Automatically assign and compact seeds sequentially (1 to N)
      for (let idx = 0; idx < players.length; idx++) {
        const p = players[idx];
        const targetSeed = idx + 1;
        if (p.seed !== targetSeed) {
          await client.query(`
            UPDATE axsuck.tournament_players SET seed = $1
            WHERE tournament_id = $2 AND player_id = $3
          `, [targetSeed, tournamentId, p.id]);
          p.seed = targetSeed;
        }
      }

      await client.query('DELETE FROM axsuck.matches WHERE tournament_id = $1', [tournamentId]);

      const n = players.length;
      const bracket = describeBracket(n);
      const size = bracket.size;
      const totalRounds = bracket.totalRounds;

      const seedingOrder = getSeedingOrder(size);
      const slots = seedingOrder.map(seed => {
        const player = players.find(p => p.seed === seed);
        return player ? player.id : null;
      });

      await buildRounds(tournamentId, slots, totalRounds, client);

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    return getByTournament(tournamentId);
  }

  async function advanceWinner(tournamentId, matchId) {
    const match = await getById(matchId);
    if (!match) throw new Error('Match not found');
    if ((match.status !== 'completed' && match.status !== 'walkover') || !match.winner_id) {
      throw new Error('Match not completed or no winner');
    }

    const nextRound = match.round - 1;
    if (nextRound < 1) return null; // final match

    const nextPosition = Math.ceil(match.position / 2);

    const nextRes = await db.query(`
      SELECT * FROM axsuck.matches WHERE tournament_id = $1 AND round = $2 AND position = $3
    `, [tournamentId, nextRound, nextPosition]);
    let nextMatch = nextRes.rows[0] || null;

    if (!nextMatch) {
      const pos = await getNextPosition(tournamentId, nextRound);
      const isPlayer1 = match.position % 2 === 1;
      nextMatch = await create({
        tournament_id: tournamentId,
        round: nextRound,
        position: pos,
        player1_id: isPlayer1 ? match.winner_id : null,
        player2_id: !isPlayer1 ? match.winner_id : null
      });
    } else {
      const isPlayer1 = match.position % 2 === 1;
      if (isPlayer1) {
        await db.query('UPDATE axsuck.matches SET player1_id = $1 WHERE id = $2', [match.winner_id, nextMatch.id]);
      } else {
        await db.query('UPDATE axsuck.matches SET player2_id = $1 WHERE id = $2', [match.winner_id, nextMatch.id]);
      }
      nextMatch = await getById(nextMatch.id);
    }

    return nextMatch;
  }

  async function clearMatches(tournamentId) {
    await db.query('DELETE FROM axsuck.matches WHERE tournament_id = $1', [tournamentId]);
  }

  /**
   * Add a player mid-tournament without regenerating the bracket.
   *
   * The only safe slot is a first-round bye whose downstream match has not been
   * played. The new player takes the empty side, the bye becomes a real match,
   * and the lone player's pre-filled downstream slot is cleared until the result
   * is reported (advanceWinner then fills it normally).
   */
  async function addLateEntry(tournamentId, playerId) {
    const client = await db.connect();
    let matchId;
    let nextMatchId;
    try {
      await client.query('BEGIN');

      const tourneyRes = await client.query(`
        SELECT id, status, player_capacity, active_match_id
        FROM axsuck.tournaments WHERE id = $1 FOR UPDATE
      `, [tournamentId]);
      const tournament = tourneyRes.rows[0];
      if (!tournament) throw httpError(404, 'Tournament not found');
      if (tournament.status !== 'in_progress') {
        throw httpError(409, 'Late entry is only available while the tournament is in progress');
      }

      const existing = await client.query(`
        SELECT 1 FROM axsuck.tournament_players
        WHERE tournament_id = $1 AND player_id = $2
      `, [tournamentId, playerId]);
      if (existing.rows.length > 0) throw httpError(409, 'Already registered');

      const countRes = await client.query(`
        SELECT COUNT(*)::int AS cnt FROM axsuck.tournament_players WHERE tournament_id = $1
      `, [tournamentId]);
      const playerCount = countRes.rows[0]?.cnt || 0;
      if (playerCount >= tournament.player_capacity) {
        throw httpError(409, 'Tournament is full');
      }

      const seedRows = (await client.query(`
        SELECT player_id, seed FROM axsuck.tournament_players WHERE tournament_id = $1
      `, [tournamentId])).rows;
      const playerSeeds = new Map(seedRows.map((row) => [row.player_id, row.seed]));

      const rows = (await client.query(`
        SELECT * FROM axsuck.matches WHERE tournament_id = $1 ORDER BY round DESC, position ASC FOR UPDATE
      `, [tournamentId])).rows;
      const firstRound = Math.max(0, ...rows.map((m) => Number(m.round) || 0));
      const bracketSize = firstRound > 0 ? 2 ** firstRound : 0;
      // Normal seeding gives byes to 1..P-n; the new player is seed n+1 and
      // therefore faces the last bye (seed P-n) without moving anyone else.
      const lastByeSeed = bracketSize > playerCount ? bracketSize - playerCount : null;
      const slot = findLateEntrySlot(rows, {
        activeMatchId: tournament.active_match_id,
        playerSeeds,
        lastByeSeed,
      });
      if (!slot) {
        throw httpError(409, 'No open bye slot: the bracket is full or the next round has already started');
      }

      await client.query(`
        INSERT INTO axsuck.players (id) VALUES ($1) ON CONFLICT (id) DO NOTHING
      `, [playerId]);
      await client.query(`
        INSERT INTO axsuck.tournament_players (tournament_id, player_id, seed)
        VALUES ($1, $2, $3)
      `, [tournamentId, playerId, playerCount + 1]);

      if (slot.match.player1_id) {
        await client.query(`
          UPDATE axsuck.matches
          SET player2_id = $1, score1 = 0, score2 = 0, winner_id = NULL,
              status = 'pending', completed_at = NULL
          WHERE id = $2
        `, [playerId, slot.match.id]);
      } else {
        await client.query(`
          UPDATE axsuck.matches
          SET player1_id = $1, score1 = 0, score2 = 0, winner_id = NULL,
              status = 'pending', completed_at = NULL
          WHERE id = $2
        `, [playerId, slot.match.id]);
      }

      if (slot.slotKey === 'player1_id') {
        await client.query('UPDATE axsuck.matches SET player1_id = NULL WHERE id = $1', [slot.nextMatch.id]);
      } else {
        await client.query('UPDATE axsuck.matches SET player2_id = NULL WHERE id = $1', [slot.nextMatch.id]);
      }

      await client.query('COMMIT');
      matchId = slot.match.id;
      nextMatchId = slot.nextMatch.id;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    return {
      match: await getById(matchId),
      next_match: await getById(nextMatchId),
    };
  }

  return { getById, getByTournament, create, submitResult, generateBracket, advanceWinner, clearMatches, addLateEntry };
}

function getSeedingOrder(size) {
  if (size <= 2) return [1, 2];
  const half = getSeedingOrder(size / 2);
  const result = [];
  for (let i = 0; i < half.length; i++) {
    result.push(half[i]);
    result.push(size + 1 - half[i]);
  }
  return result;
}

function isBranchEmpty(slots, round, pos, branchNum, totalRounds) {
  const len = 1 << (totalRounds - round);
  const startIdx = (pos - 1) * 2 * len + (branchNum - 1) * len;
  const endIdx = startIdx + len;
  const slice = slots.slice(startIdx, endIdx);
  return slice.every(player => player === null);
}

async function buildRounds(tournamentId, slots, totalRounds, runner) {
  let current = slots.slice();
  for (let round = totalRounds; round >= 1; round--) {
    const next = [];
    for (let i = 0; i < current.length; i += 2) {
      const p1 = current[i];
      const p2 = current[i + 1];
      const pos = (i / 2) + 1;

      let winnerId = null;
      let status = 'pending';
      let nextPlayer = null;

      const p1Empty = isBranchEmpty(slots, round, pos, 1, totalRounds);
      const p2Empty = isBranchEmpty(slots, round, pos, 2, totalRounds);

      if (p1 && p2Empty) {
        winnerId = p1;
        status = 'completed';
        nextPlayer = p1;
      } else if (p2 && p1Empty) {
        winnerId = p2;
        status = 'completed';
        nextPlayer = p2;
      } else if (p1 && p2) {
        winnerId = null;
        status = 'pending';
        nextPlayer = null;
      } else {
        winnerId = null;
        status = 'pending';
        nextPlayer = null;
      }

      await runner.query(`
        INSERT INTO axsuck.matches (tournament_id, round, position, player1_id, player2_id, winner_id, status)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [tournamentId, round, pos, p1 || null, p2 || null, winnerId, status]);

      next.push(nextPlayer);
    }
    current = next;
  }
}

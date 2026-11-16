import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { writeFileSync, unlinkSync, mkdirSync, existsSync } from 'fs';
import { exec } from 'child_process';
import util from 'util';
import zlib from 'zlib';
import os from 'os';
import { getPlayerDisplayName } from '../repositories/player-repo.js';
import { TournamentAccountRepo } from '../repositories/tournament-account-repo.js';
import { liquipediaBracketId, liquipediaBracketTemplate } from '../lib/bracket.js';
import { computeReplaySeriesStats, summarizeSeries } from '../lib/replay-score.js';
import { ALLOWED_QQ_GROUPS } from '../lib/qq-groups.js';
import {
  normalizeBnetUrl,
  replayPlayerAccountKey,
  playerAccountEntries,
  upsertGlobalAccountEntry,
  dedupeAccountEntries,
  bnetEntryAccountKeys,
  bnetEntryKey,
  parseBnetIdsField,
  flattenReplayPlayers,
  describeReplayAccount
} from '../lib/replay-identity.js';

// Keep the historical module surface: callers import these from the route file.
export {
  normalizeBnetUrl,
  replayPlayerAccountKey,
  regionLabel,
  accountEntryRegionLabel,
  tournamentAccountToBnetEntry,
  playerAccountEntries,
  upsertGlobalAccountEntry,
  dedupeAccountEntries,
  bnetEntryAccountKeys,
  bnetEntryKey,
  parseBnetIdsField,
  flattenReplayPlayers,
  describeReplayAccount,
  getPlayerInfoFromReplay
} from '../lib/replay-identity.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const execPromise = util.promisify(exec);
const PYTHON_COMMANDS = process.env.PYTHON_BIN
  ? [process.env.PYTHON_BIN]
  : ['python3', 'python'];

function quoteShellArg(value) {
  return `"${value.replace(/(["\\$`])/g, '\\$1')}"`;
}

function toDateOnly(value) {
  if (!value) return new Date().toISOString().split('T')[0];
  if (value instanceof Date) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  return String(value).split(' ')[0];
}

async function getPythonCommand() {
  const errors = [];

  for (const command of PYTHON_COMMANDS) {
    try {
      await execPromise(`${quoteShellArg(command)} -c "import sc2reader, spawningtool, json"`);
      return { ok: true, command };
    } catch (err) {
      errors.push(`${command}: ${err.message}`);
    }
  }

  return { ok: false, error: errors.join('\n') };
}

async function parseReplay(scriptPath, replayPath) {
  const envCheck = await getPythonCommand();
  if (!envCheck.ok) {
    return envCheck;
  }

  const { stdout } = await execPromise(
    `${quoteShellArg(envCheck.command)} ${quoteShellArg(scriptPath)} ${quoteShellArg(replayPath)}`
  );
  return { ok: true, stdout };
}

// Write a replay account into a player's GLOBAL bnet_ids (default association).
export async function learnGlobalAccount(db, player, repPlayer) {
  const bnetIds = dedupeAccountEntries(parseBnetIdsField(player.bnet_ids));
  if (!upsertGlobalAccountEntry(bnetIds, repPlayer)) return;
  await db.query('UPDATE axsuck.players SET bnet_ids = $1 WHERE id = $2', [JSON.stringify(bnetIds), player.id]);
  player.bnet_ids = JSON.stringify(bnetIds);
}

// Helper to check python dependencies
export async function checkPythonEnvironment() {
  return getPythonCommand();
}

export default async function replaysRoutes(fastify) {
  const db = fastify.db;

  // Middleware/helper to validate QQ group validation
  function validateQQGroup(qqGroup) {
    if (!qqGroup) {
      throw fastify.httpErrors.badRequest('QQ Group number is required.');
    }
    if (!ALLOWED_QQ_GROUPS.includes(qqGroup.toString().trim())) {
      throw fastify.httpErrors.forbidden('Invalid QQ Group. Access denied.');
    }
  }

  // Verify QQ Group number
  fastify.post('/verify-qq', async (req) => {
    const { qqGroup } = req.body;
    if (!qqGroup) {
      throw fastify.httpErrors.badRequest('QQ Group number is required.');
    }
    const isValid = ALLOWED_QQ_GROUPS.includes(qqGroup.toString().trim());
    return { valid: isValid };
  });

  // Upload replay(s) for a match
  fastify.post('/matches/:matchId/replays', async (req) => {
    const { matchId } = req.params;
    const { replays, qqGroup } = req.body; // replays is array of { filename, content (base64) }

    validateQQGroup(qqGroup);

    if (!replays || !Array.isArray(replays) || replays.length === 0) {
      throw fastify.httpErrors.badRequest('No replays provided.');
    }

    // Check if match exists
    const matchRes = await db.query('SELECT id FROM axsuck.matches WHERE id = $1', [matchId]);
    const match = matchRes.rows[0];
    if (!match) {
      throw fastify.httpErrors.notFound('Match not found.');
    }

    // Verify python is available
    const envCheck = await checkPythonEnvironment();
    if (!envCheck.ok) {
      throw fastify.httpErrors.internalServerError(
        'Server python environment is not fully configured (missing sc2reader/spawningtool).'
      );
    }

    const tempDir = join(os.tmpdir(), 'suck-replays');
    if (!existsSync(tempDir)) {
      mkdirSync(tempDir, { recursive: true });
    }

    const results = [];
    const scriptPath = join(__dirname, '..', 'scripts', 'parse_replay.py');

    for (const rep of replays) {
      const { filename, content } = rep;
      if (!filename || !content) continue;

      const buffer = Buffer.from(content, 'base64');
      const tempFilePath = join(tempDir, `${Date.now()}_${filename}`);

      try {
        // 1. Write raw replay to temporary file
        writeFileSync(tempFilePath, buffer);

        // 2. Call python script to parse
        const parseResult = await parseReplay(scriptPath, tempFilePath);
        if (!parseResult.ok) {
          throw new Error(parseResult.error);
        }
        const { stdout } = parseResult;
        const parsedData = JSON.parse(stdout);

        // 3. Compress raw replay buffer with Gzip
        const compressed = zlib.gzipSync(buffer);

        // 4. Save to database
        await db.query(`
          INSERT INTO axsuck.match_replays (
            match_id, filename, compressed_data, parsed_data, winner, map_name, game_length
          ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        `, [
          matchId,
          filename,
          compressed,
          JSON.stringify(parsedData),
          parsedData.winner,
          parsedData.map_name,
          parsedData.game_length
        ]);

        results.push({ filename, status: 'success' });
      } catch (err) {
        fastify.log.error(`Error parsing replay ${filename}: ${err.message}`);
        results.push({ filename, status: 'error', error: err.message });
      } finally {
        // Clean up temporary file
        try {
          if (existsSync(tempFilePath)) {
            unlinkSync(tempFilePath);
          }
        } catch (_) { }
      }
    }

    // Trigger real-time broadcast
    const matchObjRes = await db.query('SELECT tournament_id FROM axsuck.matches WHERE id = $1', [matchId]);
    const matchObj = matchObjRes.rows[0];
    if (matchObj) {
      fastify.tournamentEvents.emit(`update:${matchObj.tournament_id}`, { type: 'replays_updated', matchId });
    }

    return { results };
  });

  // Helper to match player from replay. Accepts a replay player object (preferred)
  // or a bare name string. Account URL match wins over display-name match.
  function findMatchPlayer(repPlayer, players) {
    const repName = typeof repPlayer === 'string' ? repPlayer : repPlayer?.name;
    if (!repName) return null;
    const nameLower = repName.toLowerCase().trim();

    // 1. Exact Battle.net account match
    const accountKey = typeof repPlayer === 'object' ? replayPlayerAccountKey(repPlayer) : '';
    if (accountKey) {
      const accountMatch = players.find(p => {
        return playerAccountEntries(p).some(entry =>
          bnetEntryAccountKeys(entry).includes(accountKey)
        );
      });
      if (accountMatch) return accountMatch;
    }

    // 2. Check exact ID match
    let matched = players.find(p => p.id.toLowerCase().trim() === nameLower);
    if (matched) return matched;
    
    // 3. Check exact display name match (derived from first non-empty battle tag nickname)
    matched = players.find(p => (p.display_name || '').toLowerCase().trim() === nameLower);
    if (matched) return matched;
    
    // 4. Check inside battle_tags JSON
    for (const p of players) {
      if (p.battle_tags) {
        try {
          const tags = typeof p.battle_tags === 'string' ? JSON.parse(p.battle_tags) : p.battle_tags;
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
          const hasMatch = tagList.some(tag => tag === nameLower || tag.split('#')[0] === nameLower);
          if (hasMatch) return p;
        } catch (_) {}
      }
    }

    // 5. Check inside bnet_ids JS accounts (by name), ignoring account URLs
    for (const p of players) {
      const ids = playerAccountEntries(p);
      const hasMatch = ids.some(item => {
        if (typeof item === 'string') {
          return normalizeBnetUrl(item) === nameLower || item.toLowerCase().trim() === nameLower;
        }
        if (item && typeof item === 'object' && item.id) {
          return item.id.toLowerCase().trim() === nameLower;
        }
        return false;
      });
      if (hasMatch) return p;
    }
    
    // 6. Check sub-string match
    const candidates = players.filter(p => 
      p.id.toLowerCase().includes(nameLower) || 
      (p.display_name || '').toLowerCase().includes(nameLower) ||
      nameLower.includes(p.id.toLowerCase())
    );
    if (candidates.length === 1) {
      return candidates[0];
    }
    return null;
  }

  // Batch upload and auto-match replays for a tournament
  fastify.post('/tournaments/:id/replays/batch', async (req) => {
    const { id: tournamentId } = req.params;
    const { replays, qqGroup } = req.body; // replays is array of { filename, content (base64) }

    validateQQGroup(qqGroup);

    if (!replays || !Array.isArray(replays) || replays.length === 0) {
      throw fastify.httpErrors.badRequest('No replays provided.');
    }

    const tourneyRes = await db.query('SELECT id, best_of FROM axsuck.tournaments WHERE id = $1', [tournamentId]);
    const tournament = tourneyRes.rows[0];
    if (!tournament) {
      throw fastify.httpErrors.notFound('Tournament not found.');
    }
    const bestOf = Math.max(1, Number(tournament.best_of) || 1);

    const envCheck = await checkPythonEnvironment();
    if (!envCheck.ok) {
      throw fastify.httpErrors.internalServerError(
        'Server python environment is not fully configured (missing sc2reader/spawningtool).'
      );
    }

    // Fetch players to do mapping
    const playersRes = await db.query(`
      SELECT p.*
      FROM axsuck.tournament_players tp
      JOIN axsuck.players p ON tp.player_id = p.id
      WHERE tp.tournament_id = $1
    `, [tournamentId]);
    const accountRepo = TournamentAccountRepo(db);
    const tournamentAccounts = await accountRepo.listByTournament(tournamentId);
    const accountsByPlayer = {};
    for (const a of tournamentAccounts) {
      (accountsByPlayer[a.player_id] = accountsByPlayer[a.player_id] || []).push(a);
    }
    const players = playersRes.rows.map(p => ({
      ...p,
      display_name: getPlayerDisplayName(p),
      tournament_accounts: accountsByPlayer[p.id] || []
    }));

    const tempDir = join(os.tmpdir(), 'suck-replays');
    if (!existsSync(tempDir)) {
      mkdirSync(tempDir, { recursive: true });
    }

    const results = [];
    const scriptPath = join(__dirname, '..', 'scripts', 'parse_replay.py');

    for (const rep of replays) {
      const { filename, content } = rep;
      if (!filename || !content) continue;

      const buffer = Buffer.from(content, 'base64');
      const tempFilePath = join(tempDir, `${Date.now()}_${filename}`);

      try {
        writeFileSync(tempFilePath, buffer);
        const parseResult = await parseReplay(scriptPath, tempFilePath);
        if (!parseResult.ok) {
          throw new Error(parseResult.error);
        }
        const { stdout } = parseResult;
        const parsedData = JSON.parse(stdout);
        const compressed = zlib.gzipSync(buffer);

        // Find players
        const repPlayers = flattenReplayPlayers(parsedData);
        if (repPlayers.length < 2) {
          throw new Error('Replay does not have 2 players');
        }

        const repP1 = repPlayers[0];
        const repP2 = repPlayers[1];

        const p1 = findMatchPlayer(repP1, players);
        const p2 = findMatchPlayer(repP2, players);

        // Unmapped when either side is unknown, or when both sides resolve to the
        // same registered player (two accounts sharing one display name).
        if (!p1 || !p2 || p1.id === p2.id) {
          results.push({
            filename,
            status: 'unmapped',
            content,
            repPlayers: [
              describeReplayAccount(repP1, p1),
              describeReplayAccount(repP2, p2)
            ]
          });
          continue;
        }

        // Decide how to associate the replay accounts. Default is GLOBAL; an
        // account already linked to another player is a shared/borrowed account,
        // so raise a conflict instead of silently overwriting.
        const linkDecisions = [
          { rep: repP1, player: p1 },
          { rep: repP2, player: p2 }
        ].map(({ rep, player }) => {
          const key = replayPlayerAccountKey(rep);
          if (!key) return { key, player, rep, action: 'none' };
          const ownsGlobal = parseBnetIdsField(player.bnet_ids).some(e => bnetEntryAccountKeys(e).includes(key));
          if (ownsGlobal) return { key, player, rep, action: 'keep' };
          const scoped = (accountsByPlayer[player.id] || []).some(e => bnetEntryAccountKeys(e).includes(key));
          if (scoped) return { key, player, rep, action: 'temporary' };
          const other = players.find(q => q.id !== player.id && playerAccountEntries(q).some(e => bnetEntryAccountKeys(e).includes(key)));
          if (other) return { key, player, rep, action: 'conflict', owner: other.id };
          return { key, player, rep, action: 'learn' };
        });

        const sideConflicts = linkDecisions.filter(d => d.action === 'conflict');
        if (sideConflicts.length > 0) {
          results.push({
            filename,
            status: 'unmapped',
            conflict: true,
            content,
            repPlayers: [describeReplayAccount(repP1, p1), describeReplayAccount(repP2, p2)],
            conflicts: sideConflicts.map(d => ({
              account_key: d.key,
              account_name: d.rep?.name || '',
              owner: d.owner,
              attempted: d.player.id
            }))
          });
          continue;
        }

        // Find match
        const matchRes = await db.query(`
          SELECT * FROM axsuck.matches 
          WHERE tournament_id = $1 
            AND ((player1_id = $2 AND player2_id = $3) OR (player1_id = $4 AND player2_id = $5))
        `, [tournamentId, p1.id, p2.id, p2.id, p1.id]);
        const match = matchRes.rows[0];

        if (!match) {
          throw new Error(`No scheduled match found for ${p1.display_name || p1.id} vs ${p2.display_name || p2.id}`);
        }

        // Check if duplicate replay file (same name or same match/map/length)
        const duplicateRes = await db.query(`
          SELECT id FROM axsuck.match_replays 
          WHERE match_id = $1 AND filename = $2
        `, [match.id, filename]);
        const duplicate = duplicateRes.rows[0];

        if (duplicate) {
          results.push({ filename, status: 'skipped', message: 'Replay already uploaded for this match', matchId: match.id });
          continue;
        }

        // Default: persist the replay accounts to each player's GLOBAL profile.
        // Temporary (tournament-scoped) links are only created via manual mapping.
        for (const d of linkDecisions) {
          if (d.action === 'learn' || d.action === 'keep') {
            await learnGlobalAccount(db, d.player, d.rep);
          }
        }

        // Save replay to database
        await db.query(`
          INSERT INTO axsuck.match_replays (
            match_id, filename, compressed_data, parsed_data, winner, map_name, game_length
          ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        `, [
          match.id,
          filename,
          compressed,
          JSON.stringify(parsedData),
          parsedData.winner,
          parsedData.map_name,
          parsedData.game_length
        ]);

        // Read-only: importing a replay never changes the match result.
        // Results are submitted by a human (the dialog can pre-fill from these
        // numbers), so best-of validation and advancement stay in one place.
        const allReplaysRes = await db.query(`
          SELECT parsed_data FROM axsuck.match_replays WHERE match_id = $1
        `, [match.id]);
        const p1Row = (await db.query('SELECT * FROM axsuck.players WHERE id = $1', [match.player1_id])).rows[0] || null;
        const p2Row = (await db.query('SELECT * FROM axsuck.players WHERE id = $1', [match.player2_id])).rows[0] || null;
        const summary = summarizeSeries({
          ...computeReplaySeriesStats({
            replays: allReplaysRes.rows,
            player1: p1Row,
            player2: p2Row,
            accountsByPlayer
          }),
          bestOf
        });

        results.push({
          filename,
          status: 'success',
          matchId: match.id,
          p1: p1.display_name || p1.id,
          p2: p2.display_name || p2.id,
          score1: summary.score1,
          score2: summary.score2,
          games: summary.games,
          complete: summary.complete
        });
      } catch (err) {
        results.push({ filename, status: 'error', error: err.message });
      } finally {
        try {
          if (existsSync(tempFilePath)) {
            unlinkSync(tempFilePath);
          }
        } catch (_) {}
      }
    }

    // Trigger real-time broadcast
    fastify.tournamentEvents.emit(`update:${tournamentId}`, { type: 'replays_updated' });

    return { results };
  });

  // Get replays for a match
  fastify.get('/matches/:matchId/replays', async (req) => {
    const { matchId } = req.params;
    const res = await db.query(`
      SELECT id, match_id, filename, parsed_data, winner, map_name, game_length, uploaded_at
      FROM axsuck.match_replays
      WHERE match_id = $1
      ORDER BY uploaded_at ASC
    `, [matchId]);

    return res.rows.map(r => ({
      ...r,
      parsed_data: typeof r.parsed_data === 'string' ? JSON.parse(r.parsed_data) : r.parsed_data
    }));
  });

  // Read-only replay score for the result dialog: importing replays never
  // completes a match, so the dialog asks for these numbers and pre-fills the
  // form; the human still submits, and best-of validation applies as usual.
  fastify.get('/matches/:matchId/replay-score', async (req) => {
    const { matchId } = req.params;
    const matchRes = await db.query('SELECT * FROM axsuck.matches WHERE id = $1', [matchId]);
    const match = matchRes.rows[0];
    if (!match) {
      throw fastify.httpErrors.notFound('Match not found.');
    }

    const tourneyRes = await db.query('SELECT best_of, loser_advances FROM axsuck.tournaments WHERE id = $1', [match.tournament_id]);
    const tournament = tourneyRes.rows[0] || {};
    const bestOf = Math.max(1, Number(tournament.best_of) || 1);

    const replaysRes = await db.query(`
      SELECT parsed_data FROM axsuck.match_replays
      WHERE match_id = $1
      ORDER BY uploaded_at ASC
    `, [match.id]);
    const p1Row = (await db.query('SELECT * FROM axsuck.players WHERE id = $1', [match.player1_id])).rows[0] || null;
    const p2Row = (await db.query('SELECT * FROM axsuck.players WHERE id = $1', [match.player2_id])).rows[0] || null;

    const accountRepo = TournamentAccountRepo(db);
    const tournamentAccounts = await accountRepo.listByTournament(match.tournament_id);
    const accountsByPlayer = {};
    for (const a of tournamentAccounts) {
      (accountsByPlayer[a.player_id] = accountsByPlayer[a.player_id] || []).push(a);
    }

    const summary = summarizeSeries({
      ...computeReplaySeriesStats({
        replays: replaysRes.rows,
        player1: p1Row,
        player2: p2Row,
        accountsByPlayer
      }),
      bestOf
    });

    return {
      ...summary,
      match_id: match.id,
      status: match.status,
      winner_id: match.winner_id,
      loser_advances: Boolean(tournament.loser_advances)
    };
  });

  // Download raw decompressed replay
  fastify.get('/replays/:replayId/download', async (req, reply) => {
    const { replayId } = req.params;
    const res = await db.query('SELECT filename, compressed_data FROM axsuck.match_replays WHERE id = $1', [replayId]);
    const replay = res.rows[0];
    if (!replay) {
      throw fastify.httpErrors.notFound('Replay not found.');
    }

    // Decompress on the fly
    const rawData = zlib.gunzipSync(Buffer.isBuffer(replay.compressed_data) ? replay.compressed_data : Buffer.from(replay.compressed_data));

    reply
      .header('Content-Disposition', `attachment; filename="${encodeURIComponent(replay.filename)}"`)
      .header('Content-Type', 'application/octet-stream')
      .send(rawData);
  });

  // Delete a replay
  fastify.delete('/replays/:replayId', async (req) => {
    const { replayId } = req.params;
    const matchInfoRes = await db.query(`
      SELECT m.tournament_id FROM axsuck.match_replays mr
      JOIN axsuck.matches m ON mr.match_id = m.id
      WHERE mr.id = $1
    `, [replayId]);
    const matchInfo = matchInfoRes.rows[0];

    const result = await db.query('DELETE FROM axsuck.match_replays WHERE id = $1', [replayId]);
    if (result.rowCount === 0) {
      throw fastify.httpErrors.notFound('Replay not found.');
    }

    if (matchInfo) {
      fastify.tournamentEvents.emit(`update:${matchInfo.tournament_id}`, { type: 'replay_deleted', replayId });
    }

    return { success: true };
  });

  // Reparse all replays for a tournament from raw compressed data
  fastify.post('/tournaments/:id/replays/reparse', async (req) => {
    const { id: tournamentId } = req.params;
    const matchesRes = await db.query('SELECT id FROM axsuck.matches WHERE tournament_id = $1', [tournamentId]);
    const matches = matchesRes.rows;
    const matchIds = matches.map(m => m.id);
    if (matchIds.length === 0) {
      return { success: true, count: 0 };
    }

    const replaysRes = await db.query('SELECT * FROM axsuck.match_replays WHERE match_id = ANY($1::int[])', [matchIds]);
    const replays = replaysRes.rows;
    const envCheck = await checkPythonEnvironment();
    if (!envCheck.ok) {
      throw fastify.httpErrors.internalServerError(
        'Server python environment is not fully configured (missing sc2reader/spawningtool).'
      );
    }

    const scriptPath = join(__dirname, '..', 'scripts', 'parse_replay.py');
    const tempDir = join(os.tmpdir(), 'suck-replays-reparse');
    if (!existsSync(tempDir)) {
      mkdirSync(tempDir, { recursive: true });
    }

    let count = 0;
    for (const rep of replays) {
      const tempFilePath = join(tempDir, `${Date.now()}_${rep.filename}`);
      try {
        const buffer = zlib.gunzipSync(Buffer.isBuffer(rep.compressed_data) ? rep.compressed_data : Buffer.from(rep.compressed_data));
        writeFileSync(tempFilePath, buffer);
        const parseResult = await parseReplay(scriptPath, tempFilePath);
        if (parseResult.ok) {
          const parsedData = JSON.parse(parseResult.stdout);
          await db.query(`
            UPDATE axsuck.match_replays 
            SET parsed_data = $1, winner = $2, map_name = $3, game_length = $4
            WHERE id = $5
          `, [JSON.stringify(parsedData), parsedData.winner, parsedData.map_name, parsedData.game_length, rep.id]);
          count++;
        }
      } catch (err) {
        fastify.log.error(`Failed to reparse replay ${rep.filename}: ${err.message}`);
      } finally {
        try {
          if (existsSync(tempFilePath)) {
            unlinkSync(tempFilePath);
          }
        } catch (_) {}
      }
    }

    // Rebuild tournament-scoped account links from the freshly parsed replays,
    // filling in missing URLs / toon handles (this is the "re-parse to fill
    // account URLs" action; temporary accounts stay scoped to this tournament).
    const accountRepo = TournamentAccountRepo(db);
    const pRes = await db.query(`
      SELECT p.id, p.bnet_ids, p.battle_tags
      FROM axsuck.tournament_players tp
      JOIN axsuck.players p ON tp.player_id = p.id
      WHERE tp.tournament_id = $1
    `, [tournamentId]);
    const accountPlayers = pRes.rows.map(p => ({ ...p, display_name: getPlayerDisplayName(p) }));

    const existingLinks = await accountRepo.listByTournament(tournamentId);
    const accByPlayer = {};
    for (const l of existingLinks) (accByPlayer[l.player_id] = accByPlayer[l.player_id] || []).push(l);
    for (const p of accountPlayers) p.tournament_accounts = accByPlayer[p.id] || [];

    const freshReplays = (await db.query(
      'SELECT parsed_data FROM axsuck.match_replays WHERE match_id = ANY($1::int[])',
      [matchIds]
    )).rows;

    // Collapse duplicate entries that resolve to the same account URL.
    for (const p of accountPlayers) {
      const before = parseBnetIdsField(p.bnet_ids);
      const deduped = dedupeAccountEntries(before);
      if (deduped.length !== before.length) {
        await db.query('UPDATE axsuck.players SET bnet_ids = $1 WHERE id = $2', [JSON.stringify(deduped), p.id]);
        p.bnet_ids = JSON.stringify(deduped);
      }
    }

    // Re-parse fills account URLs into GLOBAL profiles (default). Existing
    // scoped links are kept only if they are genuine temporary overrides
    // (i.e. the player has no matching global account); otherwise they are
    // leftover auto-links and get merged into global and dropped.
    const conflicts = [];
    let accountsLearned = 0;
    let accountsMerged = 0;

    for (const row of freshReplays) {
      let parsed;
      try { parsed = typeof row.parsed_data === 'string' ? JSON.parse(row.parsed_data) : row.parsed_data; } catch (_) { continue; }
      const reps = flattenReplayPlayers(parsed);
      for (const rep of reps) {
        const key = replayPlayerAccountKey(rep);
        if (!key) continue;

        let owner = accountPlayers.find(p => playerAccountEntries(p).some(e => bnetEntryAccountKeys(e).includes(key)));
        if (!owner) {
          const sameName = reps.filter(x => (x.name || '').toLowerCase().trim() === (rep.name || '').toLowerCase().trim());
          if (sameName.length === 1) owner = findMatchPlayer(rep, accountPlayers);
        }
        if (!owner) continue;

        const ownsScoped = (owner.tournament_accounts || []).some(e => bnetEntryAccountKeys(e).includes(key));
        if (ownsScoped) {
          const repNameLower = (rep.name || '').toLowerCase().trim();
          const hasMatchingGlobal = parseBnetIdsField(owner.bnet_ids).some(e => {
            const k = bnetEntryKey(e);
            const id = ((typeof e === 'string' ? e : e?.id) || '').toLowerCase().trim();
            return (k && k === key) || (repNameLower && id === repNameLower);
          });
          if (!hasMatchingGlobal) continue; // genuine temporary override -> keep scoped

          // Leftover auto-link: merge into global and drop the scoped duplicate.
          await learnGlobalAccount(db, owner, rep);
          await accountRepo.remove(tournamentId, key);
          owner.tournament_accounts = (owner.tournament_accounts || []).filter(e => !bnetEntryAccountKeys(e).includes(key));
          accountsMerged++;
          continue;
        }

        const other = accountPlayers.find(q => q.id !== owner.id && playerAccountEntries(q).some(e => bnetEntryAccountKeys(e).includes(key)));
        if (other) {
          conflicts.push({ account_key: key, account_name: rep.name || '', owner: other.id, attempted: owner.id });
          continue;
        }

        const before = owner.bnet_ids;
        await learnGlobalAccount(db, owner, rep);
        if (owner.bnet_ids !== before) accountsLearned++;
      }
    }

    // Trigger real-time broadcast
    fastify.tournamentEvents.emit(`update:${tournamentId}`, { type: 'replays_updated' });

    return { success: true, count, accounts_updated: accountsLearned, accounts_merged: accountsMerged, conflicts };
  });

  // Generate Liquipedia Wiki Script for a tournament
  fastify.get('/tournaments/:id/wiki', async (req) => {
    const { id: tournamentId } = req.params;
    const tourneyRes = await db.query('SELECT * FROM axsuck.tournaments WHERE id = $1', [tournamentId]);
    const tournament = tourneyRes.rows[0];
    if (!tournament) {
      throw fastify.httpErrors.notFound('Tournament not found.');
    }

    const playersRes = await db.query(`
      SELECT 
        p.id, 
        p.bnet_ids,
        p.battle_tags,
        COALESCE(NULLIF(p.flag, ''), NULLIF(tp.flag, ''), 'cn') AS flag, 
        COALESCE(NULLIF(tp.team, ''), p.team, '') AS team, 
        COALESCE(NULLIF(tp.link, ''), p.link, '') AS link, 
        tp.seed, 
        tp.registered_at
      FROM axsuck.tournament_players tp
      JOIN axsuck.players p ON tp.player_id = p.id
      WHERE tp.tournament_id = $1
      ORDER BY tp.seed IS NULL, tp.seed ASC, tp.registered_at ASC
    `, [tournamentId]);
    const players = playersRes.rows.map(p => ({
      ...p,
      display_name: getPlayerDisplayName(p)
    }));

    const wikiAccounts = await TournamentAccountRepo(db).listByTournament(tournamentId);
    const wikiAccountsByPlayer = {};
    for (const a of wikiAccounts) {
      (wikiAccountsByPlayer[a.player_id] = wikiAccountsByPlayer[a.player_id] || []).push(a);
    }

    const matchesRes = await db.query(`
      SELECT m.*, 
             p1.battle_tags AS player1_battle_tags,
             p1.bnet_ids AS player1_bnet_ids,
             COALESCE(tp1.flag, p1.flag) AS player1_flag,
             COALESCE(tp1.team, p1.team) AS player1_team,
             COALESCE(tp1.link, p1.link) AS player1_link,
             p2.battle_tags AS player2_battle_tags,
             p2.bnet_ids AS player2_bnet_ids,
             COALESCE(tp2.flag, p2.flag) AS player2_flag,
             COALESCE(tp2.team, p2.team) AS player2_team,
             COALESCE(tp2.link, p2.link) AS player2_link,
             w.battle_tags AS winner_battle_tags
      FROM axsuck.matches m
      LEFT JOIN axsuck.players p1 ON m.player1_id = p1.id
      LEFT JOIN axsuck.tournament_players tp1 ON tp1.tournament_id = m.tournament_id AND tp1.player_id = m.player1_id
      LEFT JOIN axsuck.players p2 ON m.player2_id = p2.id
      LEFT JOIN axsuck.tournament_players tp2 ON tp2.tournament_id = m.tournament_id AND tp2.player_id = m.player2_id
      LEFT JOIN axsuck.players w ON m.winner_id = w.id
      WHERE m.tournament_id = $1
      ORDER BY m.round ASC, m.position ASC
    `, [tournamentId]);
    const matches = matchesRes.rows.map(m => {
      const p1Name = getPlayerDisplayName({ id: m.player1_id, battle_tags: m.player1_battle_tags }) || m.player1_id || 'TBD';
      const p2Name = getPlayerDisplayName({ id: m.player2_id, battle_tags: m.player2_battle_tags }) || m.player2_id || 'TBD';
      const winnerName = getPlayerDisplayName({ id: m.winner_id, battle_tags: m.winner_battle_tags }) || m.winner_id;
      return {
        ...m,
        player1_name: p1Name,
        player2_name: p2Name,
        winner_name: winnerName
      };
    });

    // Fetch replays for these matches to extract maps and game details
    const matchIds = matches.map(m => m.id);
    const replays = matchIds.length > 0
      ? (await db.query('SELECT * FROM axsuck.match_replays WHERE match_id = ANY($1::int[])', [matchIds])).rows
      : [];

    const replaysByMatchId = {};
    replays.forEach(r => {
      r.parsed_data = typeof r.parsed_data === 'string' ? JSON.parse(r.parsed_data) : r.parsed_data;
      replaysByMatchId[r.match_id] = replaysByMatchId[r.match_id] || [];
      replaysByMatchId[r.match_id].push(r);
    });

    // Determine tournament date based on earliest replay time, fallback to creation date
    let earliestReplayTime = null;
    replays.forEach(r => {
      if (r.parsed_data?.start_time) {
        if (earliestReplayTime === null || r.parsed_data.start_time < earliestReplayTime) {
          earliestReplayTime = r.parsed_data.start_time;
        }
      }
    });

    const formattedDate = toDateOnly(tournament.created_at);
    let tournamentDate = formattedDate;
    if (earliestReplayTime) {
      const d = new Date(earliestReplayTime * 1000);
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      tournamentDate = `${year}-${month}-${day}`;
    }

    const tournamentNumberMatch = tournament.name.match(/\d+$/);
    const tournamentNumber = tournamentNumberMatch ? tournamentNumberMatch[0] : 'XXX';
    const eventBestOf = Math.max(1, Number(tournament.best_of) || 1);

    // Dynamically build web application tournament URL using referer header
    let bracketUrl = `https://challonge.com/succk${tournamentNumber}`;
    if (req.headers.referer) {
      try {
        const refUrl = new URL(req.headers.referer);
        bracketUrl = `${refUrl.origin}/tournament/${tournamentId}`;
      } catch (_) {}
    }

    let wikiScript = `{{DISPLAYTITLE:StarCraft Ultra Chicken King #{{SUBPAGENAME}}}}\n`;
    wikiScript += `{{SUCK_Navbox}}\n`;
    wikiScript += `{{Infobox league\n`;
    wikiScript += `|name=S.U.C.K #{{SUBPAGENAME}}\n`;
    wikiScript += `|image=Alpha X logo dec 2020.png\n`;
    wikiScript += `|series=StarCraft Ultra Chicken King\n`;
    wikiScript += `|abbreviation=SUCK\n`;
    wikiScript += `|tickername=SUCK#{{SUBPAGENAME}}\n`;
    wikiScript += `|number={{SUBPAGENAME}}\n`;
    wikiScript += `|organizer=AlphaX战队星际水友群\n`;
    wikiScript += `|sponsor=\n`;
    wikiScript += `|game=lotv\n`;
    wikiScript += `|server=cn\n`;
    wikiScript += `|type=Online\n`;
    wikiScript += `|country=China\n`;
    wikiScript += `|format=1v1<br>Single-elimination\n`;
    wikiScript += `|prizepool=0\n`;
    wikiScript += `|localcurrency=cny\n`;
    wikiScript += `|date=${tournamentDate}\n`;
    wikiScript += `|liquipediatier=4 |tiertype=Showmatch\n`;
    wikiScript += `|bracket=${bracketUrl}\n`;
    wikiScript += `}}\n\n`;

    wikiScript += `==Format==\n`;
    wikiScript += `* 单淘 Single-elimination bracket\n`;

    const matchCounts = matches.map(m => (replaysByMatchId[m.id] || []).length).filter(c => c > 0);
    const maxGames = matchCounts.length > 0 ? Math.max(...matchCounts) : 1;
    const inferredBestOf = maxGames > 1 ? (maxGames % 2 === 0 ? maxGames + 1 : maxGames) : 1;
    const formatBo = `Bo${eventBestOf > 1 ? eventBestOf : inferredBestOf}`;
    wikiScript += `* 所有比赛均${formatBo} All matches are ${formatBo}\n`;
    wikiScript += `* 败者晋级 Loser of each match advance to the next round.\n\n`;

    wikiScript += `===Map Pool===\n`;
    wikiScript += `* 选手可以Ban图或者限定天梯地图，不然主办随机选了 Player can specify maps to ban, or demand ladder maps. Otherwise the organizer will randomly pick from all Blizzard or GSL maps.\n`;
    wikiScript += `{{MapPoolTable|size=x132px}}\n\n`;

    wikiScript += `==Talents==\n`;
    wikiScript += `{{BroadcasterCard\n`;
    wikiScript += `|position=Host\n`;
    wikiScript += `|b1=Wayne|b1flag=CN|b1link=User:Wayne19980\n`;
    wikiScript += `}}\n`;
    wikiScript += `{{BroadcasterCard\n`;
    wikiScript += `|position=Caster\n`;
    wikiScript += `|b1=Wayne|b1flag=CN|b1link=User:Wayne19980\n`;
    wikiScript += `}}\n\n`;

    wikiScript += `==Prize Pool==\n`;
    wikiScript += `{{ParticipantTable|hidden=true\n`;
    players.forEach((player, index) => {
      const displayName = player.display_name;
      const flag = player.flag || "cn";
      const teamStr = player.team ? `|p${index + 1}team=${player.team}` : "";
      const linkStr = player.link ? `|p${index + 1}link=${player.link}` : "";
      wikiScript += `|p${index + 1}=${displayName}|p${index + 1}flag=${flag}${teamStr}${linkStr}\n`;
    });
    wikiScript += `}}\n`;

    const playerCount = players.length;
    wikiScript += `{{SoloPrizePool\n`;
    wikiScript += `|{{Slot|place=1}}\n`;
    if (playerCount >= 2) wikiScript += `|{{Slot|place=2}}\n`;

    if (playerCount === 3) {
      wikiScript += `|{{Slot|place=3}}\n`;
    } else if (playerCount >= 4) {
      if (tournament.hold_third_place === 1) {
        wikiScript += `|{{Slot|place=3}}\n`;
        wikiScript += `|{{Slot|place=4}}\n`;
      } else {
        wikiScript += `|{{Slot|place=3-4}}\n`;
      }
    }

    if (playerCount >= 8) {
      wikiScript += `|{{Slot|place=5-8}}\n`;
    } else if (playerCount > 4) {
      const placeStr = playerCount === 5 ? "5" : `5-${playerCount}`;
      wikiScript += `|{{Slot|place=${placeStr}}}\n`;
    }
    if (playerCount >= 16) {
      wikiScript += `|{{Slot|place=9-16}}\n`;
    } else if (playerCount > 8) {
      const placeStr = playerCount === 9 ? "9" : `9-${playerCount}`;
      wikiScript += `|{{Slot|place=${placeStr}}}\n`;
    }
    wikiScript += `}}\n\n`;

    wikiScript += `==Notable Participants==\n`;
    wikiScript += `{{ParticipantTable|count=true|onlyNotable=|tournament=#}}\n\n`;

    wikiScript += `==Results==\n`;

    const matchCount = matches.length;
    const bracketTemplate =
      liquipediaBracketTemplate(playerCount) ||
      liquipediaBracketTemplate(matchCount + 1) ||
      "Bracket/16";
    wikiScript += `{{Bracket|${bracketTemplate}|id=${liquipediaBracketId(tournamentId, tournament.name)}\n`;

    // Group matches by round for bracket structure rendering
    const maxDbRound = Math.max(...matches.map(m => m.round), 1);
    const rounds = {};
    matches.forEach(m => {
      // Skip bye rounds (where one opponent is null/TBD and the match was skipped/walkover/never played)
      const isBye = (!m.player1_id && m.player2_id) || (m.player1_id && !m.player2_id);
      if (isBye) return;

      const lpRound = maxDbRound - m.round + 1;
      rounds[lpRound] = rounds[lpRound] || [];
      rounds[lpRound].push(m);
    });

    const roundKeys = Object.keys(rounds).sort((a, b) => parseInt(a) - parseInt(b));
    roundKeys.forEach(rKey => {
      const roundMatches = rounds[rKey];
      roundMatches.forEach((m, idx) => {
        const matchReplays = replaysByMatchId[m.id] || [];
        const numGames = matchReplays.length;
        const winner = m.winner_id === m.player1_id ? 1 : (m.winner_id === m.player2_id ? 2 : 0);
        const isWalkover = m.status === 'walkover';

        const p1Name = m.player1_name || 'TBD';
        const p2Name = m.player2_name || 'TBD';

        const matchIdx = idx + 1;
        wikiScript += `|R${rKey}M${matchIdx}={{Match\n`;

        if (isWalkover) {
          wikiScript += `    |winner=${winner}\n`;
          const opp1Score = winner === 1 ? "W" : "FF";
          const opp2Score = winner === 2 ? "W" : "FF";
          wikiScript += `    |opponent1={{1Opponent|${p1Name}|score=${opp1Score}}}\n`;
          wikiScript += `    |opponent2={{1Opponent|${p2Name}|score=${opp2Score}}}\n`;
        } else {
          const matchBestOf = eventBestOf > 1
            ? eventBestOf
            : (numGames > 0 ? (numGames % 2 === 0 ? numGames + 1 : numGames) : 1);
          wikiScript += `    |bestof=${matchBestOf}\n`;
          wikiScript += `    |winner=${winner}\n`;

          let matchDateStr = `${formattedDate} 20:00:00 {{abbr/CST}}`;
          if (matchReplays.length > 0 && matchReplays[0].parsed_data?.start_time) {
            const timestamp = matchReplays[0].parsed_data.start_time;
            const dateObj = new Date(timestamp * 1000);
            const formatter = new Intl.DateTimeFormat('en-US', {
              timeZone: 'Asia/Shanghai',
              year: 'numeric',
              month: '2-digit',
              day: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
              hour12: false
            });
            const parts = formatter.formatToParts(dateObj);
            const partMap = {};
            parts.forEach(p => { partMap[p.type] = p.value; });
            matchDateStr = `${partMap.year}-${partMap.month}-${partMap.day} ${partMap.hour}:${partMap.minute}:${partMap.second} {{abbr/CST}}`;
          }
          wikiScript += `    |date=${matchDateStr} \n`;

          const p1Bnet = m.player1_bnet_ids;
          const p2Bnet = m.player2_bnet_ids;
          const p1Extra = wikiAccountsByPlayer[m.player1_id] || [];
          const p2Extra = wikiAccountsByPlayer[m.player2_id] || [];

          let race1 = 'u';
          let race2 = 'u';
          if (matchReplays.length > 0) {
            const repP1 = getPlayerInfoFromReplay(m.player1_id, m.player1_name, m.player1_battle_tags, p1Bnet, matchReplays[0].parsed_data, p1Extra);
            const repP2 = getPlayerInfoFromReplay(m.player2_id, m.player2_name, m.player2_battle_tags, p2Bnet, matchReplays[0].parsed_data, p2Extra);
            if (repP1) {
              const r = (repP1.pick_race || repP1.race || 'u').toLowerCase();
              if (r !== '?') race1 = r;
            }
            if (repP2) {
              const r = (repP2.pick_race || repP2.race || 'u').toLowerCase();
              if (r !== '?') race2 = r;
            }
          }

          const opp1RaceStr = race1 && race1 !== 'u' ? `|race=${race1}` : '';
          const opp2RaceStr = race2 && race2 !== 'u' ? `|race=${race2}` : '';
          wikiScript += `    |opponent1={{1Opponent|${p1Name}${opp1RaceStr}}}\n`;
          wikiScript += `    |opponent2={{1Opponent|${p2Name}${opp2RaceStr}}}\n`;

          if (numGames > 0) {
            matchReplays.forEach((rep, gIdx) => {
              const mapName = (rep.map_name || 'Unknown').replace("-天梯版", "").replace("- 天梯版", "");
              
              const repP1 = getPlayerInfoFromReplay(m.player1_id, m.player1_name, m.player1_battle_tags, p1Bnet, rep.parsed_data, p1Extra);
              const repP2 = getPlayerInfoFromReplay(m.player2_id, m.player2_name, m.player2_battle_tags, p2Bnet, rep.parsed_data, p2Extra);

              let gRace1 = 'u';
              let gRace2 = 'u';
              if (repP1) {
                const r = (repP1.play_race || repP1.race || 'u').toLowerCase();
                if (r !== '?') gRace1 = r;
              }
              if (repP2) {
                const r = (repP2.play_race || repP2.race || 'u').toLowerCase();
                if (r !== '?') gRace2 = r;
              }
              
              let gWinner = '0';
              const p1Won = repP1?.result === 'Win';
              const p2Won = repP2?.result === 'Win';
              if (p1Won && !p2Won) {
                gWinner = '1';
              } else if (p2Won && !p1Won) {
                gWinner = '2';
              } else if (rep.winner) {
                const repWinnerLower = rep.winner.toLowerCase().trim();
                const p1MatchesWinner = repP1 && repP1.name && repP1.name.toLowerCase().trim() === repWinnerLower;
                const p2MatchesWinner = repP2 && repP2.name && repP2.name.toLowerCase().trim() === repWinnerLower;
                if (p1MatchesWinner && !p2MatchesWinner) gWinner = '1';
                else if (p2MatchesWinner && !p1MatchesWinner) gWinner = '2';
              }

              const gRace1Str = gRace1 && gRace1 !== 'u' ? `|race1=${gRace1}` : '';
              const gRace2Str = gRace2 && gRace2 !== 'u' ? `|race2=${gRace2}` : '';
              wikiScript += `    |map${gIdx + 1}={{Map|map=${mapName}${gRace1Str}${gRace2Str}|winner=${gWinner}}}\n`;
            });
          } else {
            const mapRace1Str = race1 && race1 !== 'u' ? `|race1=${race1}` : '';
            const mapRace2Str = race2 && race2 !== 'u' ? `|race2=${race2}` : '';
            wikiScript += `    |map1={{Map|map=TBD${mapRace1Str}${mapRace2Str}|winner=${winner}}}\n`;
          }
        }
        wikiScript += `}}\n`;
      });
    });
    wikiScript += `}}\n\n`;

    wikiScript += `==Racial Distribution==\n`;
    wikiScript += `{{RaceDist|last=1}}\n\n`;

    wikiScript += `==View Games==\n`;
    wikiScript += `===VODs===\n`;
    wikiScript += `*[https://space.bilibili.com/10130071/lists/5654276?type=season VODs on Bilibili]\n`;

    return { wikiScript };
  });
}

import { BroadcastRepo } from '../repositories/broadcast-repo.js';
import { initStreamSecret, signStreamKey, verifyStreamKey } from '../lib/stream-key.js';
import { isAllowedQQGroup } from '../lib/qq-groups.js';

// Identity for broadcast writes is a stateless HS256 stream key whose subject is
// the player id. Reads are public so an OBS browser source needs no credentials.
// The key is *not* a login: claiming one only requires the same QQ group gate as
// replay upload, so this is a transport change, not real authentication.
export default async function broadcastsRoutes(fastify) {
  const repo = BroadcastRepo(fastify.db);

  // Generate once and persist in app_secrets, so operators do not have to set
  // STREAM_KEY_SECRET. A failed init only means the request path keeps using
  // the env override / development fallback.
  await initStreamSecret(fastify.db).catch((err) => {
    fastify.log.error({ err }, 'stream key secret init failed; keeping the fallback secret');
  });

  // api.js URI-encodes both headers before sending them.
  function header(req, name) {
    const raw = req.headers[name];
    if (typeof raw !== 'string') return '';
    try {
      return decodeURIComponent(raw).trim();
    } catch {
      return raw.trim();
    }
  }

  function readBearer(req) {
    const authorization = req.headers.authorization;
    if (typeof authorization === 'string' && authorization.startsWith('Bearer ')) {
      return authorization.slice(7).trim();
    }
    const fallback = req.headers['x-stream-key'];
    return typeof fallback === 'string' ? fallback.trim() : '';
  }

  function requireCaster(req) {
    const token = readBearer(req);
    const verified = token ? verifyStreamKey(token) : null;
    if (!verified) throw fastify.httpErrors.unauthorized('A valid stream key is required');
    return verified.playerId;
  }

  function present(row) {
    if (!row) return null;
    return {
      player_id: row.player_id,
      tournament_id: row.tournament_id,
      tournament_name: row.tournament_name ?? null,
      tournament_status: row.tournament_status ?? null,
      match_id: row.match_id,
      started_at: row.started_at,
      updated_at: row.updated_at
    };
  }

  async function requirePlayer(playerId) {
    const res = await fastify.db.query('SELECT id FROM axsuck.players WHERE id = $1', [playerId]);
    if (!res.rowCount) throw fastify.httpErrors.notFound('Player not found');
  }

  async function requireTournament(tournamentId) {
    const res = await fastify.db.query('SELECT id FROM axsuck.tournaments WHERE id = $1', [tournamentId]);
    if (!res.rowCount) throw fastify.httpErrors.notFound('Tournament not found');
  }

  // null / '' / undefined all mean "no specific match yet".
  async function normalizeMatch(tournamentId, value) {
    if (value === null || value === undefined || value === '') return null;
    const matchId = Number(value);
    if (!Number.isInteger(matchId)) throw fastify.httpErrors.badRequest('match_id must be an integer');
    const res = await fastify.db.query(
      'SELECT id FROM axsuck.matches WHERE id = $1 AND tournament_id = $2',
      [matchId, tournamentId]
    );
    if (!res.rowCount) throw fastify.httpErrors.badRequest('match_id does not belong to this tournament');
    return matchId;
  }

  function announce(tournamentId, payload) {
    fastify.tournamentEvents.emit(`update:${tournamentId}`, payload);
  }

  // Claim (or re-claim) a long-lived key for the caller. Re-claiming is harmless:
  // the old key stays valid until it expires, which keeps OBS sources working.
  fastify.post('/broadcasts/key', async (req) => {
    const playerId = header(req, 'x-player-id');
    if (!playerId) throw fastify.httpErrors.badRequest('x-player-id header is required');
    if (!isAllowedQQGroup(header(req, 'x-qq-group'))) {
      throw fastify.httpErrors.forbidden('Invalid QQ Group. Access denied.');
    }
    await requirePlayer(playerId);
    const key = signStreamKey(playerId);
    const verified = verifyStreamKey(key);
    return { key, player_id: playerId, expires_at: verified ? verified.expiresAt : null };
  });

  // Public: what is this caster showing right now?
  fastify.get('/broadcasts/:playerId', async (req) => {
    const playerId = String(req.params.playerId || '').trim();
    if (!playerId) throw fastify.httpErrors.badRequest('playerId is required');
    const broadcast = await repo.getByPlayer(playerId);
    if (!broadcast) throw fastify.httpErrors.notFound('No active broadcast');
    return present(broadcast);
  });

  fastify.get('/broadcasts/me', async (req) => {
    const playerId = requireCaster(req);
    const broadcast = await repo.getByPlayer(playerId);
    if (!broadcast) throw fastify.httpErrors.notFound('No active broadcast');
    return present(broadcast);
  });

  // Start, or move, the caller's broadcast. One row per caster, so pointing at a
  // different tournament is the same call the UI makes when it goes live.
  fastify.post('/broadcasts/me', async (req) => {
    const playerId = requireCaster(req);
    await requirePlayer(playerId);

    const tournamentId = String(req.body?.tournament_id || '').trim();
    if (!tournamentId) throw fastify.httpErrors.badRequest('tournament_id is required');
    await requireTournament(tournamentId);
    const matchId = await normalizeMatch(tournamentId, req.body?.match_id);

    const broadcast = await repo.upsert({ playerId, tournamentId, matchId });
    announce(tournamentId, { type: 'broadcast_changed', player_id: playerId });
    return present(broadcast);
  });

  fastify.patch('/broadcasts/me', async (req) => {
    const playerId = requireCaster(req);
    const current = await repo.getByPlayer(playerId);
    if (!current) throw fastify.httpErrors.notFound('No active broadcast');
    const matchId = await normalizeMatch(current.tournament_id, req.body?.match_id);
    const broadcast = await repo.setMatch(playerId, matchId);
    announce(current.tournament_id, { type: 'broadcast_changed', player_id: playerId });
    return present(broadcast);
  });

  fastify.delete('/broadcasts/me', async (req) => {
    const playerId = requireCaster(req);
    const current = await repo.getByPlayer(playerId);
    const ended = await repo.remove(playerId);
    if (ended && current) {
      announce(current.tournament_id, { type: 'broadcast_ended', player_id: playerId });
    }
    return { ended };
  });
}

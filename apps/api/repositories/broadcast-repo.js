export function BroadcastRepo(db) {
  async function getByPlayer(playerId) {
    const res = await db.query(`
      SELECT
        b.*,
        t.name   AS tournament_name,
        t.status AS tournament_status
      FROM axsuck.broadcasts b
      JOIN axsuck.tournaments t ON t.id = b.tournament_id
      WHERE b.player_id = $1
    `, [playerId]);
    return res.rows[0] || null;
  }

  // Start a broadcast or move the existing one. Switching tournaments restarts
  // `started_at`; keeping the same tournament only refreshes `updated_at`.
  async function upsert({ playerId, tournamentId, matchId = null }) {
    await db.query(`
      INSERT INTO axsuck.broadcasts (player_id, tournament_id, match_id)
      VALUES ($1, $2, $3)
      ON CONFLICT (player_id) DO UPDATE SET
        started_at = CASE
          WHEN axsuck.broadcasts.tournament_id <> EXCLUDED.tournament_id THEN NOW()
          ELSE axsuck.broadcasts.started_at
        END,
        tournament_id = EXCLUDED.tournament_id,
        match_id = EXCLUDED.match_id,
        updated_at = NOW()
    `, [playerId, tournamentId, matchId]);
    return getByPlayer(playerId);
  }

  async function setMatch(playerId, matchId) {
    const res = await db.query(`
      UPDATE axsuck.broadcasts
      SET match_id = $2, updated_at = NOW()
      WHERE player_id = $1
      RETURNING player_id
    `, [playerId, matchId]);
    if (!res.rowCount) return null;
    return getByPlayer(playerId);
  }

  async function remove(playerId) {
    const res = await db.query('DELETE FROM axsuck.broadcasts WHERE player_id = $1', [playerId]);
    return res.rowCount > 0;
  }

  return { getByPlayer, upsert, setMatch, remove };
}

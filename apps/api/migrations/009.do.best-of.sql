ALTER TABLE axsuck.tournaments
  ADD COLUMN IF NOT EXISTS best_of INTEGER NOT NULL DEFAULT 1;

-- Backfill finished/ongoing events from the most games seen in any match
-- and the most wins any player has: 2 games or a 2-0 -> BO3, 3-0 -> BO5, ...
UPDATE axsuck.tournaments t
SET best_of = GREATEST(
  1,
  sub.max_wins * 2 - 1,
  sub.max_games + (sub.max_games % 2 = 0)::int
)
FROM (
  SELECT
    m.tournament_id,
    MAX(r.games) AS max_games,
    MAX(GREATEST(m.score1, m.score2)) AS max_wins
  FROM axsuck.matches m
  JOIN LATERAL (
    SELECT COUNT(*)::int AS games
    FROM axsuck.match_replays mr
    WHERE mr.match_id = m.id
  ) r ON true
  GROUP BY m.tournament_id
) sub
WHERE t.id = sub.tournament_id
  AND (sub.max_games > 1 OR sub.max_wins > 1);

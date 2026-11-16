SET search_path TO axsuck, public;

-- The overlay URL is bound to a caster, not to a tournament: one row per person
-- keeps the OBS browser source stable while tournaments change underneath it.
-- player_id is the primary key, so a caster has at most one live pointer.
CREATE TABLE IF NOT EXISTS broadcasts (
  player_id     TEXT PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
  tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  match_id      INTEGER REFERENCES matches(id) ON DELETE SET NULL,
  started_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_broadcasts_tournament ON broadcasts(tournament_id);

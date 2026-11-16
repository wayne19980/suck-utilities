ALTER TABLE axsuck.matches
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_matches_completed_at
  ON axsuck.matches(completed_at);

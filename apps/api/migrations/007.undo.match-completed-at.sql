DROP INDEX IF EXISTS axsuck.idx_matches_completed_at;

ALTER TABLE axsuck.matches
  DROP COLUMN IF EXISTS completed_at;

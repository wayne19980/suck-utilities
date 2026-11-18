-- Small key/value store for server-generated secrets. The first user is the
-- HS256 streaming key secret: the API generates it on first boot so operators
-- no longer have to put STREAM_KEY_SECRET in .env (the env var still overrides
-- and can rotate the key).
CREATE TABLE IF NOT EXISTS app_secrets (
  name TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

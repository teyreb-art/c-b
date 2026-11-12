CREATE TABLE IF NOT EXISTS dashboard_sessions (
  id_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  token_expires_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  refreshing_until INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS dashboard_sessions_expiry ON dashboard_sessions(expires_at);
CREATE TABLE IF NOT EXISTS dashboard_auth_limits (
  key TEXT PRIMARY KEY,
  hits INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS dashboard_auth_limits_expiry ON dashboard_auth_limits(expires_at);

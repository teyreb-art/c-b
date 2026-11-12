CREATE TABLE IF NOT EXISTS dashboard_notes (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES requests(id),
  body TEXT NOT NULL,
  author_email TEXT NOT NULL,
  author_role TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS dashboard_notes_request ON dashboard_notes(request_id, created_at);
CREATE TABLE IF NOT EXISTS dashboard_audit (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES requests(id),
  actor_email TEXT NOT NULL,
  actor_role TEXT NOT NULL,
  action TEXT NOT NULL,
  old_status TEXT,
  new_status TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS dashboard_audit_created ON dashboard_audit(created_at DESC);

-- Notes left by visitors. The public Worker only ever returns rows whose status is 'approved'.
CREATE TABLE entries (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  name TEXT NOT NULL,
  body TEXT NOT NULL,
  body_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'spam')),
  flags TEXT NOT NULL DEFAULT '',
  reviewed_at INTEGER,
  reply TEXT,
  reply_at INTEGER,
  -- Keyed hash of the visitor's IP (IPv6 reduced to /64) and country; both are cleared after 30 days.
  ip_hash TEXT,
  country TEXT,
  notified INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX entries_by_status ON entries (status, created_at DESC, id DESC);
CREATE INDEX entries_by_ip ON entries (ip_hash, created_at);
CREATE INDEX entries_by_body ON entries (body_hash, created_at);
CREATE INDEX entries_by_created ON entries (created_at);
CREATE INDEX entries_by_review ON entries (reviewed_at);

-- Shadow bans: submissions from these IP hashes are acknowledged but never stored.
CREATE TABLE bans (
  ip_hash TEXT PRIMARY KEY,
  until INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

-- Every moderation action, kept for 180 days.
CREATE TABLE audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  entry_id TEXT
);
CREATE INDEX audit_by_time ON audit (at);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT INTO settings (key, value) VALUES ('submissions_open', '1');

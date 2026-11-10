-- Puzzle text that must not be public before it is earned (the trail, the ranger's letter, the board), seeded from
-- the private solution book with `wrangler d1 execute hunt --remote --file <seed.sql>`.
CREATE TABLE content (key TEXT PRIMARY KEY, value TEXT NOT NULL);

-- Hit counters of the 1996 and 1999 pages.
CREATE TABLE counters (year INTEGER PRIMARY KEY, hits INTEGER NOT NULL DEFAULT 0);
INSERT INTO counters (year, hits) VALUES (1996, 0), (1999, 0);

-- Flags on the summit: a number, a date and a colour. No names and no text, so there is nothing to moderate.
CREATE TABLE flags (
  number INTEGER PRIMARY KEY AUTOINCREMENT,
  planted_at INTEGER NOT NULL,
  colour TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE
);
CREATE INDEX flags_by_ip ON flags (ip_hash, planted_at);

-- Replies from the ranger per sender and day, so the address cannot be used to bounce mail at anyone.
CREATE TABLE mail_log (sender_hash TEXT NOT NULL, day INTEGER NOT NULL, replies INTEGER NOT NULL, PRIMARY KEY (sender_hash, day));

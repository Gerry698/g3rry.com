-- Notes the site owner writes from the admin page. The page marks them; a visitor's note can never set this.
ALTER TABLE entries ADD COLUMN owner INTEGER NOT NULL DEFAULT 0;
-- Pinned notes are listed first on the page, newest pin first; NULL when not pinned.
ALTER TABLE entries ADD COLUMN pinned_at INTEGER;

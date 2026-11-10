-- Each flag remembers how many strata its climber had solved when the board let them plant it.
ALTER TABLE flags ADD COLUMN strata INTEGER NOT NULL DEFAULT 0;

-- Wrong answers per address, stratum and day, so a stratum cannot be worked through with a word list.
CREATE TABLE guesses (ip_hash TEXT NOT NULL, puzzle TEXT NOT NULL, day INTEGER NOT NULL, wrong INTEGER NOT NULL, PRIMARY KEY (ip_hash, puzzle, day));

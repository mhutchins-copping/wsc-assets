-- Track where a person record came from instead of using the `notes` free-text
-- field as an implicit state flag. Also add a timestamp so we can tell when
-- the sync last touched a row.
ALTER TABLE people ADD COLUMN source_system TEXT;
ALTER TABLE people ADD COLUMN source_updated_at TEXT;

-- Backfill: any person previously imported via the Entra sync was marked by
-- setting notes = 'Imported from Entra ID'. Convert that to structured data.
UPDATE people
SET source_system = 'entra',
    source_updated_at = COALESCE(source_updated_at, created_at)
WHERE notes = 'Imported from Entra ID';

-- Clear the leaky sentinel out of the notes field. Anyone who added manual
-- notes will still have them; only the bare flag is stripped.
UPDATE people
SET notes = NULL
WHERE notes = 'Imported from Entra ID';

-- Index the column we filter on during the Entra cleanup pass.
CREATE INDEX IF NOT EXISTS idx_people_source ON people(source_system);

-- Non-unique index on lowercased email — speeds up the "does a person with
-- this email exist?" check the sync runs on every Graph user. A strict
-- unique constraint is deferred to a separate migration so a fresh DB can
-- be seeded from arbitrary CSVs without the index rejecting the import.
CREATE INDEX IF NOT EXISTS idx_people_email ON people(LOWER(email));

-- Sessions table for bearer tokens issued in exchange for the master key.
-- Raw master keys no longer need to ride on every request; the token does.
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  source TEXT NOT NULL,              -- 'master_key' for now; extensible
  ip_address TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);

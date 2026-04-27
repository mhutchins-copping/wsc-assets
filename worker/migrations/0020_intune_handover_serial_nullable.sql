-- Drop NOT NULL on intune_handovers.serial. The simplified wizard makes
-- serial optional (council buys consumer iPhones/Androids; the IT
-- officer doesn't always have the serial in hand at provision time).
--
-- SQLite has no ALTER COLUMN DROP NOT NULL, so we rebuild the table.
-- D1 wraps multi-statement files in its own transaction, so no explicit
-- BEGIN/COMMIT (D1 rejects them — uses Durable Objects atomic writes).

DROP INDEX IF EXISTS idx_intune_handovers_asset;
DROP INDEX IF EXISTS idx_intune_handovers_person;
DROP INDEX IF EXISTS idx_intune_handovers_status;
DROP INDEX IF EXISTS idx_intune_handovers_expiry;
DROP INDEX IF EXISTS idx_intune_handovers_serial;

CREATE TABLE intune_handovers_new (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  token TEXT UNIQUE NOT NULL,
  asset_id TEXT NOT NULL REFERENCES assets(id),
  person_id TEXT NOT NULL REFERENCES people(id),
  serial TEXT,
  os TEXT NOT NULL,
  profile_id TEXT,
  profile_name TEXT,
  dep_token_id TEXT,
  qr_payload TEXT,
  qr_expires_at TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_by_email TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  opened_at TEXT,
  enrolled_at TEXT
);

INSERT INTO intune_handovers_new
  (id, token, asset_id, person_id, serial, os, profile_id, profile_name,
   dep_token_id, qr_payload, qr_expires_at, status, created_by_email,
   created_at, expires_at, opened_at, enrolled_at)
SELECT
   id, token, asset_id, person_id, serial, os, profile_id, profile_name,
   dep_token_id, qr_payload, qr_expires_at, status, created_by_email,
   created_at, expires_at, opened_at, enrolled_at
FROM intune_handovers;

DROP TABLE intune_handovers;
ALTER TABLE intune_handovers_new RENAME TO intune_handovers;

CREATE INDEX idx_intune_handovers_asset ON intune_handovers(asset_id);
CREATE INDEX idx_intune_handovers_person ON intune_handovers(person_id);
CREATE INDEX idx_intune_handovers_status ON intune_handovers(status);
CREATE INDEX idx_intune_handovers_expiry ON intune_handovers(expires_at);
CREATE INDEX idx_intune_handovers_serial ON intune_handovers(serial);

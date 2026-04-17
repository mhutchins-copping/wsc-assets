-- 0003: fix audits.location_id mismatch, add missing indexes
--
-- Background:
--   schema.sql declared audits.location_id as TEXT NOT NULL, but startAudit()
--   never inserts it (audits are site-wide, not location-scoped). On a fresh
--   DB initialised from schema.sql, creating an audit fails with a NOT NULL
--   constraint violation. The running prod DB was presumably initialised from
--   an earlier schema without the constraint, which is why audits work today.
--
-- What this migration does:
--   1. Rebuilds the audits table with location_id nullable (SQLite can't
--      drop NOT NULL in place). Existing rows carry over verbatim.
--   2. Adds idx_audit_items_asset — audit_items are looked up by asset_id in
--      scanAuditItem() and purgeAsset() but the only index on that table
--      covered audit_id.
--   3. Adds idx_users_email — every authenticated request does a lookup by
--      lower(email); UNIQUE already provides one, but name it explicitly and
--      keep the schema.sql and migrations in sync.
--
-- This migration is safe to run even if the live DB already has a nullable
-- location_id: recreating the table preserves all rows, and CREATE INDEX
-- IF NOT EXISTS is a no-op when the index already exists.

BEGIN TRANSACTION;

CREATE TABLE audits_new (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  location_id TEXT REFERENCES locations(id),
  status TEXT DEFAULT 'in_progress',
  started_at TEXT DEFAULT (datetime('now')),
  completed_at TEXT,
  notes TEXT,
  total_expected INTEGER DEFAULT 0,
  total_found INTEGER DEFAULT 0,
  total_missing INTEGER DEFAULT 0
);

INSERT INTO audits_new (id, location_id, status, started_at, completed_at, notes, total_expected, total_found, total_missing)
SELECT id, location_id, status, started_at, completed_at, notes, total_expected, total_found, total_missing
FROM audits;

DROP TABLE audits;
ALTER TABLE audits_new RENAME TO audits;

CREATE INDEX IF NOT EXISTS idx_audit_items_asset ON audit_items(asset_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

COMMIT;

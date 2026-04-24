-- Loaner pool: a small bucket of assets (visitor laptops, phones for new
-- starters before their own arrives, meeting-room kit) that get lent out
-- short-term rather than permanently assigned.
--
-- Modelled as a separate `loans` table rather than bolted onto the
-- existing checkout flow because loans carry a due_date and a return
-- event that doesn't fit the permanent-assignment pattern.

ALTER TABLE assets ADD COLUMN is_loaner INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS loans (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  asset_id TEXT NOT NULL REFERENCES assets(id),
  person_id TEXT NOT NULL REFERENCES people(id),
  loaned_at TEXT NOT NULL DEFAULT (datetime('now')),
  due_date TEXT NOT NULL,       -- yyyy-mm-dd
  returned_at TEXT,             -- set when the asset comes back
  loaned_by_email TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_loans_asset ON loans(asset_id);
CREATE INDEX IF NOT EXISTS idx_loans_person ON loans(person_id);
CREATE INDEX IF NOT EXISTS idx_loans_active ON loans(returned_at);

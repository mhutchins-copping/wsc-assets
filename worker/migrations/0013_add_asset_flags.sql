-- User self-service fault reports ("flags").
--
-- A non-admin staff member looking at their own asset can flag a problem
-- (damaged screen, runs slow, lost device, other). The flag lands in an
-- admin inbox and fires an email notification so IT can triage without
-- waiting for a Teams message.
--
-- Named "flags" in the UI to avoid collision with:
--   * asset_issues  -> signing-receipts workflow (unchanged)
--   * reports       -> analytics view (unchanged)

CREATE TABLE IF NOT EXISTS asset_flags (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  asset_id TEXT NOT NULL REFERENCES assets(id),
  -- Reporter identity captured from the signed-in user. We intentionally
  -- store email + display name rather than a person_id foreign key so the
  -- flag survives if the person record is later removed from the directory.
  reported_by_email TEXT NOT NULL,
  reported_by_name TEXT,
  category TEXT NOT NULL,            -- damaged | slow | lost | other
  description TEXT,
  status TEXT NOT NULL DEFAULT 'open', -- open | resolved | dismissed
  resolved_by_email TEXT,
  resolution_notes TEXT,
  resolved_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_asset_flags_asset ON asset_flags(asset_id);
CREATE INDEX IF NOT EXISTS idx_asset_flags_status ON asset_flags(status);
CREATE INDEX IF NOT EXISTS idx_asset_flags_reporter ON asset_flags(LOWER(reported_by_email));

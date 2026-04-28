-- Consumables / Inventory module.
--
-- Tracks commodity items that aren't worth a per-unit asset record:
-- keyboards, mice, cables, chargers, toner, etc. Stock is counted by
-- quantity-on-hand. Issuing to staff is optional (set person_id on the
-- movement) - for cheap bulk items, often you just decrement the count
-- and move on. Issuing to an asset is also optional (toner for a
-- specific printer asset, USB-C cable for laptop X).
--
-- Distinct from the assets table because:
--   * No serial / tag generation
--   * No 1:1 assignment - one record represents N items
--   * Movement-based history rather than activity_log entries
--   * Designed for "we have 12 USB-C chargers" not "Asset WSC-C-0042"

CREATE TABLE IF NOT EXISTS consumables (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  name TEXT NOT NULL,
  category TEXT NOT NULL,            -- keyboard|mouse|charger|headset|dock|cable|toner|other
  description TEXT,
  supplier TEXT,
  unit_cost REAL,
  quantity INTEGER NOT NULL DEFAULT 0,
  min_stock INTEGER NOT NULL DEFAULT 0,
  location_id TEXT REFERENCES locations(id),
  notes TEXT,
  -- Toner-specific optional fields. Stored on the row rather than a
  -- separate table because they're sparse but cheap, and avoiding a
  -- join keeps the list query simple.
  toner_printer_models TEXT,         -- comma-separated list, e.g. "HP M404, HP M428"
  toner_colour TEXT,                 -- black|cyan|magenta|yellow
  toner_yield INTEGER,               -- pages
  toner_cartridge_code TEXT,         -- e.g. "CF259A"
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS consumable_movements (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  consumable_id TEXT NOT NULL REFERENCES consumables(id),
  -- Signed quantity: positive = stock in, negative = stock out.
  quantity_change INTEGER NOT NULL,
  -- Movement classification, drives the UI label/icon.
  movement_type TEXT NOT NULL,       -- added|issued|returned|adjusted|written_off
  -- Optional links: which staff member, which asset this relates to.
  -- Both nullable so a generic "received 50 USB-C cables from Officeworks"
  -- can be recorded without a person/asset.
  person_id TEXT REFERENCES people(id),
  asset_id TEXT REFERENCES assets(id),
  notes TEXT,
  performed_by_email TEXT,
  performed_by_name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_consumables_category ON consumables(category);
CREATE INDEX IF NOT EXISTS idx_consumables_active ON consumables(active);
CREATE INDEX IF NOT EXISTS idx_consumables_lowstock ON consumables(quantity, min_stock);

CREATE INDEX IF NOT EXISTS idx_consumable_movements_consumable ON consumable_movements(consumable_id);
CREATE INDEX IF NOT EXISTS idx_consumable_movements_person ON consumable_movements(person_id);
CREATE INDEX IF NOT EXISTS idx_consumable_movements_asset ON consumable_movements(asset_id);
CREATE INDEX IF NOT EXISTS idx_consumable_movements_created ON consumable_movements(created_at);

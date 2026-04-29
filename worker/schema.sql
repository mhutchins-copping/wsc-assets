-- WSC IT Asset Management System — Database Schema
-- Cloudflare D1 (SQLite)

CREATE TABLE IF NOT EXISTS locations (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  name TEXT NOT NULL,
  address TEXT,
  type TEXT DEFAULT 'office',
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  name TEXT NOT NULL,
  prefix TEXT NOT NULL,
  parent_id TEXT REFERENCES categories(id),
  icon TEXT,
  field_profile TEXT DEFAULT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS people (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  name TEXT NOT NULL,
  email TEXT,
  department TEXT,
  position TEXT,
  phone TEXT,
  location_id TEXT REFERENCES locations(id),
  active INTEGER DEFAULT 1,
  source_system TEXT,                 -- 'entra' when sourced from the Graph sync, NULL if manually added
  source_updated_at TEXT,             -- last time the sync touched this row
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  source TEXT NOT NULL,
  ip_address TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  asset_tag TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  serial_number TEXT,
  category_id TEXT REFERENCES categories(id),
  manufacturer TEXT,
  model TEXT,
  status TEXT NOT NULL DEFAULT 'available',
  purchase_date TEXT,
  purchase_cost REAL,
  purchase_order TEXT,
  supplier TEXT,
  warranty_months INTEGER,
  warranty_expiry TEXT,
  retirement_date TEXT,
  notes TEXT,
  metadata TEXT DEFAULT '{}',
  image_url TEXT,
  -- Hardware specs (auto-populated by enrollment script)
  hostname TEXT,
  os TEXT,
  cpu TEXT,
  ram_gb INTEGER,
  disk_gb INTEGER,
  mac_address TEXT,
  ip_address TEXT,
  enrolled_user TEXT,
  phone_number TEXT,
  carrier TEXT,
  location_id TEXT REFERENCES locations(id),
  assigned_to TEXT REFERENCES people(id),
  assigned_date TEXT,
  -- Loaner pool flag: 1 if this asset belongs to the short-term lending
  -- pool (meeting-room laptops, visitor phones, etc.) rather than the
  -- permanent allocation pool.
  is_loaner INTEGER NOT NULL DEFAULT 0,
  -- ID of the user who created the record. Powers the user-role
  -- ownership check (users can edit/dispose only their own assets).
  -- Added by migration 0018; lives here so fresh installs that run
  -- schema.sql alone (npm run db:schema) get the same shape.
  created_by TEXT REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS activity_log (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  ip_address TEXT,
  asset_id TEXT REFERENCES assets(id),
  action TEXT NOT NULL,
  details TEXT,
  performed_by TEXT,
  person_id TEXT REFERENCES people(id),
  location_id TEXT REFERENCES locations(id),
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS maintenance_log (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  asset_id TEXT REFERENCES assets(id) NOT NULL,
  type TEXT NOT NULL,
  description TEXT NOT NULL,
  cost REAL,
  performed_by TEXT,
  date TEXT NOT NULL,
  next_due TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS audits (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  -- Nullable: audits are site-wide today and startAudit() doesn't record one.
  -- Kept on the table for future per-location audits.
  location_id TEXT REFERENCES locations(id),
  status TEXT DEFAULT 'in_progress',
  started_at TEXT DEFAULT (datetime('now')),
  completed_at TEXT,
  notes TEXT,
  total_expected INTEGER DEFAULT 0,
  total_found INTEGER DEFAULT 0,
  total_missing INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS audit_items (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  audit_id TEXT REFERENCES audits(id) NOT NULL,
  asset_id TEXT REFERENCES assets(id) NOT NULL,
  status TEXT DEFAULT 'pending',
  scanned_at TEXT,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  email TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  active INTEGER DEFAULT 1,
  notifications_enabled INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  last_login TEXT
);

-- Asset receipt / acknowledgement records. Recipient signs via a public,
-- token-gated page hosted on api.it-wsc.com so they don't need to complete
-- SSO from their personal device.
CREATE TABLE IF NOT EXISTS asset_issues (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  asset_id TEXT NOT NULL REFERENCES assets(id),
  person_id TEXT NOT NULL REFERENCES people(id),
  token TEXT UNIQUE NOT NULL,
  issued_by_email TEXT,
  issued_at TEXT NOT NULL DEFAULT (datetime('now')),
  email_sent_at TEXT,
  signed_at TEXT,
  signature_data_url TEXT,
  signature_name TEXT,
  signature_ip TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  expires_at TEXT,
  terms_text TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_assets_status ON assets(status);
CREATE INDEX IF NOT EXISTS idx_assets_category ON assets(category_id);
CREATE INDEX IF NOT EXISTS idx_assets_location ON assets(location_id);
CREATE INDEX IF NOT EXISTS idx_assets_assigned ON assets(assigned_to);
CREATE INDEX IF NOT EXISTS idx_assets_tag ON assets(asset_tag);
CREATE INDEX IF NOT EXISTS idx_assets_serial ON assets(serial_number);
CREATE INDEX IF NOT EXISTS idx_activity_asset ON activity_log(asset_id);
CREATE INDEX IF NOT EXISTS idx_activity_created ON activity_log(created_at);
CREATE INDEX IF NOT EXISTS idx_activity_rate_limit ON activity_log(action, ip_address, created_at);
CREATE INDEX IF NOT EXISTS idx_people_active ON people(active);
CREATE INDEX IF NOT EXISTS idx_people_department ON people(department);
CREATE INDEX IF NOT EXISTS idx_maintenance_asset ON maintenance_log(asset_id);
CREATE INDEX IF NOT EXISTS idx_audit_items_audit ON audit_items(audit_id);
CREATE INDEX IF NOT EXISTS idx_audit_items_asset ON audit_items(asset_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_people_source ON people(source_system);
CREATE INDEX IF NOT EXISTS idx_people_email ON people(LOWER(email));
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_asset_issues_asset ON asset_issues(asset_id);
CREATE INDEX IF NOT EXISTS idx_asset_issues_person ON asset_issues(person_id);
CREATE INDEX IF NOT EXISTS idx_asset_issues_status ON asset_issues(status);

-- User-filed fault reports ("flags"). Distinct from asset_issues (which
-- are signing-receipts) and reports view (analytics).
CREATE TABLE IF NOT EXISTS asset_flags (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  asset_id TEXT NOT NULL REFERENCES assets(id),
  reported_by_email TEXT NOT NULL,
  reported_by_name TEXT,
  category TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  resolved_by_email TEXT,
  resolution_notes TEXT,
  resolved_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_asset_flags_asset ON asset_flags(asset_id);
CREATE INDEX IF NOT EXISTS idx_asset_flags_status ON asset_flags(status);
CREATE INDEX IF NOT EXISTS idx_asset_flags_reporter ON asset_flags(LOWER(reported_by_email));

-- Loaner pool: short-term lends with a due_date, tracked separately from
-- permanent checkout/assignment.
CREATE TABLE IF NOT EXISTS loans (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  asset_id TEXT NOT NULL REFERENCES assets(id),
  person_id TEXT NOT NULL REFERENCES people(id),
  loaned_at TEXT NOT NULL DEFAULT (datetime('now')),
  due_date TEXT NOT NULL,
  returned_at TEXT,
  loaned_by_email TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_loans_asset ON loans(asset_id);
CREATE INDEX IF NOT EXISTS idx_loans_person ON loans(person_id);
CREATE INDEX IF NOT EXISTS idx_loans_active ON loans(returned_at);

-- Consumables / Inventory module. Quantity-tracked stock for commodity
-- items (keyboards, mice, cables, chargers, toner). Distinct from
-- assets - no per-unit identity. See migration 0022 for the full
-- design rationale.
CREATE TABLE IF NOT EXISTS consumables (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT,
  supplier TEXT,
  unit_cost REAL,
  quantity INTEGER NOT NULL DEFAULT 0,
  min_stock INTEGER NOT NULL DEFAULT 0,
  location_id TEXT REFERENCES locations(id),
  notes TEXT,
  toner_printer_models TEXT,
  toner_colour TEXT,
  toner_yield INTEGER,
  toner_cartridge_code TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS consumable_movements (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  consumable_id TEXT NOT NULL REFERENCES consumables(id),
  quantity_change INTEGER NOT NULL,
  movement_type TEXT NOT NULL,
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

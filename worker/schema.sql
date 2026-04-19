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
  notes TEXT,
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
  location_id TEXT REFERENCES locations(id),
  assigned_to TEXT REFERENCES people(id),
  assigned_date TEXT,
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

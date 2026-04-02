-- Add users table for app-level authorisation (mapped from SSO identity)
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  email TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  last_login TEXT
);

-- Seed the admin user
INSERT OR IGNORE INTO users (id, email, display_name, role) VALUES (
  'admin001',
  'mhutchins-copping@walgett.nsw.gov.au',
  'Matt Hutchins-Copping',
  'admin'
);
